import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const root = new URL('../../supabase/functions/_shared/', import.meta.url);
const stage = mkdtempSync(join(tmpdir(), 'learn-card-revision-test-'));
let handle;
try {
  const transpile = (source) => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const pure = readFileSync(new URL('customer_card.ts', root), 'utf8');
  writeFileSync(join(stage, 'customer_card.mjs'), transpile(pure));
  const handler = readFileSync(new URL('worker_handlers/customer_card_sync.ts', root), 'utf8')
    .replace('import { isUuid } from "../simwood.ts";',
      'const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);')
    .replace('"../customer_card.ts"', '"./customer_card.mjs"');
  writeFileSync(join(stage, 'handler.mjs'), transpile(handler));
  ({ handleCustomerCardSync: handle } = await import(new URL(`file://${stage}/handler.mjs`)));
} finally {
  // The loaded module remains in memory for both tests.
  rmSync(stage, { recursive: true, force: true });
}

const tenant = '00000000-0000-0000-0000-000000000001';
const cardId = '22222222-2222-4222-8222-222222222222';
const personId = '33333333-3333-4333-8333-333333333333';
const before = '2026-10-16T12:00:00.000Z';
function client(currentUpdatedAt) {
  const reads = { revised: 0, updates: 0 };
  const from = (table) => {
    let selected = '';
    let update = false;
    const q = {
      select(fields) { selected = fields; return q; },
      update() { update = true; reads.updates++; return q; },
      eq() { return q; }, in() { return q; }, or() { return q; }, gt() { return q; },
      neq() { return q; }, lt() { return q; }, order() { return q; }, limit() { return q; },
      async maybeSingle() {
        if (table !== 'customer_cards') throw Error('Unexpected maybeSingle');
        if (update) return { data: null, error: null };
        if (selected === 'updated_at') {
          reads.revised++;
          return { data: { updated_at: currentUpdatedAt }, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve, reject) {
        let data;
        if (table === 'customer_cards') data = [{ id: cardId, person_id: personId,
          company_id: null, title: 'Customer', status: 'grey', priority: 'medium',
          confidence: 0, due_at: null, completed_at: null, locked_fields: [],
          context: {}, updated_at: before }];
        else if (table === 'people') data = [{ id: personId, display_name: 'Customer',
          first_name: null, last_name: null, primary_email: null, primary_phone: null,
          company_id: null }];
        else if (table === 'graph_nodes') data = [];
        else throw Error(`Unexpected table ${table}`);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  return { reads, admin: { from, async rpc(name) {
    assert.equal(name, 'learn_card_projection_inputs');
    return { data: { version: 'learn-card-inputs/1', tenantId: tenant, cardId,
      capturedAt: '2026-10-16T12:05:00Z', interactions: [], recommendations: [],
      coverage: { eligibleInteractions: 0, excludedDraftInteractions: 0,
        interactionsLast7: 0, interactionsPrev7: 0, eligibleRecommendations: 0,
        excludedDraftRecommendations: 0, urgentRecommendations: 0,
        interactionLimit: 100, recommendationLimit: 50 } }, error: null };
  } } };
}

test('a real concurrent card revision is left for the next sweep', async () => {
  const { admin, reads } = client('2026-10-16T12:01:00.000Z');
  const result = await handle({ supabaseAdmin: admin, tenantId: tenant,
    payload: { customer_card_id: cardId } });
  assert.equal(result.success, true);
  assert.equal(result.recordsProcessed, 0);
  assert.equal(result.result.skipped, 1);
  assert.equal(result.result.revision_conflicts, 1);
  assert.equal(reads.updates, 1);
  assert.equal(reads.revised, 1);
});

test('missing update without a newer revision still fails visibly', async () => {
  const { admin } = client(before);
  const result = await handle({ supabaseAdmin: admin, tenantId: tenant,
    payload: { customer_card_id: cardId } });
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'card_partial_failure');
  assert.equal(result.result.revision_conflicts, 0);
});

test('unattended sweep bounds the batch and continues with the same cursor', async () => {
  const cards = Array.from({ length: 41 }, (_, n) => ({
    id: `card-${n}`, person_id: `person-${n}`, company_id: null,
    status: 'grey', updated_at: before,
  }));
  let selectedLimit = null;
  let advanced = 0;
  const admin = { from(table) {
    let updating = false;
    let filterId = null;
    const query = {
      select() { return query; }, update() { updating = true; return query; },
      eq(key, value) { if (key === 'id') filterId = value; return query; },
      in() { return query; }, neq() { return query; }, lt() { return query; },
      order() { return query; }, limit(n) {
        if (table === 'customer_cards') selectedLimit = n;
        return query;
      },
      async maybeSingle() {
        if (!updating || table !== 'customer_cards') throw Error('Unexpected read');
        advanced++;
        return { data: { id: filterId }, error: null };
      },
      then(resolve, reject) {
        let data;
        if (table === 'customer_cards') data = cards.slice(0, selectedLimit);
        else if (table === 'people') data = cards.map((card) => ({
          id: card.person_id, primary_email: 'fixture@example.invalid',
        }));
        else if (table === 'graph_nodes') data = [];
        else throw Error(`Unexpected table ${table}`);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const result = await handle({ supabaseAdmin: admin, tenantId: tenant, payload: {} });
  assert.equal(selectedLimit, 40);
  assert.equal(advanced, 40);
  assert.equal(result.success, true);
  assert.equal(result.result.skipped, 40);
  assert.equal(result.continuation.jobType, 'customer_card.sync');
  assert.equal(result.continuation.payload.limit, 40);
  assert.ok(Number.isFinite(Date.parse(result.continuation.payload.sweep_since)));
});
