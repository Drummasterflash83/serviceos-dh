import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileIsolatedEmmaVoice } from './receptionist-launch-voice-reconcile.ts';
import { launchPromotionIds as ids } from './receptionist-launch-promotion.ts';
import { releaseHash } from './receptionist-release.ts';
import { summarizeVapiTestNumber } from './receptionist-provider-preflight.ts';

async function fixture() {
  const orgId = '10000000-0000-0000-0000-000000000001';
  const actor = '20000000-0000-0000-0000-000000000001';
  const graph: Record<string, any> = {
    live: { id: ids.live, orgId, voice: { provider: '11labs', voiceId: 'live', speed: 1.05,
      apiKey: 'PRIVATE_VOICE' }, transcriber: { provider: 'deepgram', model: 'nova-3', apiKey: 'PRIVATE_STT' } },
    candidate: { id: ids.candidate, orgId, voice: { provider: '11labs', voiceId: 'old', speed: 1 },
      transcriber: { provider: 'deepgram', model: 'old' }, model: { toolIds: [ids.handoff], tools: [{}] } },
    helper: { id: ids.helper, orgId, voice: { provider: '11labs', voiceId: 'old', speed: 1 },
      transcriber: { provider: 'deepgram', model: 'old' }, model: { toolIds: [], tools: [{ type: 'transferCall' }] } },
    handoff: { id: ids.handoff, orgId, type: 'handoff', destinations: [{ assistantId: ids.helper,
      contextEngineeringPlan: { type: 'all' } }] },
    ordinary: { id: ids.ordinary, orgId, type: 'transferCall' },
    emergency: { id: ids.emergency, orgId, type: 'transferCall' },
  };
  const names = ['live', 'candidate', 'helper', 'handoff', 'ordinary', 'emergency'] as const;
  const phones = [{ id: '30000000-0000-0000-0000-000000000001',
    number: '+447426924154', assistantId: ids.live,
    fallbackDestination: { number: '+441794378095' } }];
  const expected: Record<string, string> = {};
  for (const name of names) expected[name] = await releaseHash(graph[name]);
  expected.testNumber = (await summarizeVapiTestNumber(phones)).configurationHash!;
  const state: any = { candidate: { tenant_id: ids.tenant, state: 'prepared', candidate_id: ids.candidate,
    helper_id: ids.helper, handoff_id: ids.handoff,
    source_assistant: { id: ids.live, orgId } }, audits: [], patches: [],
    failPatch: null, denyActor: false };
  const db = {
    rpc: async () => ({ error: state.denyActor ? 'denied' : null }),
    from(table: string) {
      function chain(operation: 'select' | 'update' | 'insert', payload: any = null) {
        const filters: Record<string, unknown> = {};
        const self: any = {
          eq(key: string, value: unknown) { filters[key] = value; return self; },
          select() { return self; },
          async maybeSingle() { return self.single(); },
          async single() {
            if (table === 'receptionist_test_candidates') {
              if (operation === 'select') return { data: structuredClone(state.candidate), error: null };
              if (Object.entries(filters).some(([key, value]) => state.candidate[key] !== value))
                return { data: null, error: null };
              Object.assign(state.candidate, payload);
              return { data: structuredClone(state.candidate), error: null };
            }
            if (table === 'phone_operations_audit' && operation === 'insert') {
              const row = { ...structuredClone(payload), id: '40000000-0000-0000-0000-000000000001' };
              state.audits.push(row); return { data: row, error: null };
            }
            throw Error('Unexpected database operation');
          },
          then(resolve: any) {
            if (table !== 'phone_operations_audit' || operation !== 'update')
              throw Error('Unexpected database update');
            const row = state.audits.find((x: any) => x.id === filters.id);
            if (!row) return Promise.resolve({ error: 'missing' }).then(resolve);
            Object.assign(row, payload); return Promise.resolve({ error: null }).then(resolve);
          },
        };
        return self;
      }
      return { select: () => chain('select'), update: (payload: any) => chain('update', payload),
        insert: (payload: any) => chain('insert', payload) };
    },
  };
  const api = async (path: string, method = 'GET', payload?: any) => {
    if (path === 'phone-number?limit=1000' && method === 'GET') return structuredClone(phones);
    const name = names.find(key => path ===
      `${['handoff', 'ordinary', 'emergency'].includes(key) ? 'tool' : 'assistant'}/${ids[key]}`);
    assert.ok(name, 'Only the six fixed resources may be used');
    if (method === 'GET') return structuredClone(graph[name]);
    assert.equal(method, 'PATCH');
    assert.ok(['candidate', 'helper'].includes(name));
    assert.deepEqual(Object.keys(payload).sort(), ['transcriber', 'voice']);
    state.patches.push(name);
    if ((state.failPatch === 'before' && name === 'candidate') ||
      (state.failPatch === 'helper-before' && name === 'helper')) throw Error('provider rejected');
    Object.assign(graph[name], structuredClone(payload));
    if (state.failPatch === 'after' && name === 'candidate') throw Error('lost acknowledgement');
    return structuredClone(graph[name]);
  };
  return { actor, graph, phones, expected, state, db, api,
    run: () => reconcileIsolatedEmmaVoice(db, api, actor, expected as any) };
}

