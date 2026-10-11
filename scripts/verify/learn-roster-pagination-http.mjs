/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import { loadRoster } from "../../supabase/functions/_shared/controlplane/roster.ts";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-roster-pages-[a-f0-9]{8}$/);
let requests = 0,
  heads = 0;
const tenant = "10000000-0000-4000-8000-000000000001";
const fetcher = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, "http://synthetic.invalid");
  assert.ok(
    ["/team_members", "/responsibility_assignments", "/authority_grants"].includes(url.pathname),
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
const result = await loadRoster(db, tenant, Date.parse("2026-10-11T00:00:00Z"));
for (const rows of [result.members, result.responsibilities, result.authorityGrants]) {
  assert.equal(rows.length, 2503);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2503);
  assert.ok(rows.every((r) => r.tenant_id === tenant));
}
assert.equal(result.members[0].display_name, "Member 0001");
assert.equal(result.members.at(-1).display_name, "Member 2503");
assert.equal(heads, 6);
assert.equal(requests, 66);
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    members: 2503,
    responsibilities: 2503,
    authorityGrants: 2503,
    serverRowLimit: 137,
    requests,
    exactCountHeads: heads,
    emptyPagesReached: 3,
    foreignRowsExcluded: true,
    endedAssignmentsExcluded: true,
  }),
);
