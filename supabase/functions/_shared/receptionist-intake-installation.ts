import { launchPromotionIds as ids } from './receptionist-launch-promotion.ts';
import { releaseHash, stableJson } from './receptionist-release.ts';
import { buildEmergencyIntakeHandoffTool } from './receptionist-emergency-intake-gate.ts';
import { intakeLaunchPatch } from './receptionist-launch-intake-contract.ts';

type Api = (path: string, method?: string, payload?: unknown) => Promise<any>;
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const table = 'receptionist_intake_installation';

// Explicit service-only maintenance. Never called by a test, webhook or scheduler.
// The original launch source, prior results, live assistant and PBX stay untouched.
export async function installCandidateIntake(db: any, api: Api, actor: string, token: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw Error('Scoped test credential unavailable');
  const auth = await db.rpc('care_release_actor', { p_actor: actor });
  if (auth.error) throw Error('OpenFolk administrator required');
  const old = await db.from(table).select('state,verified_at').eq('tenant_id', ids.tenant).maybeSingle();
  if (old.error) throw Error('Private intake audit unavailable');
  if (old.data) return { ...old.data, alreadyReserved: true, retrySent: false, liveAssistantChanged: false };
  const saved = await db.from('receptionist_test_candidates')
    .select('candidate_id,helper_id,handoff_id,source_assistant').eq('tenant_id', ids.tenant).single();
  const [candidate, handoff, live, helper, phones] = await Promise.all([
    api(`assistant/${ids.candidate}`), api(`tool/${ids.handoff}`),
    api(`assistant/${ids.live}`), api(`assistant/${ids.helper}`), api('phone-number'),
  ]);
  if (saved.error || saved.data?.candidate_id !== ids.candidate || saved.data?.helper_id !== ids.helper ||
    saved.data?.handoff_id !== ids.handoff || saved.data?.source_assistant?.orgId !== live.orgId ||
    candidate.id !== ids.candidate || handoff.id !== ids.handoff || helper.id !== ids.helper || live.id !== ids.live ||
    [candidate,handoff,helper].some(r => r.orgId !== live.orgId) ||
    !same(candidate.model?.toolIds,[ids.handoff]) || handoff.type !== 'handoff' ||
    handoff.function?.name !== 'Route-Emergency-to-Rob-or-Tony' ||
    handoff.destinations?.length !== 1 || handoff.destinations[0].assistantId !== ids.helper ||
    live.model?.toolIds?.includes(ids.handoff) || helper.model?.toolIds?.includes(ids.handoff) ||
    !Array.isArray(phones) || phones.some(p => p.squadId || p.squad ||
      [ids.candidate,ids.helper].includes(p.assistantId) || [ids.candidate,ids.helper].includes(p.assistant?.id)))
    throw Error('Isolated candidate binding requires review');
  const patch = intakeLaunchPatch(candidate);
  const tool = buildEmergencyIntakeHandoffTool({
    url:'https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/receptionist-intake-check',
    headers:{'X-OpenFolk-Intake-Token':token},
  });
  const beforeLive = await releaseHash(live), beforeHelper = await releaseHash(helper);
  const beforePhones = stableJson(phones);
  // The operator action checked a previous graph hash. Re-read the exact
  // candidate and handoff before reserving a write so an intervening provider
  // edit cannot be overwritten by this one-time installer.
  const [candidateAtReservation, handoffAtReservation] = await Promise.all([
    api(`assistant/${ids.candidate}`), api(`tool/${ids.handoff}`),
  ]);
  if (await releaseHash(candidateAtReservation) !== await releaseHash(candidate) ||
    await releaseHash(handoffAtReservation) !== await releaseHash(handoff))
    throw Error('Candidate or handoff changed before reservation; inspect again');
  const reserved = await db.from(table).insert({
    tenant_id:ids.tenant,actor_id:actor,candidate_id:ids.candidate,state:'prepared',
    before_candidate:candidate,before_handoff:handoff,
    candidate_hash:await releaseHash(candidate),handoff_hash:await releaseHash(handoff),
  });
  if (reserved.error) throw Error('Intake change not reserved; inspect before retry');
  let providerUncertain = false;
  // No automatic retry. An ambiguous write is reconciled by read-back.
  try { await api(`tool/${ids.handoff}`,'PATCH',tool); }
  catch { providerUncertain = true; }
  const observedTool = await api(`tool/${ids.handoff}`);
  const toolMatches = Object.keys(tool).every(k => same(observedTool[k],tool[k]));
  if (toolMatches) {
    try { await api(`assistant/${ids.candidate}`,'PATCH',patch); }
    catch { providerUncertain = true; }
  }
  const [afterCandidate,afterLive,afterHelper,afterPhones] = await Promise.all([
    api(`assistant/${ids.candidate}`),api(`assistant/${ids.live}`),api(`assistant/${ids.helper}`),api('phone-number'),
  ]);
  const unchanged = beforeLive === await releaseHash(afterLive) && beforeHelper === await releaseHash(afterHelper) && beforePhones === stableJson(afterPhones);
  const matches = toolMatches && Object.keys(patch).every(k => same(afterCandidate[k],patch[k])) && unchanged;
  const state = matches ? 'verified' : 'review_required';
  const recorded = await db.from(table).update({state,verified_at:matches ? new Date().toISOString() : null})
    .eq('tenant_id',ids.tenant).eq('state','prepared');
  if (recorded.error) throw Error('Intake read-back needs audit reconciliation; no retry sent');
  return {state,candidateId:ids.candidate,providerUncertain,retrySent:false,
    configurationReadBack:matches,liveAndPhoneBindingsUnchanged:unchanged,
    voiceTestPassed:false,webhookCallProven:false,paidRunStarted:false};
}
