/** Read-only production caller binding check. Never returns credential values,
 * invokes a function, pauses capture, or changes deployment configuration. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
if (process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== project)
  throw Error("Explicit production read-only target required");
const output = process.argv[2];
if (!/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? ""))
  throw Error("Explicit private output path required");
const candidateBytes = readFileSync("supabase/release/learn-production/runtime-candidate.manifest.json");
const candidate = JSON.parse(candidateBytes);
if (candidate.projectRef !== project || candidate.endpoints.length !== 37)
  throw Error("Unexpected runtime candidate");
const baseline = JSON.parse(readFileSync("supabase/release/learn-production/scheduled-callers.manifest.json"));
const endpoints = new Map(candidate.endpoints.map(e => [e.name, e]));
const expected = baseline.schedules.filter(s => s.endpoints.length === 1 && endpoints.has(s.endpoints[0]));
if (expected.length !== 9 || expected.some(s => s.vault_names.length !== 1 ||
    !/^[A-Z_]+$/.test(s.vault_names[0]) || !/^[a-f0-9]{32}$/.test(s.command_hash) ||
    !Number.isSafeInteger(s.jobid) || !s.schedule_header || s.bearer_header ||
    !s.vault_lookup || !s.net_http_post || endpoints.get(s.endpoints[0]).verifyJwt !== false))
  throw Error("Unexpected schedule scope or candidate gateway requirement");
const token = savedCliToken();
async function api(path, query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: query ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, ...(query ? { "Content-Type": "application/json" } : {}) },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    // A failed metadata query may explain a missing catalog function. Keep the
    // raw diagnostic private, never log request headers or successful bindings.
    writeFileSync(output + ".error", JSON.stringify({status:r.status, diagnostic:body}), {mode:0o600});
    throw Error(`Production metadata HTTP ${r.status}`);
  }
  return r.json();
}
const names = expected.map(s => `'${s.vault_names[0]}'`).join(",");
// The restricted metadata role cannot decrypt Vault. Use the already-authorised
// management connection inside an explicit READ ONLY transaction; return hashes only.
const observations = await api("/database/query", `begin transaction read only;
  select j.jobid,j.jobname,j.schedule,j.active,md5(j.command) command_hash,
    (select coalesce(jsonb_agg(jsonb_build_object('name',s.name,
      'fingerprint',encode(sha256(convert_to(s.decrypted_secret,'UTF8')),'hex'))),'[]')
     from vault.decrypted_secrets s where s.name in (${names})) bindings
  from cron.job j where j.jobid in (${expected.map(s => s.jobid).join(",")}) order by j.jobid; commit;`);
const secrets = await api("/secrets");
const functions = await api("/functions");
const checks = expected.map(s => {
  const row = observations.filter(o => o.jobid === s.jobid);
  const observed = row[0];
  const name = s.vault_names[0], endpoint = s.endpoints[0];
  const vault = observed?.bindings?.filter(b => b.name === name) ?? [];
  const edge = secrets.filter(e => e.name === name);
  const fn = functions.filter(f => f.slug === endpoint);
  const before = endpoints.get(endpoint).beforeProduction;
  return {
    jobId: s.jobid, jobName: s.jobname, endpoint, secretName: name,
    schedule: s.schedule, commandHash: s.command_hash,
    scheduleUnchanged: row.length === 1 && observed.command_hash === s.command_hash &&
      observed.jobname === s.jobname && observed.schedule === s.schedule && observed.active === s.active,
    credentialBindingMatches: vault.length === 1 && edge.length === 1 &&
      /^[a-f0-9]{64}$/.test(vault[0].fingerprint) &&
      (edge[0].digest ?? edge[0].value) === vault[0].fingerprint,
    runtimeUnchanged: fn.length === 1 && fn[0].id === before.id && fn[0].version === before.version &&
      fn[0].ezbr_sha256 === before.hash && fn[0].status === before.status && fn[0].verify_jwt === before.jwt,
    currentGatewayAcceptsScheduleHeader: fn.length === 1 && fn[0].verify_jwt === false,
    candidateGatewayAcceptsScheduleHeader: endpoints.get(endpoint).verifyJwt === false,
  };
});
const passed = checks.every(c => c.scheduleUnchanged && c.credentialBindingMatches &&
  c.runtimeUnchanged && c.currentGatewayAcceptsScheduleHeader && c.candidateGatewayAcceptsScheduleHeader);
const report = {
  version: "learn-production-scheduled-callers/1", observedAt: new Date().toISOString(), project,
  state: passed ? "existing_schedule_bindings_match" : "caller_binding_check_failed",
  manifestSha256: createHash("sha256").update(candidateBytes).digest("hex"), checks,
  productionChanges: 0, functionInvocations: 0, providerRequests: 0, credentialValuesRetained: false,
  limitations: [
    "Confirms the current Vault-to-runtime credential fingerprints and header/gateway compatibility; does not invoke a scheduler or prove candidate execution.",
    "Nine statically observed candidate schedule targets only. Other dynamic callers and in-flight requests still need release review.",
    "Does not close signed-in acceptance, thirteen changed function gateway flags, new Slack/Commusoft worker provisioning or release approval.",
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ state: report.state, checks: checks.length,
  failures: checks.filter(c => !c.scheduleUnchanged || !c.credentialBindingMatches || !c.runtimeUnchanged ||
    !c.currentGatewayAcceptsScheduleHeader || !c.candidateGatewayAcceptsScheduleHeader), productionChanges: 0 }));
if (!passed) process.exitCode = 1;
