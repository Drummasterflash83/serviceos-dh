/** Synthetic Drummonds-only flag ON/OFF in hosted TEST, rolled back together. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { flagSql } from "./new-dawn-m3-foc-closure-flag.mjs";
import { reviewedSource, VERSION, NAME, TENANT } from "./new-dawn-m3-foc-closure-release.mjs";

const sources = [
  "20261106120000_new_dawn_commusoft_job_detail_read.sql",
  "20261107110000_new_dawn_commusoft_job_operational_facts.sql",
  "20261107140000_new_dawn_commusoft_job_source_quote.sql",
  "20261107150000_new_dawn_commusoft_job_optional_source_facts.sql",
  "20261107160000_new_dawn_commusoft_job_closure_source_facts.sql",
];
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
function body(name) {
  const source = readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
  if (!/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error("test_prerequisite_wrapper_changed");
  return source.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
}
const unwrap = (source) =>
  source.replace(/^\s*(?:--[^\n]*\n)*begin;\s*$/im, "").replace(/\ncommit;\s*$/i, "");
function actionSql(on, auditId, reason, tenant) {
  const exact = flagSql(on, auditId, reason);
  if (!exact.startsWith("begin;\n") || !exact.endsWith("commit;"))
    throw Error("test_flag_transaction_fence_changed");
  return exact.slice("begin;\n".length, -"commit;".length).replaceAll(TENANT, tenant);
}

async function management(token, path, query, readOnly = true, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw Error(
      `TEST FOC flag rollback HTTP ${response.status}, SQLSTATE ${problem?.code ?? "unknown"}, message ${String(problem?.message ?? "unknown").slice(0, 180)}`,
    );
  }
  return response.json();
}
export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const candidates = await management(
    token,
    "/database/query/read-only",
    `select distinct l.tenant_id::text as tenant_id
   from public.learn_business_input_current_links l join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
   where l.provider='commusoft' and l.collection='jobs' and l.entity_kind='job' and l.entity_table='jobs'
    and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   order by tenant_id limit 1`,
  );
  const tenant = candidates?.[0]?.tenant_id;
  if (typeof tenant !== "string" || !/^[0-9a-f-]{36}$/.test(tenant))
    throw Error("TEST current job tenant unavailable");
  const file = reviewedSource();
  const enableId = randomUUID(),
    disableId = randomUUID();
  const enableReason = "Synthetic exact FOC operator review",
    disableReason = "Synthetic FOC rollback";
  const sql = `begin;
set local lock_timeout='3s';
set local statement_timeout='80s';
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
-- TEST uses differently named immutable-audit triggers. Install the exact LIVE
-- pair only inside this rollback transaction to rehearse the production guard.
create trigger controlplane_change_log_no_update before update on public.controlplane_change_log
 for each row execute function public.learn_operator_input_immutable();
create trigger controlplane_change_log_no_delete before delete on public.controlplane_change_log
 for each row execute function public.learn_operator_input_immutable();
${sources.map(body).join("\n")}
${file.body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${VERSION}','${NAME}',array[${quote(file.source)}]);
do $fixture$ declare x record;v public.learn_business_input_versions%rowtype;actor uuid;
begin
 select g.profile_id into actor from public.platform_authority_grants g
 join auth.users u on u.id=g.profile_id and u.deleted_at is null
 where g.permission='platform.controlplane.admin'
  and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
  and coalesce(g.effective_to,'infinity')>clock_timestamp() limit 1;
 if actor is null then raise exception 'synthetic_operator_missing';end if;
 for x in select l.*,j.id canonical_id,c.updated_at connection_revision
  from public.learn_business_input_current_links l
  join public.jobs j on j.id=l.entity_id and j.tenant_id=l.tenant_id
  join public.provider_connections c on c.id=l.connection_id and c.tenant_id=l.tenant_id
  where l.tenant_id='${tenant}'::uuid and l.provider='commusoft' and l.collection='jobs'
   and l.entity_kind='job' and l.entity_table='jobs'
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.source_system='commusoft:connection:'||l.connection_id::text
   and j.external_id=l.external_id loop
   v:=public.learn_business_input_latest(x.tenant_id,x.connection_id,'commusoft','jobs',x.external_id);
   exit when v.id=x.source_version_id;
 end loop;
 if x.canonical_id is null or v.id is distinct from x.source_version_id then
  raise exception 'synthetic_current_job_missing';end if;
 insert into public.new_dawn_commusoft_job_detail_reads(id,tenant_id,actor_id,job_id,
  connection_id,connection_revision,secret_id,source_version_id,external_id,reason,
  state,raw_sha256,checked_at,result)
 values(gen_random_uuid(),x.tenant_id,actor,x.canonical_id,x.connection_id,x.connection_revision,
  gen_random_uuid(),x.source_version_id,x.external_id,'Synthetic exact FOC closure',
  'complete',repeat('a',64),clock_timestamp(),jsonb_build_object(
   'version','commusoft-exact-job-detail/5','source_closure_facts',jsonb_build_object(
    'closedOutcome',jsonb_build_object('state','present','value','FreeOfCharge'),
    'closedOnDateTime',jsonb_build_object('state','present','value','2026-10-20T15:00:00'),
    'focReason',jsonb_build_object('state','present','value','Synthetic agreement'))));
end $fixture$;
${actionSql(true, enableId, enableReason, tenant)}
${actionSql(false, disableId, disableReason, tenant)}
select (select count(*)::int from public.feature_flags where tenant_id='${tenant}'::uuid
 and flag='new_dawn.m3_foc_closure_review' and value='true'::jsonb) as target_on,
 (select count(*)::int from public.controlplane_change_log where id in
  ('${enableId}'::uuid,'${disableId}'::uuid) and source='codex-release') as audit_count;
rollback;`;
  if (!sql.endsWith("rollback;")) throw Error("TEST flag rollback fence missing");
  const rows = await management(token, "/database/query", sql, false, fetcher);
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.target_on !== 0 ||
    rows[0]?.audit_count !== 2
  )
    throw Error("TEST flag ON/OFF or audit receipt missing");
  const after = await management(
    token,
    "/database/query/read-only",
    `select
   to_regprocedure('public.new_dawn_foc_closure_review(uuid,text)') is null as function_absent,
   not exists(select 1 from public.feature_flags where tenant_id='${tenant}'::uuid
    and flag='new_dawn.m3_foc_closure_review') as flag_absent,
   not exists(select 1 from public.controlplane_change_log where id in
    ('${enableId}'::uuid,'${disableId}'::uuid)) as audits_absent`,
    true,
    fetcher,
  );
  if (
    after?.[0]?.function_absent !== true ||
    after[0].flag_absent !== true ||
    after[0].audits_absent !== true
  )
    throw Error("TEST flag fixture did not roll back");
  return { state: "synthetic_flag_on_off_rolled_back", project: TEST_PROJECT, providerRequests: 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--test-rollback-only")
    throw Error("TEST rollback-only mode required");
  try {
    console.log(JSON.stringify(await rehearse()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
