/** Hosted TEST access boundary only. Creates no identities, grants or fixtures. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { WORKING_RELEASE_TABLES } from "./learn-working-release-catalog.mjs";
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
const scope = {
  p_tenant: id,
  p_subject: id,
  p_policy: id,
  p_revision: 1,
  p_start: "2026-10-01T00:00:00Z",
  p_end: "2026-10-02T00:00:00Z",
  p_request: id,
  p_reason: "Hosted access boundary verification",
};
const endpoints = [
  [
    "rpc/learn_work_calendar_save",
    {
      p_tenant: id,
      p_expected_revision: 0,
      p_definition: {},
      p_request: id,
      p_reason: scope.p_reason,
    },
  ],
  [
    "rpc/learn_work_calendar_publish",
    {
      p_tenant: id,
      p_version: id,
      p_expected_publication: null,
      p_request: id,
      p_reason: scope.p_reason,
    },
  ],
  ["rpc/learn_work_calendar_read", { p_tenant: id }],
  [
    "rpc/learn_work_calendar_preview",
    { p_tenant: id, p_version: id, p_start: scope.p_start, p_end: scope.p_end },
  ],
  [
    "rpc/learn_work_calendar_resolve",
    { p_tenant: id, p_kind: "save", p_request: id, p_payload: {}, p_cancel: false },
  ],
  ["rpc/learn_work_delay_record", { p_tenant: id, p_request: id, p_payload: {} }],
  ["rpc/learn_work_delay_resolve", { p_tenant: id, p_request: id, p_payload: {}, p_cancel: false }],
  ["rpc/learn_work_delay_read", { p_tenant: id, p_object: id, p_after: 0, p_through: null }],
  ["rpc/learn_work_delay_evidence", { p_tenant: id, p_object: id, p_approval: id }],
  ...["workingTime", "teamWorkingTime"].map((p_kind) => [
    "rpc/learn_work_collection_begin",
    { ...scope, p_kind },
  ]),
  ...["calendar", "workingItem"].map((p_part) => [
    "rpc/learn_work_collection_evidence",
    { p_tenant: id, p_request: id, p_part, p_after: 0 },
  ]),
  ...WORKING_RELEASE_TABLES.map((name) => [name + "?select=*&limit=1", null]),
];
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
  ".verification-results/working-release-http-result.json",
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
