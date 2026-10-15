/** Synthetic rollback probe against the installed bounded-retry function. */
import { readFile, mkdir, open } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-rollback", "--live-rollback"].includes(mode))
  throw Error("Exact rollback mode required");
const project = mode === "--test-rollback" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const candidate = "c0f6296f051aada999af147773066cac";
const probe = await readFile("scripts/verify/learn-email-transient-retry-probe.sql", "utf8");
const signature = "public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)";
const runId = randomUUID();
const directory = ".verification-results/learn-build01-email-bounded-retry";
await mkdir(directory, { recursive: true, mode: 0o700 });
const journal = `${directory}/${mode.slice(2)}-${runId}.json`;
async function save(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}
const record = { contract: "learn-email-bounded-retry-installed-probe/1", project,
  runId, probeSha256: createHash("sha256").update(probe).digest("hex"),
  expectedDefinitionMd5: candidate, startedAt: new Date().toISOString(),
  state: "prepared_not_submitted" };
await save(journal, record);
const sql = `begin;
set local lock_timeout='3s'; set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${candidate}'
   or exists(select 1 from public.tenants where id='ec390000-cccc-4000-8000-000000000001')
 then raise exception 'installed_retry_binding_changed';end if;
end$$;
${probe}
select 'installed_retry_probe' as marker,
 (select count(*) from public.email_ingestion_transitions
  where tenant_id='ec390000-cccc-4000-8000-000000000001') as fixture_transitions;
rollback;`;
let response;
try {
  response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(60000),
  });
} catch {
  await save(`${journal}.result`, { ...record, state: "submission_uncertain" });
  throw Error("Installed retry probe submission uncertain; inspect before another attempt");
}
const rows = await response.json().catch(() => null);
const marker = Array.isArray(rows) ? rows.find((r) => r.marker === "installed_retry_probe") : null;
const result = { ...record, httpStatus: response.status,
  state: response.status === 201 && Number(marker?.fixture_transitions) === 10
    ? "installed_candidate_probed_and_rolled_back" : "requires_inspection",
  fixtureTransitions: marker?.fixture_transitions ?? null,
  diagnostic: response.status === 201 ? null :
    typeof rows?.message === "string" ? rows.message.slice(0, 300) : null,
  observedAt: new Date().toISOString() };
await save(`${journal}.result`, result);
console.log(JSON.stringify(result));
if (result.state !== "installed_candidate_probed_and_rolled_back") process.exitCode = 1;
