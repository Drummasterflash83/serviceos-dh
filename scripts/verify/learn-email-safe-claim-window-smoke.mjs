/** Synthetic rollback probe against the installed failure-window guard. */
import { readFile, mkdir, open } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { emailMigrationAccessBegin, emailMigrationAccessEnd } from
  "./learn-email-migration-access.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-rollback", "--live-rollback"].includes(mode))
  throw Error("Exact installed safe-claim probe mode required");
const project = mode === "--test-rollback" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const candidate = "1b978429b0f1ee916b545f5c56953739";
const signature = "public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)";
const probe = (await readFile("scripts/verify/learn-email-safe-claim-probe.sql", "utf8")) +
  "\n" + (await readFile("scripts/verify/learn-email-safe-claim-window-probe.sql", "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const directory = ".verification-results/learn-build01-email-safe-claim-window";
await mkdir(directory, { recursive: true, mode: 0o700 });
const runId = randomUUID();
const journal = `${directory}/${mode.slice(2)}-${runId}.json`;
async function save(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}
const proof = { contract: "learn-email-safe-claim-window-installed-probe/1", project,
  runId, probeSha256: sha(probe), expectedDefinitionMd5: candidate,
  state: "prepared_not_submitted", startedAt: new Date().toISOString() };
await save(journal, proof);
const sql = `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
do $$begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${candidate}'
   or exists(select 1 from public.tenants where id='ec393000-cccc-4000-8000-000000000001')
 then raise exception 'safe_claim_smoke_binding_changed';end if;
end$$;
${emailMigrationAccessBegin}
grant email_ingestion_protocol_owner to postgres with set true granted by postgres;
${probe}
grant email_ingestion_protocol_owner to postgres with set false granted by postgres;
${emailMigrationAccessEnd}
select 'installed_safe_claim_probe' as marker,
 (select count(*) from public.email_ingestion_transitions
  where tenant_id='ec393000-cccc-4000-8000-000000000001') as fixture_transitions;
rollback;`;
let response;
try {
  response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(90000),
  });
} catch {
  await save(`${journal}.result`, { ...proof, state: "submission_uncertain" });
  throw Error("Installed safe-claim probe uncertain; inspect before retry");
}
const rows = await response.json().catch(() => null);
const marker = Array.isArray(rows) ? rows.find((r) => r.marker === "installed_safe_claim_probe") : null;
const result = { ...proof, httpStatus: response.status,
  state: response.status === 201 && Number(marker?.fixture_transitions) === 11
    ? "installed_safe_claim_probed_and_rolled_back" : "requires_inspection",
  fixtureTransitions: marker?.fixture_transitions ?? null,
  diagnostic: response.status === 201 ? null :
    typeof rows?.message === "string" ? rows.message.slice(0, 300) : null,
  observedAt: new Date().toISOString() };
await save(`${journal}.result`, result);
console.log(JSON.stringify(result));
if (result.state !== "installed_safe_claim_probed_and_rolled_back") process.exitCode = 1;
