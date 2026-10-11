/** Hosted TEST canonical card-search access boundary only. Creates no identities, grants or fixtures. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
if (process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST target required");
const response = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${savedCliToken()}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok) throw Error("TEST keys unavailable");
const keys = await response.json(),
  id = randomUUID();
const endpoints = ["customer", "job", "member", "team"].map((p_kind) => [
  "rpc/learn_card_search",
  { p_tenant: id, p_kind, p_query: "Synthetic access probe", p_page: 0, p_group: null },
]);
const checks = [];
for (const role of ["anon", "service_role"]) {
  const key = keys.find((k) => k.name === role)?.api_key;
  if (typeof key !== "string" || key.split(".").length !== 3) throw Error("TEST key unavailable");
  const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  if (claims.role !== role || claims.ref !== TEST_PROJECT) throw Error("Wrong TEST key");
  for (const [path, body] of endpoints) {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/${path}`, {
      method: body ? "POST" : "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    if (![401, 403].includes(r.status) || data.code !== "42501")
      throw Error(`Expected permission denial not confirmed: ${role} ${path} HTTP ${r.status}`);
    checks.push({
      role,
      path,
      ...(body?.p_kind ? { kind: body.p_kind } : {}),
      ...(body?.p_part ? { part: body.p_part } : {}),
      status: r.status,
      code: data.code,
    });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  checks,
  signedInOwnerAcceptance: false,
};
writeFileSync(
  ".verification-results/card-search-http-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    observedAt: report.observedAt,
    projectRef: TEST_PROJECT,
    checks: checks.length,
    signedInOwnerAcceptance: false,
  }),
);
