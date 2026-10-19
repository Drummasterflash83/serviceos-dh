/** Rollback-only TEST rehearsal of the disabled one-page Commusoft opportunity probe.
 * No provider request, feature flag activation, or retained TEST mutation.
 */
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const filename = new URL('../../supabase/migrations/20261106130000_new_dawn_commusoft_opportunities_probe.sql', import.meta.url);
const source = readFileSync(filename, 'utf8');
if (!/^begin;\n/im.test(source) || !/\ncommit;\s*$/i.test(source)) throw Error('Migration wrapper changed');
const body = source.replace(/^([\s\S]*?)\bbegin;\n/i, '$1').replace(/\ncommit;\s*$/i, '\n');

export function rehearsalSql() {
  return `begin;\nset local lock_timeout='5s';\nset local statement_timeout='45s';\n${body}\ndo $fixture$ begin\n begin delete from public.new_dawn_commusoft_opportunity_probes where false; raise exception 'delete_guard_missing';\n exception when sqlstate '55000' then null; end;\n begin truncate public.new_dawn_commusoft_opportunity_probes, public.new_dawn_commusoft_opportunity_probe_events; raise exception 'truncate_guard_missing';\n exception when sqlstate '55000' then null; end;\nend $fixture$;\ndo $receipt_fixture$
declare request_id uuid;
begin
 insert into public.new_dawn_commusoft_opportunity_probes
  (id,tenant_id,actor_id,connection_id,binding,reason,state,expires_at,raw_envelope,content_hash,result)
 select gen_random_uuid(),c.tenant_id,p.id,c.id,'{}'::jsonb,'Rollback-only receipt guard',
  'complete',clock_timestamp()+interval '1 minute','{\"data\":[]}'::jsonb,'synthetic','{}'::jsonb
 from public.provider_connections c cross join public.profiles p
 where c.provider='commusoft' limit 1 returning id into request_id;
 if request_id is null then raise exception 'fixture_connection_or_actor_missing';end if;
 begin
  update public.new_dawn_commusoft_opportunity_probes set raw_envelope='{}'::jsonb where id=request_id;
  raise exception 'completed_receipt_guard_missing';
 exception when sqlstate '42501' then null;end;
end $receipt_fixture$;\ndo $source_fixture$
declare summary jsonb;
begin
 summary:=public.new_dawn_commusoft_opportunity_probe_summarize(
  '{\"data\":[{\"id\":\"a\",\"pipeline\":\"Further Works\",\"status\":\"open\"},{\"id\":\"b\",\"pipeline\":\"PPM\",\"status\":\"done\"}],\"pagination\":{\"hasMore\":true}}');
 if summary->>'recordCount'<>'2' or summary->>'hasMore'<>'true'
  or jsonb_array_length(summary->'pipelineCounts')<>2
  or jsonb_array_length(summary->'statusCounts')<>2
  or has_function_privilege('anon','public.new_dawn_commusoft_opportunity_probe_summarize(text)','EXECUTE') then
  raise exception 'synthetic_source_summary_failed';end if;
 begin
  perform public.new_dawn_commusoft_opportunity_probe_summarize(
   jsonb_build_object('data',(select jsonb_agg(jsonb_build_object('id',g)) from generate_series(1,11) g))::text);
  raise exception 'eleven_record_guard_missing';
 exception when sqlstate '22023' then null;end;
 begin
  perform public.new_dawn_commusoft_opportunity_probe_summarize('{\"data\":[{\"id\":1},{\"id\":1}]}');
  raise exception 'duplicate_source_guard_missing';
 exception when sqlstate '22023' then null;end;
end $source_fixture$;\nselect 'new-dawn-opportunities-probe-schema/1' as marker;\nrollback;`;
}
export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: rehearsalSql() }), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code = typeof problem?.code === 'string' && /^[A-Z0-9]{5}$/.test(problem.code) ? problem.code : 'unknown';
    throw Error(`TEST rollback rehearsal failed (HTTP ${response.status}, SQLSTATE ${code}): ${String(problem?.message ?? problem?.error ?? '').slice(0,240)}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.marker !== 'new-dawn-opportunities-probe-schema/1')
    throw Error('TEST rollback rehearsal receipt missing');
  return { state: 'passed_rolled_back', project: TEST_PROJECT, providerRequests: 0, featureEnabled: false };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try { console.log(JSON.stringify(await rehearse())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
