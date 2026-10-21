// Explicit, one-time repair of the isolated Emma candidate's speech settings.
// It never changes published Emma, a shared tool or any telephone binding.
import { launchPromotionIds as ids } from './receptionist-launch-promotion.ts';
import { releaseHash, stableJson } from './receptionist-release.ts';
import { summarizeVapiTestNumber } from './receptionist-provider-preflight.ts';
import { UUID } from './receptionist-testing.ts';

type Api = (path: string, method?: string, payload?: unknown) => Promise<any>;
const names = ['live', 'candidate', 'helper', 'handoff', 'ordinary', 'emergency'] as const;
type Name = typeof names[number];
type Expected = Record<Name | 'testNumber', string>;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function read(api: Api) {
  const resources = await Promise.all(names.map(name => api(
    `${['handoff', 'ordinary', 'emergency'].includes(name) ? 'tool' : 'assistant'}/${ids[name]}`, 'GET')));
  const graph = Object.fromEntries(names.map((name, i) => [name, resources[i]])) as Record<Name, any>;
  const phones = await api('phone-number?limit=1000', 'GET');
  if (!Array.isArray(phones) || phones.length >= 1000 ||
    !UUID.test(graph.live?.orgId ?? '') || names.some(name =>
      graph[name]?.id !== ids[name] || graph[name]?.orgId !== graph.live.orgId))
    throw Error('Isolated Emma provider identity changed.');
  const testNumber = await summarizeVapiTestNumber(phones);
  if (testNumber.state !== 'checked' || testNumber.matchesSavedLiveAssistant !== true ||
    testNumber.fallbackToSavedMaryDdi !== true ||
    phones.some(phone => [ids.candidate, ids.helper].includes(phone.assistantId)))
    throw Error('Isolated Emma test-number binding changed.');
  return { graph, phones, testNumber,
    hashes: Object.fromEntries(await Promise.all(names.map(async name =>
      [name, await releaseHash(graph[name])]))) as Record<Name, string> };
}

function assertExpected(observed: Awaited<ReturnType<typeof read>>, expected: Expected) {
  if (!expected || Object.keys(expected).sort().join(',') !== [...names, 'testNumber'].sort().join(',') ||
    Object.values(expected).some(value => !hash(value)) ||
    names.some(name => observed.hashes[name] !== expected[name]) ||
    observed.testNumber.configurationHash !== expected.testNumber)
    throw Error('Isolated Emma graph changed since the reviewed hashes.');
}

