/** Pinned rollback-first release for an ordinary claim after exact provider proof. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { emailMigrationAccessBegin, emailMigrationAccessEnd } from "./learn-email-migration-access.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--rehearse-test", "--apply-test", "--smoke-test", "--rehearse-live",
  "--apply-live", "--smoke-live"].includes(mode)) throw Error("Exact recovery release mode required");
const live = mode.endsWith("-live"), apply = mode.startsWith("--apply-"),
  smoke = mode.startsWith("--smoke-");
const project = live ? "tgbnakbxwcqjeimygroz" : TEST_PROJECT;
const prior = "1b978429b0f1ee916b545f5c56953739";
const candidate = "da6714f06b6287a80950329c7f4c43d1";
const signature = "public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)";
const helper = "public.learn_email_recent_profile_proof(uuid,uuid,uuid,bigint)";
const migration = await readFile("supabase/migrations/20261103195000_learn_email_verified_delegation_claim.sql", "utf8");
const probe = await readFile("scripts/verify/learn-email-verified-delegation-probe.sql", "utf8");
if (!/^begin;\s*$/m.test(migration) || !/^commit;\s*$/m.test(migration))
  throw Error("Migration transaction boundary changed");
const body = migration.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const directory = ".verification-results/learn-build01-email-verified-delegation";
await mkdir(directory, { recursive: true, mode: 0o700 });
if ((apply || smoke || live) && !candidate)
  throw Error("Pinned TEST candidate digest required before apply, smoke or LIVE release");
const token = savedCliToken();
async function query(readOnly, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(90000),
  });
  return { status: response.status, rows: await response.json().catch(() => null) };
}
const installed = await query(true, `select md5(pg_get_functiondef('${signature}'::regprocedure)) digest,
  to_regprocedure('${helper}') is not null helper_exists`);
if (installed.status !== 201 || !Array.isArray(installed.rows) || installed.rows.length !== 1)
  throw Error("Current recovery catalog unavailable");
if (smoke ? installed.rows[0].digest !== candidate || !installed.rows[0].helper_exists :
  installed.rows[0].digest !== prior || installed.rows[0].helper_exists)
  throw Error("Exact installed recovery baseline changed");
if (apply) {
  const receipts = (await readdir(directory)).filter((name) =>
    name.startsWith(live ? "rehearse-live-" : "rehearse-test-") && name.endsWith(".result"));
  const results = await Promise.all(receipts.map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}`, "utf8"))));
  if (!results.some((r) => r.state === "rollback_rehearsal_passed" && r.project === project &&
    r.candidateDigest === candidate && r.migrationSha256 === sha(migration) &&
    r.probeSha256 === sha(probe) && Date.now() - Date.parse(r.observedAt) < 3600000))
    throw Error("Fresh exact rollback rehearsal required");
}
if (live) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select md5(pg_get_functiondef('${signature}'::regprocedure)) digest` }),
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
  const rows = response.ok ? await response.json() : null;
  if (!Array.isArray(rows) || rows[0]?.digest !== candidate)
    throw Error("Installed TEST candidate required before LIVE release");
  const results = await Promise.all((await readdir(directory)).filter((name) =>
    name.startsWith("smoke-test-") && name.endsWith(".result")).map(async (name) =>
    JSON.parse(await readFile(`${directory}/${name}`, "utf8"))));
  if (!results.some((r) => r.state === "installed_smoke_passed" &&
    r.project === TEST_PROJECT && r.candidateDigest === candidate &&
    Date.now() - Date.parse(r.observedAt) < 3600000))
    throw Error("Fresh installed TEST smoke required before LIVE release");
}
const runId = randomUUID();
const journal = `${directory}/${mode.slice(2)}-${runId}.json`;
async function save(path, value) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
}
const base = { contract: "learn-email-verified-delegation-release/1", mode, project, runId,
  migrationSha256: sha(migration), probeSha256: sha(probe), priorDigest: prior,
  startedAt: new Date().toISOString() };
await save(journal, { ...base, state: "prepared_not_submitted" });
const sql = smoke ? `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
grant email_ingestion_protocol_owner to postgres with set true granted by postgres;
${probe}
revoke email_ingestion_protocol_owner from postgres granted by postgres;
select 'profile_claim_probe' marker,
 md5(pg_get_functiondef('${signature}'::regprocedure)) digest,
 (select count(*) from public.email_ingestion_transitions where tenant_id='ec394000-cccc-4000-8000-000000000001') fixture_transitions;
rollback;` : `begin;
set local lock_timeout='3s'; set local statement_timeout='45s';
do $$begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${prior}'
   or to_regprocedure('${helper}') is not null
   or exists(select 1 from public.tenants where id='ec394000-cccc-4000-8000-000000000001')
 then raise exception 'profile_claim_prior_changed'; end if;
end$$;
${emailMigrationAccessBegin}
${body}
${apply ? "" : `grant email_ingestion_protocol_owner to postgres with set true granted by postgres;
${probe}
grant email_ingestion_protocol_owner to postgres with set false granted by postgres;`}
${emailMigrationAccessEnd}
select 'profile_claim_probe' marker,
 md5(pg_get_functiondef('${signature}'::regprocedure)) digest,
 to_regprocedure('${helper}') is not null helper_exists,
 (select count(*) from public.email_ingestion_transitions where tenant_id='ec394000-cccc-4000-8000-000000000001') fixture_transitions;
${apply ? "commit" : "rollback"};`;
let response;
try { response = await query(false, sql); }
catch {
  await save(`${journal}.result`, { ...base, state: "submission_uncertain" });
  throw Error("Recovery submission uncertain; inspect before retry");
}
const marker = Array.isArray(response.rows) ? response.rows.find((r) => r.marker === "profile_claim_probe") : null;
const digest = marker?.digest ?? null;
const passed = response.status === 201 && !!marker &&
  (candidate ? digest === candidate : !apply && !smoke && /^[a-f0-9]{32}$/.test(digest) && digest !== prior) &&
  Number(marker.fixture_transitions) === (apply ? 0 : 1) && (smoke || marker.helper_exists === true);
const state = passed ? (smoke ? "installed_smoke_passed" : apply ?
  "applied_pending_independent_readback" : "rollback_rehearsal_passed") : "requires_inspection";
const result = { ...base, state, httpStatus: response.status, candidateDigest: digest,
  fixtureTransitions: marker?.fixture_transitions ?? null,
  observedAt: new Date().toISOString(),
  diagnostic: response.status === 201 ? null :
    typeof response.rows?.message === "string" ? response.rows.message.slice(0, 300) : null };
await save(`${journal}.result`, result);
console.log(JSON.stringify(result));
if (!passed) process.exitCode = 1;
