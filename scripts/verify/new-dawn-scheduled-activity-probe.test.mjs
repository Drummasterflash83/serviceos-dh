import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runScheduledActivityProbe, validScheduledActivityProbeRequest } from '../../supabase/functions/_shared/commusoft/scheduled_activity_probe.ts';
import { readScheduledActivitySourcePage } from '../../src/lib/new-dawn-scheduled-activity-source-review.ts';
import { rehearsalSql } from './new-dawn-scheduled-activity-probe-rehearse.mjs';

const tenantId = '00000000-0000-4000-8000-000000000001';
const connectionId = '00000000-0000-4000-8000-000000000002';
const requestId = '00000000-0000-4000-8000-000000000003';
const permitId = '00000000-0000-4000-8000-000000000004';
const request = { tenantId, connectionId, requestId, reason: 'Review office tasks' };

function harness(body) {
  const calls = [];
  let fetched = 0;
  const ports = {
    userRpc: async (name) => {
      calls.push(name);
      return { data: { requestId, state: 'prepared', limit: 10 }, error: null };
    },
    serviceRpc: async (name, args) => {
      calls.push(name);
      if (name.endsWith('_acquire')) return { data: { state: 'ready', requestId, tenantId, connectionId, region: 'uk', apiKey: 'synthetic', permitId, sendBefore: Date.now() + 1000 }, error: null };
      if (name.endsWith('_current')) return { data: true, error: null };
      if (name.endsWith('_finish')) {
        assert.equal(args.p_raw, JSON.stringify(body));
        return { data: { version: 'commusoft-scheduled_activity-probe/1', requestId, recordCount: body.data.length }, error: null };
      }
      if (name.endsWith('_fail')) return { data: null, error: null };
      throw Error(`Unexpected ${name}`);
    },
    fetcher: async (url, init) => {
      fetched++;
      assert.equal(url, 'https://app.commusoft.co.uk/api/v2/scheduledActivities?limit=10&includeCount=true');
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return { ports, calls, get fetched() { return fetched; } };
}

test('one bounded manual office-task page, with no provider mutation', async () => {
  const h = harness({ data: [{ id: 'source-1', parentType: 'job', assignedToo: [1] }] });
  const receipt = await runScheduledActivityProbe(request, h.ports);
  assert.equal(receipt.recordCount, 1);
  assert.equal(h.fetched, 1);
  assert.equal(h.calls.filter(x => x.endsWith('_finish')).length, 1);
  assert.equal(h.calls.filter(x => x.endsWith('_fail')).length, 0);
});

test('rejects excess records without retaining a success receipt', async () => {
  const h = harness({ data: Array.from({ length: 11 }, (_, id) => ({ id })) });
  await assert.rejects(runScheduledActivityProbe(request, h.ports), /response_invalid/);
  assert.equal(h.fetched, 1);
  assert.equal(h.calls.filter(x => x.endsWith('_finish')).length, 0);
  assert.equal(h.calls.filter(x => x.endsWith('_fail')).length, 1);
});

test('strict request and scope-bound summary prevent accidental interpretation', () => {
  assert.equal(validScheduledActivityProbeRequest({ ...request, page: 2 }), false);
  const receipt = { version: 'commusoft-scheduled_activity-probe/1', meaning: 'office_task_source_only',
    requestId, tenantId, connectionId, observedAt: new Date().toISOString(), recordCount: 1,
    hasMore: null, parentTypeCounts: [{ parentType: 'job', count: 1 }], statusCounts: [{ status: '<unspecified>', count: 1 }],
    jobParentCount: 1, dueDatePresentCount: 0, assignedTooPresentCount: 1 };
  const page = readScheduledActivitySourcePage(receipt, { tenant: tenantId, connection: connectionId, request: requestId });
  assert.equal(page.jobParentCount, 1);
  assert.throws(() => readScheduledActivitySourcePage({ ...receipt, meaning: 'engineer_appointment' }, { tenant: tenantId, connection: connectionId, request: requestId }));
  assert.throws(() => readScheduledActivitySourcePage(receipt, { tenant: tenantId, connection: connectionId, request: permitId }));
});

test('disabled by default, operator and service grants separated, rollback rehearsal only', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261106193000_new_dawn_commusoft_scheduled_activity_probe.sql', import.meta.url), 'utf8');
  assert.match(sql, /flag='new_dawn\.m2_scheduled_activity_probe' and value='true'::jsonb/);
  assert.doesNotMatch(sql, /insert into public\.feature_flags/);
  assert.match(sql, /perform public\.learn_operator_input_access\(p_tenant,auth\.uid\(\),true\)/);
  assert.match(sql, /grant execute on function public\.new_dawn_commusoft_scheduled_activity_probe_acquire\(uuid\),[\s\S]+to service_role/);
  assert.match(rehearsalSql(), /rollback;$/);
});
