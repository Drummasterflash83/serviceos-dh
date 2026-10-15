/** Exact TEST rehearsal or activation for bounded Workspace fetch retry. */
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir, open } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { emailMigrationAccessBegin, emailMigrationAccessEnd } from
  "./learn-email-migration-access.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test"].includes(mode))
  throw Error("Exact TEST release mode required");
const applying = mode === "--apply-test";
const project = TEST_PROJECT;
const expected = "45a140fffe35e7e3de3597eb848cfbc2";
const candidate = "c0f6296f051aada999af147773066cac";
const signature = "public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)";
const migrationPath = "supabase/migrations/20261103190000_learn_email_bounded_fetch_retry.sql";
const probePath = "scripts/verify/learn-email-transient-retry-probe.sql";
const migration = await readFile(migrationPath, "utf8");
const probe = await readFile(probePath, "utf8");
if (!/^begin;\s*$/m.test(migration) || !/^commit;\s*$/m.test(migration))
  throw Error("Retry migration transaction boundary changed");
const body = migration.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const runId = randomUUID();
const directory = ".verification-results/learn-build01-email-bounded-retry";
await mkdir(directory, { recursive: true, mode: 0o700 });
if (applying) {
  const receipts = (await readdir(directory)).filter((name) =>
    name.startsWith("rehearse-test-") && name.endsWith(".json.result"));
  let matched = false;
  for (const name of receipts) {
    const prior = JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
    if (prior.state === "rehearsed_transaction_rolled_back" &&
      prior.migrationSha256 === sha(migration) && prior.probeSha256 === sha(probe) &&
      prior.expectedDefinitionMd5 === expected &&
      prior.candidateDefinitionMd5 === candidate &&
      Date.now() - Date.parse(prior.observedAt) < 3600000) matched = true;
  }
  if (!matched) throw Error("Fresh exact rolled-back TEST rehearsal required");
}
const journal = `${directory}/${applying ? "apply-test" : "rehearse-test"}-${runId}.json`;
const proof = {
  contract: "learn-email-bounded-retry-rehearsal/1", project, runId,
  migrationSha256: sha(migration), probeSha256: sha(probe),
  expectedDefinitionMd5: expected, state: "prepared_not_submitted",
  startedAt: new Date().toISOString(),
};
async function saveNew(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}
await saveNew(journal, proof);
const sql = `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $$begin
 if exists(select 1 from public.tenants where id='ec390000-cccc-4000-8000-000000000001')
   or md5(pg_get_functiondef('${signature}'::regprocedure))<>'${expected}'
 then raise exception 'retry_rehearsal_precondition_changed';end if;
end$$;
${emailMigrationAccessBegin}
${body}
${emailMigrationAccessEnd}
${applying ? "" : probe}
select 'bounded_retry_candidate' as marker,
 md5(pg_get_functiondef('${signature}'::regprocedure)) as candidate_md5,
 (select count(*) from public.email_ingestion_transitions
  where tenant_id='ec390000-cccc-4000-8000-000000000001') as fixture_transitions;
${applying ? "commit" : "rollback"};`;
const token = savedCliToken();
let response;
try {
  response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(90000),
  });
} catch {
  await saveNew(`${journal}.result`, { ...proof, state: "submission_uncertain" });
  throw Error("Retry rehearsal submission uncertain; inspect before any retry");
}
const rows = await response.json().catch(() => null);
const marker = Array.isArray(rows) ? rows.find((r) => r.marker === "bounded_retry_candidate") : null;
const result = { ...proof, httpStatus: response.status,
  state: response.status === 201 && marker?.candidate_md5 === candidate &&
    Number(marker?.fixture_transitions) === (applying ? 0 : 10)
    ? applying ? "applied_pending_independent_readback" :
      "rehearsed_transaction_rolled_back" : "requires_inspection",
  candidateDefinitionMd5: marker?.candidate_md5 ?? null,
  fixtureTransitions: marker?.fixture_transitions ?? null,
  diagnostic: response.status === 201 ? null :
    typeof rows?.message === "string" ? rows.message.slice(0, 300) :
    typeof rows?.error === "string" ? rows.error.slice(0, 300) : null,
  observedAt: new Date().toISOString(),
};
await saveNew(`${journal}.result`, result);
console.log(JSON.stringify(result));
if (!["rehearsed_transaction_rolled_back", "applied_pending_independent_readback"]
  .includes(result.state)) process.exitCode = 1;
