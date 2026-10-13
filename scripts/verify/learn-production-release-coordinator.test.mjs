import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openReleaseJournal } from "./learn-production-release-journal.mjs";
import { createProductionReleaseCoordinator } from "./learn-production-release-coordinator.mjs";
import {
  openConfigurationReceiptStore,
  validateConfigurationReceipt,
} from "./learn-production-release-receipts.mjs";
const root = "supabase/release/learn-production/";
const plan = JSON.parse(readFileSync(root + "release-sequence.plan.json"));
const operations = JSON.parse(readFileSync(root + "release-operations.manifest.json"));
const hash = "a".repeat(64);
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const metadata = {
  name: "platform-worker",
  id: "synthetic",
  version: 1,
  hash,
  jwt: false,
  status: "ACTIVE",
};
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "learn-release-compose-"));
  const receipts = openConfigurationReceiptStore(join(dir, "receipts"), { create: true });
  const state = new Map(),
    applied = [],
    runtimeReceipts = [];
  let lost = null,
    saveFails = false;
  let journal = openReleaseJournal(join(dir, "journal"), plan, { create: true });
  t.after(() => {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const port = {
    observe: async (step) => ({
      state: state.has(step.id) ? "applied" : "ready",
      evidenceSha256: hash,
    }),
    apply: async (step) => {
      state.set(step.id, true);
      applied.push(step.id);
      if (lost === step.id) throw Error("Synthetic lost reply");
    },
  };
  const receipt = (step) => ({
    projectRef: plan.projectRef,
    candidateSha256: plan.candidateSha256,
    stepId: step.id,
    stepPinSha256: step.pinSha256,
    secretDigests: [{ name: "WORKER_SECRET", digest: hash }],
    before: [metadata],
    after: [{ ...metadata, version: 2 }],
  });
  const options = {
    plan,
    operations,
    sql: port,
    frontend: port,
    checks: Object.fromEntries(
      plan.steps.filter((s) => s.kind === "check").map((s) => [s.id, port]),
    ),
    createConfiguration: async () => ({
      ...port,
      observe: async (step) => {
        const observed = await port.observe(step),
          r = receipt(step);
        return {
          ...observed,
          evidenceSha256: digest({ secrets: r.secretDigests, functions: r.after }),
        };
      },
      receipt: async (step) => receipt(step),
    }),
    createRuntime: async (r) => {
      runtimeReceipts.push(r);
      return port;
    },
    configurationReceipts: {
      load: receipts.load,
      save: (id, r) => {
        if (saveFails) throw Error("Synthetic durable storage failure");
        return receipts.save(id, r);
      },
    },
    authorize: async (op) => ({
      projectRef: plan.projectRef,
      stepPinSha256: op.pinSha256,
      approvalEvidenceSha256: hash,
    }),
  };
  const create = () => createProductionReleaseCoordinator({ ...options, journal });
  let runner = create();
  return {
    dir,
    state,
    applied,
    runtimeReceipts,
    options,
    receipts,
    receipt,
    get journal() {
      return journal;
    },
    get runner() {
      return runner;
    },
    lose: (id) => {
      lost = id;
    },
    failSave: () => {
      saveFails = true;
    },
    allowSave: () => {
      saveFails = false;
    },
    reopen() {
      journal.close();
      journal = openReleaseJournal(join(dir, "journal"), plan);
      runner = create();
      return runner;
    },
  };
}
async function advanceTo(f, id) {
  while (f.runner.status().nextStep !== id) {
    const r = await f.runner.next();
    assert.notEqual(r.state, "unknown_outcome");
  }
}
test("all pinned release phases route in order and runtime receives the saved configuration refresh", async (t) => {
  const f = fixture(t);
  for (const step of plan.steps) {
    assert.equal(f.runner.status().nextStep, step.id);
    await f.runner.next();
  }
  assert.deepEqual(
    f.applied,
    plan.steps.map((s) => s.id),
  );
  assert.equal(f.runner.status().state, "sequence_verified");
  assert.equal(f.runtimeReceipts.length, 1);
  assert.deepEqual(f.runtimeReceipts[0], f.receipts.load("matching-server-configuration"));
  assert.equal(f.runner.status().goalComplete, false);
});
test("lost configuration response reconciles after reopening without repeating its write", async (t) => {
  const f = fixture(t);
  await advanceTo(f, "matching-server-configuration");
  f.lose("matching-server-configuration");
  assert.equal((await f.runner.next()).state, "unknown_outcome");
  assert.equal(f.receipts.load("matching-server-configuration"), null);
  f.reopen();
  assert.notEqual((await f.runner.next()).state, "unknown_outcome");
  await f.runner.next();
  assert.equal(f.applied.filter((s) => s === "matching-server-configuration").length, 1);
  assert.equal(f.runtimeReceipts.length, 1);
});
test("receipt persistence failure blocks runtime and is recovered without a second configuration mutation", async (t) => {
  const f = fixture(t);
  await advanceTo(f, "matching-server-configuration");
  f.failSave();
  assert.equal((await f.runner.next()).state, "unknown_outcome");
  assert.equal(f.runtimeReceipts.length, 0);
  f.reopen();
  await assert.rejects(f.runner.next(), /durable storage/);
  assert.equal(f.runtimeReceipts.length, 0);
  f.allowSave();
  await f.runner.next();
  f.reopen();
  await f.runner.next();
  assert.equal(f.applied.filter((s) => s === "matching-server-configuration").length, 1);
  assert.equal(f.runtimeReceipts.length, 1);
});
test("missing external evidence adapter stops before any journal intent or mutation", async (t) => {
  const f = fixture(t);
  delete f.options.checks["fresh-release-preflight"];
  f.reopen();
  await assert.rejects(f.runner.next(), /adapter unavailable/);
  assert.equal(f.applied.length, 0);
  assert.equal(f.journal.status().pending, null);
});
test("receipt store rejects secrets, tampering and conflicting readbacks", async (t) => {
  const f = fixture(t),
    step = plan.steps.find((s) => s.id === "matching-server-configuration"),
    r = f.receipt(step);
  assert.throws(() => validateConfigurationReceipt({ ...r, secretValues: ["PRIVATE"] }));
  assert.throws(() =>
    validateConfigurationReceipt({ ...r, secretDigests: [{ name: "KEY", value: "PRIVATE" }] }),
  );
  f.receipts.save(step.id, r);
  f.receipts.save(step.id, r);
  assert.throws(
    () => f.receipts.save(step.id, { ...r, after: [{ ...metadata, version: 3 }] }),
    /changed/,
  );
  const path = join(f.dir, "receipts", step.id + ".json"),
    row = JSON.parse(readFileSync(path));
  row.receipt.after[0].version = 9;
  writeFileSync(path, JSON.stringify(row));
  assert.throws(() => f.receipts.load(step.id), /digest differs/);
});
test("mismatched journal/operation pins cannot enter a production adapter", (t) => {
  const f = fixture(t),
    changed = structuredClone(operations);
  changed.operations[0].contract.requires = [];
  assert.throws(
    () =>
      createProductionReleaseCoordinator({ ...f.options, journal: f.journal, operations: changed }),
    /contracts differ/,
  );
});

test("configuration drift between observation and receipt blocks acceptance and runtime", async (t) => {
  const f = fixture(t);
  const factory = f.options.createConfiguration;
  f.options.createConfiguration = async (op) => {
    const adapter = await factory(op);
    return {
      ...adapter,
      receipt: async (step) => {
        const receipt = await adapter.receipt(step);
        receipt.after[0].version++;
        return receipt;
      },
    };
  };
  f.reopen();
  await advanceTo(f, "matching-server-configuration");
  assert.equal((await f.runner.next()).state, "unknown_outcome");
  assert.equal(f.receipts.load("matching-server-configuration"), null);
  assert.equal(f.runtimeReceipts.length, 0);
  assert.equal(f.applied.filter((s) => s === "matching-server-configuration").length, 1);
});
