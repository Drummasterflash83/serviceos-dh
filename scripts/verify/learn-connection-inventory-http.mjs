/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import { loadConnectionsAndEvidence } from "../../supabase/functions/_shared/controlplane/connection_inventory.ts";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-connections-pages-[a-f0-9]{8}$/);
let requests = 0,
  heads = 0;
const tenant = "10000000-0000-4000-8000-000000000001";
const fetcher = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, "http://synthetic.invalid");
  assert.ok(
    [
      "/google_workspace_connections",
      "/provider_connections",
      "/google_workspace_mailboxes",
      "/telephony_inventory",
      "/operating_profile_entries",
      "/provider_connection_events",
      "/phone_sync_runs",
      "/email_sync_runs",
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
const r = await loadConnectionsAndEvidence(db, tenant, Date.parse("2026-10-11T00:00:00Z"));
assert.equal(r.connections.google_workspace.status, "disabled");
assert.equal(r.connections.google_workspace.imported, 2503);
assert.equal(r.phoneEvidence.length, 2503);
assert.equal(r.connections.telephony.status, "revoked");
assert.equal(
  Date.parse(r.connections.telephony.lifecycle.last_successful_discovery),
  Date.parse("2026-09-01"),
);
assert.equal(
  Date.parse(r.connections.telephony.lifecycle.last_failed_discovery),
  Date.parse("2026-10-01"),
);
assert.equal(
  Date.parse(r.connections.telephony.lifecycle.last_successful_sync),
  Date.parse("2026-10-10T01:00:00Z"),
);
assert.equal(r.connections.telephony.lifecycle.discovery_counts.last_run_processed, 12);
assert.doesNotMatch(JSON.stringify(r), /SYNTHETIC_PRIVATE_REF|secret_refs/);
assert.equal(heads, 10);
assert.equal(requests, 69);
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    mailboxes: 2503,
    phoneEvidence: 2503,
    unrelatedEvents: 2503,
    serverRowLimit: 137,
    requests,
    exactCountHeads: heads,
    emptyInventoryPagesReached: 5,
    foreignRowsExcluded: true,
    retainedInventoryDoesNotReactivateConnection: true,
    providerSpecificHistoricalEventsRetained: true,
    connectionTestsExcludedFromSync: true,
    latestCompletionOrderedCorrectly: true,
    secretReferencesNotReturned: true,
  }),
);
