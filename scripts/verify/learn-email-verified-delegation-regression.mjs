/** Installed TEST/LIVE fetch-retry regression, fully rolled back. */
import { readFile } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const project = mode === "--test-rollback" ? TEST_PROJECT :
  mode === "--live-rollback" ? "tgbnakbxwcqjeimygroz" : null;
if (!project) throw Error("Exact TEST/LIVE rollback mode required");
const probe = (await readFile("scripts/verify/learn-email-safe-claim-probe.sql", "utf8")) +
  "\n" + (await readFile("scripts/verify/learn-email-safe-claim-window-probe.sql", "utf8"));
const sql = `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
do $$begin
 if md5(pg_get_functiondef('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure))<>'da6714f06b6287a80950329c7f4c43d1'
   or exists(select 1 from public.tenants where id='ec393000-cccc-4000-8000-000000000001')
 then raise exception 'installed_profile_recovery_changed'; end if;
end$$;
grant email_ingestion_protocol_owner to postgres with set true granted by postgres;
${probe}
revoke email_ingestion_protocol_owner from postgres granted by postgres;
select 'fetch_retry_regression' marker,
 (select count(*) from public.email_ingestion_transitions
   where tenant_id='ec393000-cccc-4000-8000-000000000001') fixture_transitions;
rollback;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query: sql }),
  redirect: "error", signal: AbortSignal.timeout(90000),
});
const rows = await response.json().catch(() => null);
const marker = Array.isArray(rows) ? rows.find((r) => r.marker === "fetch_retry_regression") : null;
const passed = response.status === 201 && marker?.fixture_transitions === 11;
console.log(JSON.stringify({ project, state: passed ? "rollback_regression_passed" :
  "requires_inspection", fixtureTransitions: marker?.fixture_transitions ?? null,
  diagnostic: response.ok ? null : rows?.message?.slice(0, 220) ?? null }));
if (!passed) process.exitCode = 1;
