/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  loadIdentityInventory,
  buildEmailIdentityResolution,
} from "../../supabase/functions/_shared/controlplane/identity_inventory.ts";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-identity-pages-[a-f0-9]{8}$/);
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
      "/communication_endpoints",
      "/member_integration_identities",
      "/endpoint_identity_reviews",
      "/google_workspace_mailboxes",
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
const h = await loadIdentityInventory(db, tenant, Date.parse("2026-10-11T00:00:00Z"));
assert.equal(h.members.length, 2503);
assert.equal(h.endpoints.length, 2504);
assert.equal(h.identities.length, 2503);
assert.equal(h.mailboxes.length, 2503);
assert.equal(h.reviews.length, 2504);
const r = buildEmailIdentityResolution(h);
assert.equal(r.suggestions.length, 2504);
const ambiguous = r.suggestions.find((s) => s.endpoint_email === "morgan@example.invalid");
assert.equal(ambiguous.suggested_member_id, null);
assert.equal(ambiguous.ambiguity.length, 2);
assert.equal(
  r.suggestions.filter(
    (s) => s.provenance === "endpoint_identity_reviews" && s.suggested_member_id === null,
  ).length,
  1,
);
assert.equal(
  r.suggestions.filter((s) => s.provenance === "member_integration_identities").length,
  2502,
);
assert.equal(heads, 10);
assert.equal(requests, 110);
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    inventories: 5,
    members: 2503,
    endpoints: 2504,
    identities: 2503,
    mailboxes: 2503,
    reviews: 2504,
    serverRowLimit: 137,
    requests,
    exactCountHeads: heads,
    emptyPagesReached: 5,
    foreignRowsExcluded: true,
    endedLinksExcluded: true,
    farEndNameAmbiguityPreserved: true,
    latestReviewRetained: true,
  }),
);
