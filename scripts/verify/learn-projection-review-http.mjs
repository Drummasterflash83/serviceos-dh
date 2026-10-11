/** Verify denied HTTP access without adding users, sessions or grants. */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readReviewCatalog, reviewInstalledSnapshot } from "./learn-projection-review-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
if (
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
  process.argv.slice(2).join(" ") !== "--verify --existing-cli-login"
)
  throw Error("Explicit TEST scope required");
const token = savedCliToken(),
  catalog = await readReviewCatalog(token);
if (catalog.fingerprint !== "9a5ecae2a6ecf97950e36b1e1dc87132")
  throw Error("Exact TEST review schema required");
const snapshot = reviewInstalledSnapshot(catalog.catalog.phone),
  before = await communicationQuery(token, snapshot);
if (before.length !== 118) throw Error("Full preservation baseline required");
const response = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw Error("Existing TEST keys unavailable");
const keys = await response.json(),
  checks = [],
  tenant = randomUUID(),
  hold = randomUUID();
for (const role of ["anon", "service_role"]) {
  const found = keys.filter((k) => k.name === role);
  if (found.length !== 1) throw Error("Ambiguous TEST key");
  const key = found[0].api_key,
    claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  if (claims.ref !== TEST_PROJECT || claims.role !== role) throw Error("Key scope differs");
  const calls = [
    ["learn_operator_projection_reviews", { p_tenant: tenant, p_after: null }],
    ["learn_operator_projection_review_detail", { p_tenant: tenant, p_hold: hold }],
    [
      "learn_operator_projection_review",
      {
        p_tenant: tenant,
        p_actor: randomUUID(),
        p_request: randomUUID(),
        p_hold: hold,
        p_definition: {
          action: "apply_source",
          revision: "a".repeat(64),
          reason: "Synthetic denied request",
        },
        p_mode: "apply",
      },
    ],
  ];
  for (const [name, args] of calls) {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    checks.push({ role, name, status: r.status });
    if (![401, 403].includes(r.status)) throw Error("Unexpected HTTP access result");
  }
}
const after = await readReviewCatalog(token),
  rows = await communicationQuery(token, snapshot);
if (after.fingerprint !== catalog.fingerprint || stable(before) !== stable(rows))
  throw Error("Preservation unconfirmed");
const result = {
  state: "denied_access_verified",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  checks,
  preservedDatasets: 118,
  schemaUnchanged: true,
  newUsers: 0,
  newGrants: 0,
  newSessions: 0,
  providerRequests: 0,
  productionChanged: false,
};
writeFileSync(
  ".verification-results/projection-review-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