test('exact voice repair changes only isolated candidate and helper and restores prepared state', async () => {
  const f = await fixture(), beforeLive = structuredClone(f.graph.live), beforePhones = structuredClone(f.phones);
  const result = await f.run();
  assert.equal(result.state, 'verified');
  assert.equal(result.providerPatchAttempts, 2);
  assert.deepEqual(f.state.patches, ['candidate', 'helper']);
  assert.deepEqual(f.graph.live, beforeLive);
  assert.deepEqual(f.phones, beforePhones);
  assert.deepEqual(f.graph.candidate.voice, f.graph.live.voice);
  assert.deepEqual(f.graph.helper.transcriber, f.graph.live.transcriber);
  assert.equal(f.state.candidate.state, 'prepared');
  assert.equal(f.state.audits[0].action, 'isolated_emma_voice_reconciled');
  assert.equal(JSON.stringify(f.state.audits).includes('PRIVATE_'), false);
});

test('stale reviewed hash rejects before reservation or provider PATCH', async () => {
  const f = await fixture();
  f.graph.candidate.model.toolIds = [];
  await assert.rejects(f.run(), /graph changed/);
  assert.equal(f.state.candidate.state, 'prepared');
  assert.deepEqual(f.state.patches, []);
});

test('lost acknowledgement is read back without repeating candidate PATCH', async () => {
  const f = await fixture(); f.state.failPatch = 'after';
  const result = await f.run();
  assert.equal(result.state, 'verified');
  assert.deepEqual(f.state.patches, ['candidate', 'helper']);
});

test('unapplied candidate PATCH holds the reservation and prevents a second attempt', async () => {
  const f = await fixture(); f.state.failPatch = 'before';
  const result = await f.run();
  assert.equal(result.state, 'review_required');
  assert.deepEqual(f.state.patches, ['candidate']);
  assert.equal(f.state.candidate.state, 'voice_reconcile_reserved');
  assert.equal(f.state.audits[0].action, 'isolated_emma_voice_reconcile_needs_review');
  await assert.rejects(f.run(), /not in the reviewed prepared state/);
  assert.deepEqual(f.state.patches, ['candidate']);
});

test('partial candidate success and helper failure remain held without touching published Emma', async () => {
  const f = await fixture(), published = structuredClone(f.graph.live);
  f.state.failPatch = 'helper-before';
  const result = await f.run();
  assert.equal(result.state, 'review_required');
  assert.deepEqual(f.state.patches, ['candidate', 'helper']);
  assert.deepEqual(f.graph.candidate.voice, f.graph.live.voice);
  assert.notDeepEqual(f.graph.helper.voice, f.graph.live.voice);
  assert.deepEqual(f.graph.live, published);
  assert.equal(f.state.candidate.state, 'voice_reconcile_reserved');
});
