/** Empty-queue hosted verification only: no provider credential, user or grant creation. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { exerciseEmptyWorker, EMPTY_WORKER_SNAPSHOT } from "./learn-test-commusoft-http.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import {
  CONTACT_RUNTIME_DATABASE,
  CONTACT_RUNTIME_IDLE,
  CONTACT_RUNTIME_SNAPSHOT,
  contactRuntimeSnapshot,
} from "./learn-test-commusoft-contact-runtime-deploy.mjs";
try {
  assert.equal(process.argv.slice(2).join(" "), "--verify --existing-cli-login");
  assert.equal(process.env.LEARN_TEST_ALLOW_PROJECT_REF, TEST_PROJECT);
  const token = savedCliToken();
  const idle = () => communicationQuery(token, CONTACT_RUNTIME_IDLE);
  assert.deepEqual(await idle(), [
    { active_jobs: 0, unrevoked_connections: 0, unfinished_checks: 0 },
  ]);
  const schema = await readRuntimeCatalog(token);
  assert.equal(schema.fingerprint, CONTACT_RUNTIME_DATABASE);
  const inventory = await edgeInventory(token);
  for (const slug of ["learn-commusoft-worker", "learn-commusoft-verify"]) {
    const r = inventory.find((x) => x.slug === slug);
    assert.equal(r?.version, 4);
    assert.equal(r.verify_jwt, true);
    assert.equal(r.status, "ACTIVE");
  }
  const before = contactRuntimeSnapshot(await communicationQuery(token, CONTACT_RUNTIME_SNAPSHOT));
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.ok(response.ok);
  const keys = await response.json();
  const keyFor = (role) => {
    const rows = keys.filter((k) => k.name === role);
    assert.equal(rows.length, 1);
    const key = rows[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
    assert.equal(claims.role, role);
    assert.equal(claims.ref, TEST_PROJECT);
    return key;
  };
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const invoke = async (endpoint, { method = "POST", headers = {}, body } = {}) => {
    const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${endpoint}`, {
      method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      ...(body === undefined ? {} : { body }),
    });
    return { status: r.status, data: await r.json() };
  };
  const worker = await exerciseEmptyWorker({
    anon,
    service,
    snapshot: async () => {
      const rows = await communicationQuery(token, EMPTY_WORKER_SNAPSHOT);
      assert.equal(rows.length, 1);
      return rows[0].snapshot;
    },
    invoke: (options) => invoke("learn-commusoft-worker", options),
  });
  const checks = [...worker.checks];
  for (const [label, options, status, code] of [
    ["Verification missing JWT", { body: "{}" }, 401, null],
    [
      "Verification anonymous JWT",
      {
        headers: { Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
        body: "{}",
      },
      401,
      "authentication_required",
    ],
    [
      "Verification service JWT is not user authority",
      {
        headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
        body: "{}",
      },
      401,
      "authentication_required",
    ],
    [
      "Verification GET refused",
      { method: "GET", headers: { Authorization: `Bearer ${anon}` } },
      405,
      "method_not_allowed",
    ],
  ]) {
    const r = await invoke("learn-commusoft-verify", options);
    assert.equal(r.status, status, label);
    if (code) assert.equal(r.data?.code, code, label);
    checks.push({ label, status: r.status });
  }
  assert.deepEqual(await idle(), [
    { active_jobs: 0, unrevoked_connections: 0, unfinished_checks: 0 },
  ]);
  assert.deepEqual(
    contactRuntimeSnapshot(await communicationQuery(token, CONTACT_RUNTIME_SNAPSHOT)),
    before,
  );
  assert.equal((await readRuntimeCatalog(token)).fingerprint, schema.fingerprint);
  assert.deepEqual(await edgeInventory(token), inventory);
  const report = {
    version: "learn-test-commusoft-contact-runtime-hosted/1",
    observedAt: new Date().toISOString(),
    projectRef: TEST_PROJECT,
    state: "passed",
    checks,
    preservedDataSets: before.length,
    sourceAndSchemaPreserved: true,
    limits: [
      "Gateway/authentication and empty-worker runtime checks only. No real provider call, signed-in operator, credential binding or imported record.",
    ],
  };
  writeFileSync(
    ".verification-results/commusoft-contact-runtime-hosted.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    "Hosted Commusoft acceptance did not complete; inspect saved evidence before proceeding.",
  );
  process.exitCode = 1;
}
