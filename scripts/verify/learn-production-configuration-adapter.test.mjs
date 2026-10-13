import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProductionConfigurationAdapter,
  productionConfigurationTransport,
  configurationSecretMetadata,
} from "./learn-production-configuration-adapter.mjs";
import { createProductionRuntimeAdapter } from "./learn-production-runtime-adapter.mjs";
import { openReleaseJournal } from "./learn-production-release-journal.mjs";
import { createProductionReleaseCoordinator } from "./learn-production-release-coordinator.mjs";
import { openConfigurationReceiptStore } from "./learn-production-release-receipts.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const root = "supabase/release/learn-production/",
  project = "tgbnakbxwcqjeimygroz";
function fixture({ allowWrite = true, activation = false } = {}) {
  const bytes = readFileSync(root + "runtime-candidate.manifest.json"),
    candidate = { ...JSON.parse(bytes), manifestSha256: sha(bytes) },
    operations = JSON.parse(readFileSync(root + "release-operations.manifest.json"));
  const op = operations.operations.find(
    (o) =>
      o.id === (activation ? "activate-reviewed-input-dispatch" : "matching-server-configuration"),
  );
  const step = { id: op.id, kind: op.kind, pinSha256: op.pinSha256 };
  const keys = {
    LEARN_COMMUSOFT_WORKER_KEY: "synthetic-commusoft-trigger",
    LEARN_SLACK_WORKER_KEY: "synthetic-slack-trigger",
  };
  const secretDigests = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, sha(v)]));
  let secrets = [{ name: "EXISTING_PROVIDER_SECRET", digest: sha("unchanged-provider-value") }];
  let functions = structuredClone([
    ...candidate.endpoints.flatMap((e) => (e.beforeProduction ? [e.beforeProduction] : [])),
    ...candidate.productionEndpointsOutsideCandidate,
  ]);
  if (activation) {
    secrets.push(
      ...Object.entries(secretDigests).map(([name, digest]) => ({ name, digest })),
      { name: "LEARN_STATUS_READ_MODE", digest: sha("production_metadata_views") },
      { name: "LEARN_INPUT_DISPATCH_ENABLED", digest: sha("false") },
    );
    functions = [
      ...candidate.endpoints.map((e) => ({
        name: e.name,
        id: e.beforeProduction?.id ?? "synthetic-" + e.name,
        version: e.beforeProduction ? e.beforeProduction.version + 2 : 1,
        hash: operations.operations.find((o) => o.id === "runtime-" + e.name).contract.ezbrSha256,
        jwt: e.verifyJwt,
        status: "ACTIVE",
      })),
      ...candidate.productionEndpointsOutsideCandidate.map((e) => ({
        ...e,
        version: e.version + 1,
      })),
    ];
  }
  const baseline = {
    projectRef: project,
    candidateSha256: candidate.manifestSha256,
    stepId: step.id,
    stepPinSha256: step.pinSha256,
    secrets: structuredClone(secrets),
    functions: structuredClone(functions),
  };
  const calls = [];
  let lost = false,
    partial = false,
    wrongSecret = false;
  async function api(r) {
    calls.push({ method: r.method, path: r.path, names: r.json?.map((v) => v.name) });
    if (r.method === "GET")
      return r.path.endsWith("/secrets")
        ? structuredClone(secrets)
        : functions.map((r) => ({
            slug: r.name,
            id: r.id,
            version: r.version,
            ezbr_sha256: r.hash,
            verify_jwt: r.jwt,
            status: r.status,
          }));
    const rows = partial ? r.json.slice(0, 1) : r.json;
    for (const r of rows) {
      const existing = secrets.find((s) => s.name === r.name);
      if (existing) existing.digest = sha(r.value);
      else secrets.push({ name: r.name, digest: sha(r.value) });
    }
    for (const f of functions) f.version++;
    if (lost) throw Error("Synthetic lost acknowledgement");
    return {};
  }
  const options = {
    candidate,
    operations,
    baseline,
    desiredSecretDigests: secretDigests,
    api,
    allowWrite,
    readSecret: async (n) => (wrongSecret ? "wrong-synthetic-key" : keys[n]),
    assertApprovedRelease: async (s) => ({
      projectRef: project,
      stepPinSha256: s.pinSha256,
      approvalEvidenceSha256: "a".repeat(64),
    }),
  };
  const adapter = createProductionConfigurationAdapter(options);
  return {
    adapter,
    options,
    candidate,
    operations,
    baseline,
    step,
    calls,
    secrets,
    functions,
    secretDigests,
    keys,
    api,
    lose: () => {
      lost = true;
    },
    partial: () => {
      partial = true;
    },
    wrong: () => {
      wrongSecret = true;
    },
  };
}
const writes = (f) => f.calls.filter((c) => c.method === "POST");
test("stage four settings without replacing existing credentials; observe exact runtime refresh", async () => {
  const f = fixture();
  assert.equal((await f.adapter.observe(f.step)).state, "ready");
  await f.adapter.apply(f.step);
  const after = await f.adapter.observe(f.step);
  assert.equal(after.state, "applied");
  assert.equal(writes(f).length, 1);
  assert.deepEqual(
    writes(f)[0].names.sort(),
    [
      "LEARN_COMMUSOFT_WORKER_KEY",
      "LEARN_INPUT_DISPATCH_ENABLED",
      "LEARN_SLACK_WORKER_KEY",
      "LEARN_STATUS_READ_MODE",
    ].sort(),
  );
  assert.equal(
    f.secrets.find((r) => r.name === "EXISTING_PROVIDER_SECRET").digest,
    sha("unchanged-provider-value"),
  );
  assert.equal(
    f.secrets.find((r) => r.name === "LEARN_INPUT_DISPATCH_ENABLED").digest,
    sha("false"),
  );
  assert.ok(!JSON.stringify(after).includes(f.keys.LEARN_SLACK_WORKER_KEY));
  await assert.rejects(f.adapter.apply(f.step), /precondition/);
  assert.equal(writes(f).length, 1);
});
test("activation changes only dispatch after matched runtime; missing trigger or bad runtime blocks construction", async () => {
  const f = fixture({ activation: true });
  await f.adapter.apply(f.step);
  assert.deepEqual(writes(f)[0].names, ["LEARN_INPUT_DISPATCH_ENABLED"]);
  assert.equal((await f.adapter.observe(f.step)).state, "applied");
  const missing = fixture({ activation: true });
  missing.options.baseline.secrets = missing.baseline.secrets.filter(
    (r) => r.name !== "LEARN_SLACK_WORKER_KEY",
  );
  assert.throws(() => createProductionConfigurationAdapter(missing.options), /prepared trigger/);
  const wrong = fixture({ activation: true });
  wrong.baseline.functions[0].hash = "f".repeat(64);
  assert.throws(() => createProductionConfigurationAdapter(wrong.options), /matched runtime/);
});
test("lost response reconciles in journal without resending secrets", async (t) => {
  const f = fixture();
  f.lose();
  const dir = mkdtempSync(join(tmpdir(), "learn-configuration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const journal = openReleaseJournal(
    join(dir, "journal"),
    {
      version: "learn-production-release-sequence/1",
      projectRef: project,
      candidateSha256: f.candidate.manifestSha256,
      steps: [f.step],
    },
    { create: true },
  );
  try {
    const ports = {
      observe: f.adapter.observe,
      apply: f.adapter.apply,
      authorize: async () => "a".repeat(64),
    };
    assert.equal((await journal.next(ports)).state, "unknown_outcome");
    assert.equal((await journal.next(ports)).state, "sequence_verified");
    assert.equal(writes(f).length, 1);
  } finally {
    journal.close();
  }
});
test("partial write, unrelated credential mutation, code/permission drift and version jumps stay unaccepted", async () => {
  for (const kind of ["partial", "secret", "code", "jwt", "version", "extra"]) {
    const f = fixture();
    if (kind === "partial") f.partial();
    await f.adapter.apply(f.step);
    if (kind === "secret") f.secrets[0].digest = "f".repeat(64);
    if (kind === "code") f.functions[0].hash = "f".repeat(64);
    if (kind === "jwt") f.functions[0].jwt = !f.functions[0].jwt;
    if (kind === "version") f.functions[0].version++;
    if (kind === "extra") f.secrets.push({ name: "UNREVIEWED_SECRET", digest: "f".repeat(64) });
    assert.equal((await f.adapter.observe(f.step)).state, "drift", kind);
    await assert.rejects(f.adapter.apply(f.step), /precondition/);
    assert.equal(writes(f).length, 1);
  }
});
test("read-only, wrong secret, changed scope and incorrect baseline block all writes", async () => {
  const f = fixture({ allowWrite: false });
  await assert.rejects(f.adapter.apply(f.step), /read-only/);
  assert.equal(f.calls.length, 0);
  const bad = fixture();
  bad.wrong();
  await assert.rejects(bad.adapter.apply(bad.step), /binding differs/);
  assert.equal(writes(bad).length, 0);
  const changed = fixture();
  await assert.rejects(
    changed.adapter.apply({ ...changed.step, pinSha256: "f".repeat(64) }),
    /pin differs/,
  );
  changed.baseline.functions[0].version++;
  assert.throws(() => createProductionConfigurationAdapter(changed.options), /baseline differs/);
  const bound = fixture();
  bound.baseline.secrets.push({ name: "LEARN_SLACK_WORKER_KEY", digest: "f".repeat(64) });
  assert.throws(() => createProductionConfigurationAdapter(bound.options), /trigger binding/);
});
test("runtime adapter accepts only the exact configuration refresh receipt before uploads", async () => {
  const f = fixture();
  await f.adapter.apply(f.step);
  const receipt = await f.adapter.receipt(f.step);
  const runtime = createProductionRuntimeAdapter({
    candidate: f.candidate,
    operations: f.operations,
    configurationRefresh: receipt,
    readBody: () => Buffer.alloc(0),
    api: async (r) => {
      if (r.method === "GET") return f.api(r);
      if (r.json.query.includes("to_regclass")) return [{ ledger_present: true }];
      return f.candidate.database.map((d, i) => ({
        migration_name: "fixture-" + i,
        source_sha256: d.sha256,
        project_ref: project,
      }));
    },
  });
  const checked = await runtime.inspect();
  assert.equal(checked.unrelatedEndpointsUnchanged, true);
  assert.ok(checked.endpoints.every((e) => e.state === "ready"));
  const forged = structuredClone(receipt);
  forged.after[0].version++;
  assert.throws(
    () =>
      createProductionRuntimeAdapter({
        candidate: f.candidate,
        operations: f.operations,
        configurationRefresh: forged,
      }),
    /receipt differs/,
  );
});
test("transport permits only exact project and pinned values, strips upstream errors, never retries", async () => {
  let count = 0;
  const api = productionConfigurationTransport("synthetic-management-token-value", {
    allowWrite: true,
    allowedDigests: { LEARN_INPUT_DISPATCH_ENABLED: sha("false") },
    fetcher: async (url, init) => {
      count++;
      assert.equal(init.redirect, "error");
      return new Response("{}", { status: 201 });
    },
  });
  const path = `/v1/projects/${project}/secrets`;
  await api({
    method: "POST",
    path,
    json: [{ name: "LEARN_INPUT_DISPATCH_ENABLED", value: "false" }],
  });
  await assert.rejects(
    api({ method: "POST", path, json: [{ name: "LEARN_INPUT_DISPATCH_ENABLED", value: "true" }] }),
    /outside/,
  );
  await assert.rejects(api({ method: "DELETE", path }), /outside/);
  await assert.rejects(api({ method: "GET", path: "https://example.invalid/secrets" }), /outside/);
  assert.equal(count, 1);
  const failed = productionConfigurationTransport("synthetic-management-token-value", {
    fetcher: async () => {
      throw Error("sensitive upstream content");
    },
  });
  await assert.rejects(
    failed({ method: "GET", path }),
    (e) => e.message === "Configuration transport outcome unconfirmed",
  );
  assert.throws(
    () => configurationSecretMetadata([{ name: "A", value: "plaintext-not-metadata" }]),
    /format/,
  );
  assert.throws(
    () =>
      configurationSecretMetadata([
        { name: "A", digest: "a".repeat(64) },
        { name: "A", digest: "b".repeat(64) },
      ]),
    /format/,
  );
});

test("coordinator resumes with durable configuration refresh through all runtime uploads and activation", async (t) => {
  const f = fixture(),
    bodies = new Map();
  for (const op of f.operations.operations.filter(
    (o) => o.kind === "runtime" && o.id !== "publish-runtime-metadata",
  )) {
    const body = Buffer.from("EZBRsynthetic-configured-runtime:" + op.contract.name);
    bodies.set(op.contract.request.bodyFile, body);
    op.contract.ezbrSha256 = sha(body);
    const url = new URL("https://api.supabase.com" + op.contract.request.path);
    url.searchParams.set("ezbr_sha256", sha(body));
    op.contract.request.path = url.pathname + url.search;
    op.pinSha256 = sha(JSON.stringify(op.contract));
  }
  const bulk = f.operations.operations.find((o) => o.id === "publish-runtime-metadata");
  for (const target of bulk.contract.targets)
    target.ezbrSha256 = f.operations.operations.find(
      (o) => o.id === "runtime-" + target.name,
    ).contract.ezbrSha256;
  bulk.pinSha256 = sha(JSON.stringify(bulk.contract));
  let runtimeRows;
  let uploads = 0,
    publications = 0;
  const runtimeApi = async (r) => {
    if (r.method === "GET") return structuredClone(runtimeRows);
    if (r.readOnly)
      return r.json.query.includes("to_regclass")
        ? [{ ledger_present: true }]
        : f.candidate.database.map((d, i) => ({
            migration_name: "fixture-" + i,
            source_sha256: d.sha256,
            project_ref: project,
          }));
    if (r.method === "PUT") {
      publications++;
      assert.equal(r.json.length, 37);
      return {};
    }
    uploads++;
    const url = new URL("https://api.supabase.com" + r.path),
      name = url.searchParams.get("slug") ?? url.pathname.split("/").at(-1);
    const old = runtimeRows.find((x) => x.slug === name),
      row = {
        slug: name,
        name,
        id: old?.id ?? "synthetic-" + name,
        version: (old?.version ?? 0) + 1,
        ezbr_sha256: url.searchParams.get("ezbr_sha256"),
        verify_jwt: url.searchParams.get("verify_jwt") === "true",
        status: "ACTIVE",
        entrypoint_path: url.searchParams.get("entrypoint_path"),
        import_map: false,
        import_map_path: null,
      };
    if (old) Object.assign(old, row);
    else runtimeRows.push(row);
    return row;
  };
  const plan = {
    ...JSON.parse(readFileSync(root + "release-sequence.plan.json")),
    steps: f.operations.operations.map(({ id, kind, pinSha256 }) => ({ id, kind, pinSha256 })),
  };
  f.operations.planSha256 = sha(JSON.stringify(plan));
  const dir = mkdtempSync(join(tmpdir(), "learn-config-compose-"));
  const receipts = openConfigurationReceiptStore(join(dir, "receipts"), { create: true });
  let journal = openReleaseJournal(join(dir, "journal"), plan, { create: true });
  t.after(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });
  // SQL, frontend and acceptance gates are simulated here. This test exercises
  // the real configuration/runtime adapters, durable journal and receipt store.
  const simulated = new Set();
  const port = {
    observe: async (s) => ({
      state: simulated.has(s.id) ? "applied" : "ready",
      evidenceSha256: "a".repeat(64),
    }),
    apply: async (s) => {
      simulated.add(s.id);
    },
  };
  const authority = async (s) => ({
    projectRef: project,
    stepPinSha256: s.pinSha256,
    approvalEvidenceSha256: "a".repeat(64),
  });
  let runtimeFactoryCalls = 0;
  const makeRunner = () =>
    createProductionReleaseCoordinator({
      plan,
      operations: f.operations,
      journal,
      configurationReceipts: receipts,
      sql: port,
      frontend: port,
      checks: Object.fromEntries(
        plan.steps.filter((s) => s.kind === "check").map((s) => [s.id, port]),
      ),
      authorize: authority,
      createConfiguration: async (step) => {
        if (step.id === f.step.id) return f.adapter;
        f.functions.splice(
          0,
          f.functions.length,
          ...runtimeRows.map((r) => ({
            name: r.slug,
            id: r.id,
            version: r.version,
            hash: r.ezbr_sha256,
            jwt: r.verify_jwt,
            status: r.status,
          })),
        );
        return createProductionConfigurationAdapter({
          ...f.options,
          baseline: {
            ...f.baseline,
            stepId: step.id,
            stepPinSha256: step.pinSha256,
            functions: structuredClone(f.functions),
            secrets: structuredClone(f.secrets),
          },
        });
      },
      createRuntime: async (receipt) => {
        runtimeFactoryCalls++;
        assert.deepEqual(receipt, receipts.load(f.step.id));
        runtimeRows = f.functions.map((r) => ({
          slug: r.name,
          name: r.name,
          id: r.id,
          version: r.version,
          ezbr_sha256: r.hash,
          verify_jwt: r.jwt,
          status: r.status,
        }));
        return createProductionRuntimeAdapter({
          candidate: f.candidate,
          operations: f.operations,
          configurationRefresh: receipt,
          api: runtimeApi,
          readBody: (n) => bodies.get(n),
          allowWrite: true,
          assertApprovedAndDrained: authority,
        });
      },
    });
  let runner = makeRunner();
  while (runner.status().nextStep !== f.step.id) {
    assert.notEqual((await runner.next()).state, "unknown_outcome");
  }
  assert.notEqual((await runner.next()).state, "unknown_outcome");
  assert.equal(writes(f).length, 1);
  assert.ok(receipts.load(f.step.id));
  // Start a new coordinator after configuration changed all function versions.
  journal.close();
  journal = openReleaseJournal(join(dir, "journal"), plan);
  runner = makeRunner();
  while (runner.status().nextStep) {
    assert.notEqual((await runner.next()).state, "unknown_outcome");
  }
  assert.equal(runner.status().state, "sequence_verified");
  assert.equal(runtimeFactoryCalls, 1);
  assert.equal(uploads, 37);
  assert.equal(publications, 1);
  assert.equal(writes(f).length, 2);
  assert.deepEqual(writes(f).at(-1).names, ["LEARN_INPUT_DISPATCH_ENABLED"]);
  assert.ok(receipts.load("activate-reviewed-input-dispatch"));
});
