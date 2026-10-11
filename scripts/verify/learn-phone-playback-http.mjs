/** Anonymous and service credentials cannot impersonate a signed-in playback reviewer. */
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhonePlaybackCatalog,
  phonePlaybackSourceQuery,
} from "./learn-phone-playback-catalog.mjs";
const check = (v) => {
  if (!v) throw Error("Playback HTTP acceptance unconfirmed");
};
const file = ".verification-results/phone-playback-http-result.json";
const report = { projectRef: TEST_PROJECT, state: "unconfirmed", checks: [] };
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
  );
  const token = savedCliToken(),
    installed = JSON.parse(readFileSync(".verification-results/phone-playback-apply-result.json")),
    catalog = await readPhonePlaybackCatalog(token);
  check(
    catalog.fingerprint === installed.afterFingerprint &&
      installed.state === "installed_needs_hosted_acceptance",
  );
  const snapshot =
    phonePlaybackSourceQuery(catalog.catalog.phone) +
    " union all select 'public.learn_phone_playback_audit' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_playback_audit s";
  const before = await communicationQuery(token, snapshot);
  const keysResponse = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(keysResponse.ok);
  const keys = await keysResponse.json();
  const id = "00000000-0000-4000-8000-000000000000";
  for (const role of ["anon", "service_role"]) {
    const matches = keys.filter((k) => k.name === role);
    check(matches.length === 1);
    const key = matches[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    check(claims.ref === TEST_PROJECT && claims.role === role);
    const routes = [
      [
        "recording list",
        "rest/v1/rpc/learn_phone_recordings_read",
        { p_tenant: id, p_table: "phone_calls", p_id: id },
      ],
      ["private audit", "rest/v1/learn_phone_playback_audit?select=id&limit=1", null],
      [
        "playback endpoint",
        "functions/v1/learn-phone-playback",
        { tenant_id: id, recording_id: id },
      ],
      [
        "internal impersonation",
        "functions/v1/learn-phone-playback",
        { tenant_id: id, recording_id: id },
        { "x-internal-tenant-id": id },
      ],
    ];
    if (role === "anon")
      routes.push([
        "direct authorizer",
        "rest/v1/rpc/learn_phone_playback_authorize",
        { p_tenant: id, p_actor: id, p_recording: id },
      ]);
    for (const [name, path, body, extra = {}] of routes) {
      const r = await fetch(`https://${TEST_PROJECT}.supabase.co/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      check([401, 403].includes(r.status));
      if (path.startsWith("rest/")) check(data.code === "42501");
      check(!data.url);
      report.checks.push({ role, name, status: r.status, passed: true });
    }
  }
  const after = await communicationQuery(token, snapshot),
    afterCatalog = await readPhonePlaybackCatalog(token);
  check(
    JSON.stringify(before) === JSON.stringify(after) &&
      catalog.fingerprint === afterCatalog.fingerprint,
  );
  Object.assign(report, {
    state: "http_denials_verified",
    schemaFingerprint: catalog.fingerprint,
    preservedDataSets: before.length,
    newUsers: 0,
    newGrants: 0,
    providerRequests: 0,
    positiveSignedInAcceptance: false,
  });
} catch {
  report.state = "requires_inspection";
  process.exitCode = 1;
}
report.observedAt = new Date().toISOString();
writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
