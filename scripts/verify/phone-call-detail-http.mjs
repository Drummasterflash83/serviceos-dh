/** Negative HTTP acceptance only; no login, grants, provider calls or record writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneSavedResultsCatalog,
  phoneSavedResultsSourceQuery,
} from "./learn-phone-saved-results-catalog.mjs";
import { CALL_DETAIL_BUNDLE_SHA } from "./phone-call-detail-runtime.mjs";
const check = (v, m) => {
    if (!v) throw Error(m);
  },
  sort = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST check required",
  );
  const deploy = JSON.parse(readFileSync(".verification-results/call-detail-runtime-result.json"));
  check(
    deploy.state === "deployed_needs_http_acceptance" &&
      deploy.sourceBundleSha256 === CALL_DETAIL_BUNDLE_SHA,
    "Exact deployment required",
  );
  const token = savedCliToken(),
    inventory = await edgeInventory(token),
    endpoint = inventory.find((r) => r.slug === "phone-call-detail");
  check(
    endpoint?.version === 1 && endpoint.status === "ACTIVE" && endpoint.verify_jwt === true,
    "Exact TEST endpoint required",
  );
  const schema = await readPhoneSavedResultsCatalog(token),
    sql = phoneSavedResultsSourceQuery(schema.catalog.phone),
    before = await communicationQuery(token, sql);
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(r.ok, "TEST credentials unavailable");
  const keys = await r.json();
  function key(role) {
    const found = keys.filter((k) => k.name === role);
    check(found.length === 1, "Unique TEST key required");
    const value = found[0].api_key,
      claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url"));
    check(claims.ref === TEST_PROJECT && claims.role === role, "Credential scope differs");
    return value;
  }
  const anon = key("anon"),
    service = key("service_role"),
    checks = [];
  for (const [name, headers, expected] of [
    ["no session", { apikey: anon }, 401],
    ["anonymous key", { apikey: anon, Authorization: `Bearer ${anon}` }, 401],
    [
      "service cannot impersonate reviewer",
      {
        apikey: service,
        Authorization: `Bearer ${service}`,
        "x-internal-tenant-id": "00000000-0000-4000-8000-000000000001",
      },
      403,
    ],
  ]) {
    const response = await fetch(
      `https://${TEST_PROJECT}.supabase.co/functions/v1/phone-call-detail`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ action: "detail", call_id: "00000000-0000-4000-8000-000000000003" }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    const payload = await response.json();
    check(
      response.status === expected && !payload.call && !payload.transcript,
      "Access denial differs",
    );
    if (expected === 403)
      check(response.headers.get("cache-control") === "no-store", "Missing no-store");
    checks.push({ name, status: response.status, noCallData: true });
  }
  const after = await communicationQuery(token, sql);
  check(before.length === 113 && sort(before) === sort(after), "Retained source data changed");
  const result = {
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    endpoint: {
      name: endpoint.slug,
      version: endpoint.version,
      verifyJwt: endpoint.verify_jwt,
      status: endpoint.status,
    },
    checks,
    preservedDataSets: before.length,
    positiveSignedInAcceptance: false,
    productionChanged: false,
    newUsers: 0,
    newGrants: 0,
  };
  writeFileSync(
    ".verification-results/call-detail-http-result.json",
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
} catch {
  console.error("Call detail HTTP acceptance unconfirmed; no positive user acceptance claimed.");
  process.exitCode = 1;
}
