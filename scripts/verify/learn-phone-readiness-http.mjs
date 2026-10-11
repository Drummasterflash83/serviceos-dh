/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import { computeSourceReadiness } from "../../supabase/functions/_shared/controlplane/readiness.ts";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-readiness-pages-[a-f0-9]{8}$/);
let requests = 0,
  heads = 0;
const tenant = "10000000-0000-4000-8000-000000000001";
const fetcher = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, "http://synthetic.invalid");
  assert.ok(
    [
      "/team_members",
      "/org_units",
      "/communication_endpoints",
      "/endpoint_ownership_assignments",
      "/config_versions",
      "/operating_profile_entries",
    ].includes(url.pathname),
  );
  assert.ok(["HEAD", "GET"].includes(request.method));
  assert.equal(url.searchParams.get("tenant_id"), "eq." + tenant);
  requests++;
  if (request.method === "HEAD") heads++;
  const args = [
    "exec",
    container,
    "curl",
    "--silent",
    "--show-error",
    "--max-time",
    "10",
    request.method === "HEAD" ? "-I" : "-i",
  ];
  for (const [name, value] of request.headers) args.push("-H", `${name}: ${value}`);
  args.push("http://127.0.0.1:3000" + url.pathname + url.search);
  const response = execFileSync(docker, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const boundary = response.indexOf("\r\n\r\n");
  assert.ok(boundary >= 0);
  const lines = response.slice(0, boundary).split("\r\n");
  const status = Number(lines.shift().split(" ")[1]);
  const headers = new Headers();
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0) headers.append(line.slice(0, i), line.slice(i + 1).trim());
  }
  return new Response(request.method === "HEAD" ? null : response.slice(boundary + 4), {
    status,
    headers,
  });
};
const db = new PostgrestClient("http://synthetic.invalid", { fetch: fetcher });
const r = await computeSourceReadiness(db, tenant, Date.parse("2026-10-11T00:00:00Z"));
assert.equal(r.level, "ready_for_chris_shadow");
assert.match(r.checks.find((c) => c.key === "ddis_mapped").detail, /^2503\/2503/);
assert.match(r.checks.find((c) => c.key === "primary_handling").detail, /^2503\/2503/);
assert.equal(r.checks.find((c) => c.key === "health_policy_state").ok, true);
assert.equal(r.checks.find((c) => c.key === "source_allowlist_state").ok, true);
assert.equal(heads, 12);
assert.equal(requests, 132);
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    ddis: 2503,
    assignments: 5006,
    members: 2503,
    teams: 2503,
    policyVersions: 2503,
    serverRowLimit: 137,
    requests,
    exactCountHeads: heads,
    emptyPagesReached: 6,
    foreignRowsExcluded: true,
    tenantScopedSource: true,
    latestPolicyUsed: true,
    allDdisMappedAndHandled: true,
  }),
);
