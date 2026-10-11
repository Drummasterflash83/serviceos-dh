/** Called only by the isolated Docker runner. No hosted requests or credentials. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PostgrestClient } from "@supabase/postgrest-js";
import { verifyMeasurementReceipts } from "../../src/lib/learn-measurement-receipts.ts";
import { fixtures, id } from "./learn-measurement-receipts-fixture.mjs";
const container = process.argv[2],
  docker = process.argv[3];
assert.match(container ?? "", /^serviceos-receipt-bindings-[a-f0-9]{8}$/);
let requests = 0,
  heads = 0;
const tenant = id(1);
const fetcher = async (input, init) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  assert.equal(url.origin, "http://synthetic.invalid");
  assert.ok(
    [
      "/learn_work_measurement_runs",
      "/learn_team_work_measurement_runs",
      "/learn_work_collection_runs",
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
await verifyMeasurementReceipts(
  db,
  tenant,
  fixtures.map((f) => f.m),
);
await assert.rejects(
  verifyMeasurementReceipts(db, tenant, [{ ...fixtures[0].m, value: 99 }]),
  /No score/,
);
await assert.rejects(
  verifyMeasurementReceipts(db, tenant, [
    { ...fixtures[0].m, period: { ...fixtures[0].m.period, start: "2026-10-01T00:00:00.000002Z" } },
  ]),
  /No score/,
);
console.log(
  JSON.stringify({
    state: "passed",
    transport: "isolated PostgREST + installed PostgrestClient",
    collectorShapes: fixtures.length,
    receiptTables: 3,
    requests,
    exactCounts: true,
    jsonProjectionTypesVerified: true,
    microsecondMismatchRejected: true,
    valueMismatchRejected: true,
    hostedAuthorizationAcceptance: false,
  }),
);