export async function reconcileIsolatedEmmaVoice(db: any, api: Api, actor: string,
  expected: Expected) {
  if (!UUID.test(actor)) throw Error('OpenFolk launch administrator required.');
  const gate = await db.rpc('care_release_actor', { p_actor: actor });
  if (gate.error) throw Error('OpenFolk launch administrator required.');
  const saved = await db.from('receptionist_test_candidates')
    .select('state,candidate_id,helper_id,handoff_id,source_assistant')
    .eq('tenant_id', ids.tenant).single();
  if (saved.error || saved.data?.state !== 'prepared' ||
    saved.data?.candidate_id !== ids.candidate || saved.data?.helper_id !== ids.helper ||
    saved.data?.handoff_id !== ids.handoff || saved.data?.source_assistant?.id !== ids.live)
    throw Error('Isolated Emma candidate is not in the reviewed prepared state.');
  const before = await read(api);
  assertExpected(before, expected);
  const { graph } = before;
  if (saved.data.source_assistant.orgId !== graph.live.orgId ||
    graph.live.voice?.speed !== 1.05 || !graph.live.transcriber ||
    typeof graph.live.transcriber !== 'object' ||
    !graph.candidate.voice || !graph.helper.voice ||
    !graph.candidate.transcriber || !graph.helper.transcriber ||
    stableJson(graph.candidate.model?.toolIds) !== stableJson([ids.handoff]) ||
    graph.candidate.model?.tools?.length !== 1 ||
    stableJson(graph.helper.model?.toolIds) !== stableJson([]) ||
    graph.helper.model?.tools?.length !== 1 ||
    graph.helper.model.tools[0]?.type !== 'transferCall' ||
    graph.handoff.type !== 'handoff' || graph.handoff.destinations?.length !== 1 ||
    graph.handoff.destinations[0]?.assistantId !== ids.helper ||
    graph.handoff.destinations[0]?.contextEngineeringPlan?.type !== 'all')
    throw Error('Current Emma speech or isolated candidate structure needs review.');
  const targetCandidate = { ...graph.candidate, voice: graph.live.voice, transcriber: graph.live.transcriber };
  const targetHelper = { ...graph.helper, voice: graph.live.voice, transcriber: graph.live.transcriber };
  const targets = { candidate: await releaseHash(targetCandidate), helper: await releaseHash(targetHelper) };
  if (before.hashes.candidate === targets.candidate && before.hashes.helper === targets.helper)
    return { state: 'already_aligned', providerPatchAttempts: 0, phoneChanged: false,
      liveChanged: false, candidateHash: targets.candidate, helperHash: targets.helper };

  // Conditional state transition serialises this maintenance with promotion.
  // An uncertain attempt stays reserved; nothing retries or resets it blindly.
  const reservation = await db.from('receptionist_test_candidates')
    .update({ state: 'voice_reconcile_reserved' })
    .eq('tenant_id', ids.tenant).eq('state', 'prepared')
    .eq('candidate_id', ids.candidate).eq('helper_id', ids.helper)
    .select('state').maybeSingle();
  if (reservation.error || reservation.data?.state !== 'voice_reconcile_reserved')
    throw Error('Isolated Emma voice repair was already reserved.');
  const audit = await db.from('phone_operations_audit').insert({
    tenant_id: ids.tenant, actor_user_id: actor, actor_label: 'OpenFolk launch administrator',
    action: 'isolated_emma_voice_reconcile_reserved', resource_type: 'vapi_test_candidate',
    resource_ref: ids.candidate, before_state: { ...before.hashes, testNumber: expected.testNumber },
    after_state: { candidate: targets.candidate, helper: targets.helper },
    reason: 'Copy only current published Emma voice/transcriber to the isolated candidate and helper; no live assistant, tool or phone change.',
  }).select('id').single();
  if (audit.error || !UUID.test(audit.data?.id ?? ''))
    throw Error('Isolated Emma audit reservation failed; no provider write sent.');
  const markReview = async () => {
    await db.from('phone_operations_audit').update({ action: 'isolated_emma_voice_reconcile_needs_review' })
      .eq('id', audit.data.id);
    return { state: 'review_required', automaticRetrySent: false,
      phoneChanged: 'not_verified', liveChanged: 'not_verified', auditId: audit.data.id };
  };
  const atWrite = await read(api);
  try { assertExpected(atWrite, expected); }
  catch { return await markReview(); }
  for (const [name, target] of [['candidate', targets.candidate], ['helper', targets.helper]] as const) {
    if (before.hashes[name] === target) continue;
    let immediatelyBefore;
    try { immediatelyBefore = await read(api); } catch { return await markReview(); }
    if (immediatelyBefore.hashes[name] !== expected[name] ||
      names.some(other => !['candidate', 'helper'].includes(other) &&
        immediatelyBefore.hashes[other] !== expected[other]) ||
      (name === 'helper' && immediatelyBefore.hashes.candidate !== targets.candidate) ||
      immediatelyBefore.testNumber.configurationHash !== expected.testNumber ||
      stableJson(immediatelyBefore.phones) !== stableJson(before.phones))
      return await markReview();
    try { await api(`assistant/${ids[name]}`, 'PATCH', {
      voice: graph.live.voice, transcriber: graph.live.transcriber,
    }); } catch { /* A lost response may follow an applied PATCH: GET, never retry. */ }
    let observed;
    try { observed = await read(api); } catch { return await markReview(); }
    if (observed.hashes[name] !== target ||
      names.some(other => !['candidate', 'helper'].includes(other) &&
        observed.hashes[other] !== expected[other]) ||
      observed.testNumber.configurationHash !== expected.testNumber)
      return await markReview();
  }
  let after;
  try { after = await read(api); } catch { return await markReview(); }
  if (after.hashes.candidate !== targets.candidate || after.hashes.helper !== targets.helper ||
    names.some(name => !['candidate', 'helper'].includes(name) && after.hashes[name] !== expected[name]) ||
    after.testNumber.configurationHash !== expected.testNumber ||
    stableJson(after.phones) !== stableJson(before.phones)) return await markReview();
  const recorded = await db.from('phone_operations_audit').update({
    action: 'isolated_emma_voice_reconciled', after_state: { ...targets, testNumber: expected.testNumber },
  }).eq('id', audit.data.id);
  if (recorded.error) throw Error('Isolated Emma provider aligned; audit needs manual reconciliation.');
  const released = await db.from('receptionist_test_candidates')
    .update({ state: 'prepared' }).eq('tenant_id', ids.tenant)
    .eq('state', 'voice_reconcile_reserved').select('state').maybeSingle();
  if (released.error || released.data?.state !== 'prepared')
    throw Error('Isolated Emma provider aligned; candidate state needs manual reconciliation.');
  return { state: 'verified', providerPatchAttempts: Number(before.hashes.candidate !== targets.candidate) +
    Number(before.hashes.helper !== targets.helper), automaticRetrySent: false,
    phoneChanged: false, liveChanged: false, auditId: audit.data.id,
    candidateHash: targets.candidate, helperHash: targets.helper };
}
