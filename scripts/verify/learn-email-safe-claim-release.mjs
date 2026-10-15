/** Pinned TEST/LIVE release for ordinary system-labelled fetch-block claims. */
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, mkdir, open } from "node:fs/promises";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { emailMigrationAccessBegin, emailMigrationAccessEnd } from
  "./learn-email-migration-access.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--rehearse-live", "--apply-live"].includes(mode))
  throw Error("Exact safe-claim release mode required");
const live = mode.endsWith("-live");
const applying = mode.startsWith("--apply-");
const project = live ? "tgbnakbxwcqjeimygroz" : TEST_PROJECT;
const prior = "c0f6296f051aada999af147773066cac";
const candidate = "9828de434ae0713dfd544da6ce0a1345";
const signature = "public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)";
const migration = await readFile(
  "supabase/migrations/20261103193000_learn_email_safe_fetch_claim.sql", "utf8");
const probe = await readFile("scripts/verify/learn-email-safe-claim-probe.sql", "utf8");
if (!/^begin;\s*$/m.test(migration) || !/^commit;\s*$/m.test(migration))
  throw Error("Safe-claim migration boundary changed");
const body = migration.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const directory = ".verification-results/learn-build01-email-safe-claim";
await mkdir(directory, { recursive: true, mode: 0o700 });
if (live) {
  const testBinding = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
      method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query: `select md5(pg_get_functiondef(
        '${signature}'::regprocedure)) as digest` }),
      redirect: "error", signal: AbortSignal.timeout(45000),
    });
  const testRows = testBinding.ok ? await testBinding.json() : null;
  if (!Array.isArray(testRows) || testRows.length !== 1 ||
    testRows[0]?.digest !== candidate)
    throw Error("Installed TEST safe-claim binding changed");
  const smoke = (await readdir(directory)).filter((name) =>
    name.startsWith("test-rollback-") && name.endsWith(".json.result"));
  const smokeReceipts = await Promise.all(smoke.map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}`, "utf8"))));
  if (!smokeReceipts.some((r) =>
    r.state === "installed_safe_claim_probed_and_rolled_back" &&
      r.project === TEST_PROJECT && r.expectedDefinitionMd5 === candidate &&
      r.probeSha256 === sha(probe) &&
      Date.now() - Date.parse(r.observedAt) < 3600000))
    throw Error("Fresh installed TEST safe-claim proof required");
}
if (applying) {
  const receipts = (await readdir(directory)).filter((name) =>
    name.startsWith(live ? "rehearse-live-" : "rehearse-test-") &&
      name.endsWith(".json.result"));
  const priorReceipts = await Promise.all(receipts.map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}`, "utf8"))));
  if (applying && !priorReceipts.some((r) =>
      r.state === "rehearsed_transaction_rolled_back" &&
      r.project === project && r.migrationSha256 === sha(migration) &&
      r.probeSha256 === sha(probe) &&
      r.candidateDefinitionMd5 === candidate &&
      Date.now() - Date.parse(r.observedAt) < 3600000))
    throw Error("Fresh exact rollback rehearsal required");
}
const runId = randomUUID();
const journal = `${directory}/${mode.slice(2)}-${runId}.json`;
const proof = { contract: "learn-email-safe-claim-release/1", project, runId,
  migrationSha256: sha(migration), probeSha256: sha(probe), priorDefinitionMd5: prior,
  state: "prepared_not_submitted", startedAt: new Date().toISOString() };
async function save(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}
await save(journal, proof);
const sql = `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
do $$begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${prior}'
   or exists(select 1 from public.tenants where id='ec393000-cccc-4000-8000-000000000001')
 then raise exception 'safe_claim_prior_changed';end if;
end$$;
${emailMigrationAccessBegin}
${body}
${applying ? "" : `grant email_ingestion_protocol_owner to postgres with set true granted by postgres;
${probe}
grant email_ingestion_protocol_owner to postgres with set false granted by postgres;`}
${emailMigrationAccessEnd}
select 'safe_claim_candidate' as marker,
 md5(pg_get_functiondef('${signature}'::regprocedure)) as candidate_md5,
 (select count(*) from public.email_ingestion_transitions
  where tenant_id='ec393000-cccc-4000-8000-000000000001') as fixture_transitions;
${applying ? "commit" : "rollback"};`;
let response;
try {
  response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(90000),
  });
} catch {
  await save(`${journal}.result`, { ...proof, state: "submission_uncertain" });
  throw Error("Safe-claim submission uncertain; inspect before retry");
}
const rows = await response.json().catch(() => null);
const marker = Array.isArray(rows) ? rows.find((r) => r.marker === "safe_claim_candidate") : null;
const digest = marker?.candidate_md5 ?? null;
const result = { ...proof, httpStatus: response.status,
  state: response.status === 201 && digest === candidate && digest !== prior &&
    Number(marker?.fixture_transitions) === (applying ? 0 : 5)
    ? applying ? "applied_pending_independent_readback" :
      "rehearsed_transaction_rolled_back" : "requires_inspection",
  candidateDefinitionMd5: digest,
  fixtureTransitions: marker?.fixture_transitions ?? null,
  diagnostic: response.status === 201 ? null :
    typeof rows?.message === "string" ? rows.message.slice(0, 300) : null,
  observedAt: new Date().toISOString() };
await save(`${journal}.result`, result);
console.log(JSON.stringify(result));
if (!["rehearsed_transaction_rolled_back", "applied_pending_independent_readback"]
  .includes(result.state)) process.exitCode = 1;
