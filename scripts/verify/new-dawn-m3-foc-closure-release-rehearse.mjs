/** Rehearse the exact guarded installer on TEST with synthetic prerequisites; roll back all. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { releaseSql, reviewedSource, TENANT, VERSION } from "./new-dawn-m3-foc-closure-release.mjs";

const sources = [
  "20261106120000_new_dawn_commusoft_job_detail_read.sql",
  "20261107110000_new_dawn_commusoft_job_operational_facts.sql",
  "20261107140000_new_dawn_commusoft_job_source_quote.sql",
  "20261107150000_new_dawn_commusoft_job_optional_source_facts.sql",
  "20261107160000_new_dawn_commusoft_job_closure_source_facts.sql",
];
function body(name) {
  const source = readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
  if (!/\nbegin;\n/i.test(source) || !/\ncommit;\s*$/i.test(source))
    throw Error("test_prerequisite_wrapper_changed");
  return source.replace(/\nbegin;\n/i, "\n").replace(/\ncommit;\s*$/i, "\n");
}
export function rehearsalSql() {
  const exact = releaseSql(reviewedSource(), true);
  if (!exact.startsWith("begin;\n") || !exact.endsWith("rollback;"))
    throw Error("release_rollback_fence_changed");
  const prefix = `begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
insert into public.tenants(id,slug,display_name,status)
 values('${TENANT}'::uuid,'synthetic-foc-release-rehearsal','Synthetic FOC release','active');
${sources.map(body).join("\n")}
`;
  return (
    prefix +
    exact.slice("begin;\n".length).replace(
      `select '${VERSION}' as installed_foc_version;`,
      `select '${VERSION}' as installed_foc_version,
 encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(
 'public.new_dawn_foc_closure_review(uuid,text)')),'UTF8')),'hex') as installed_function_sha256,
 exists(select 1 from supabase_migrations.schema_migrations where version='${VERSION}'
  and name='new_dawn_foc_closure_review' and array_length(statements,1)=1) as ledger_written;`,
    )
  );
}
export async function rehearse(fetcher = fetch, token = savedCliToken()) {
  const sql = rehearsalSql();
  if (!sql.endsWith("rollback;")) throw Error("test_rollback_fence_missing");
  const r = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: false }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => null);
    throw Error(
      `TEST release rollback failed (HTTP ${r.status}, SQLSTATE ${e?.code ?? "unknown"})`,
    );
  }
  const rows = await r.json();
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.installed_foc_version !== VERSION ||
    rows[0]?.installed_function_sha256 !==
      "f3a8d3bc8e708c35feb2f819fc89037a446a97fc5051d92ef4d30c1fe4550697" ||
    rows[0]?.ledger_written !== true
  )
    throw Error("TEST installed source receipt missing");
  const after = await fetcher(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent,
     to_regprocedure('public.new_dawn_foc_closure_review(uuid,text)') is null as function_absent,
     not exists(select 1 from public.tenants where id='${TENANT}'::uuid) as tenant_absent`,
      }),
    },
  );
  if (!after.ok) throw Error("TEST rollback readback unavailable");
  const check = (await after.json())[0];
  if (
    check?.ledger_absent !== true ||
    check?.function_absent !== true ||
    check?.tenant_absent !== true
  )
    throw Error("TEST release fixture did not roll back");
  return {
    state: "exact_release_rolled_back",
    project: TEST_PROJECT,
    version: VERSION,
    providerRequests: 0,
  };
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
