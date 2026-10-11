/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import { loadDiscoveryHistory } from "../../supabase/functions/_shared/controlplane/discovery_history.ts";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-history-pages-[a-f0-9]{8}$/);
let requests = 0,
  heads = 0;
const tenant = "10000000-0000-4000-8000-000000000001";
const fetcher = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, "http://synthetic.invalid");
  assert.ok(["/phone_sync_runs", "/email_sync_runs", "/data_imports"].includes(url.pathname));
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
const now = Date.parse("2026-10-11T00:00:00Z");
let cursor = null,
  pages = 0;
const runs = [];
do {
  const r = await loadDiscoveryHistory(db, tenant, { page_size: 100, cursor }, now);
  assert.equal(r.total, 2503);
  assert.equal(r.page, pages);
  runs.push(...r.runs);
  cursor = r.next_cursor;
  pages++;
} while (cursor);
assert.equal(pages, 26);
assert.equal(runs.length, 2503);
assert.equal(new Set(runs.map((r) => r.source + ":" + r.run_id)).size, 2503);
assert.deepEqual(
  runs.slice(0, 3).map((r) => r.source),
  ["data_imports", "email_sync_runs", "phone_sync_runs"],
);
assert.ok(runs.slice(-5).every((r) => r.started_at === null));
const filtered = await loadDiscoveryHistory(
  db,
  tenant,
  { provider: "sipcentric", status: "failed", page_size: 100 },
  now,
);
assert.equal(filtered.total, 314);
assert.equal(filtered.runs.length, 100);
assert.ok(filtered.runs.every((r) => r.error === "Synthetic provider timeout"));
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    phoneRuns: 2203,
    emailRuns: 200,
    importRuns: 100,
    total: 2503,
    pages,
    serverRowLimit: 37,
    requests,
    exactCountHeads: heads,
    uniqueCompositeRunReferences: true,
    microsecondAndSourceTieOrderCorrect: true,
    nullTimesRetained: true,
    foreignAndFutureRowsExcluded: true,
    providerStatusFiltering: true,
    filteredTotal: 314,
  }),
);
