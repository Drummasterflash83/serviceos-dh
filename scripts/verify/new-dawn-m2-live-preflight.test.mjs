import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessM2Preflight, assessM2Postrelease, assessM2WorkerFirst, ENDPOINTS, PROJECT,
  normalizeRollbackSource } from "./new-dawn-m2-live-preflight.mjs";

const input = () => ({ project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  functions: ENDPOINTS.map(e => ({ slug: e.name, id: e.id, version: e.version,
    ezbr_sha256: e.hash, verify_jwt: e.jwt, status: "ACTIVE" })),
  migrations: [], flags: [], queue: [{ active_import: true }] });

test("exact runtime, absent SQL/flags and active import remain read-only staging only", () => {
  const result = assessM2Preflight(input());
  assert.equal(result.activeImport, true);
  assert.equal(result.endpoints[0].version, 10);
  assert.deepEqual(result.migrationsPresent, []);
});

test("version/hash drift, installed SQL or enabled flag stop preflight", () => {
  const changed = input(); changed.functions[0].version = 11;
  assert.throws(() => assessM2Preflight(changed), /runtime_version_or_hash_drift/);
  const hash = input(); hash.functions[0].ezbr_sha256 = "0".repeat(64);
  assert.throws(() => assessM2Preflight(hash), /runtime_version_or_hash_drift/);
  const installed = input(); installed.migrations = [{ version: "20261106150000" }];
  assert.throws(() => assessM2Preflight(installed), /m2_sql_already_installed/);
  const enabled = input(); enabled.flags = [{ flag: "new_dawn.m2_commusoft_coexistence" }];
  assert.throws(() => assessM2Preflight(enabled), /m2_flag_already_present/);
});

test("unknown project, missing route and unconfirmed queue stop preflight", () => {
  const foreign = input(); foreign.project.id = "other";
  assert.throws(() => assessM2Preflight(foreign), /production_project_unconfirmed/);
  const absent = input(); absent.functions.pop();
  assert.throws(() => assessM2Preflight(absent), /runtime_endpoint_missing/);
  const queue = input(); queue.queue = [];
  assert.throws(() => assessM2Preflight(queue), /source_queue_unconfirmed/);
});

test("post-release readback requires every new route, ordered SQL and absent flags", () => {
  const installed = input();
  installed.functions.forEach(f => { f.version++; f.ezbr_sha256 = "a".repeat(64); });
  installed.migrations = ["20261106150000", "20261106160000", "20261106180000"]
    .map(version => ({ version }));
  installed.lease = [{ columns_present: true, acquire_present: true,
    yield_present: true, switch_present: true }];
  assert.equal(assessM2Postrelease(installed).state, "installed_default_off_readback");
  installed.flags = [{ flag: "new_dawn.m2_commusoft_coexistence" }];
  assert.throws(() => assessM2Postrelease(installed), /m2_flags_not_absent/);
  installed.flags = [];
  installed.lease[0].yield_present = false;
  assert.throws(() => assessM2Postrelease(installed), /lease_schema_unconfirmed/);
});

test("worker-first readback waits for old claims but does not require an empty queue", () => {
  const now = Date.parse("2026-10-19T18:00:00Z"), staged = input();
  staged.functions[0].version = 11;
  staged.functions[0].ezbr_sha256 = "a".repeat(64);
  staged.functions[0].updated_at = now - 181000;
  staged.health = [{ pre_activation_running: 0, recent_retrying: 0,
    recent_dead_letter: 0, completed_since: 2 }];
  assert.equal(assessM2WorkerFirst(staged, now).state, "worker_first_sql_ready");
  staged.health[0].pre_activation_running = 1;
  assert.equal(assessM2WorkerFirst(staged, now).state, "worker_first_wait_or_inspect");
  staged.health[0].pre_activation_running = 0;
  staged.health[0].completed_since = 0;
  assert.equal(assessM2WorkerFirst(staged, now).state, "worker_first_wait_or_inspect");
  staged.health[0].completed_since = 2;
  staged.functions[0].updated_at = now - 179000;
  assert.equal(assessM2WorkerFirst(staged, now).state, "worker_first_wait_or_inspect");
  staged.functions[1].version = 2;
  assert.throws(() => assessM2WorkerFirst(staged, now), /manual_route_changed_before_sql/);
});

test("CLI-nested shared source becomes a private complete rollback stage", () => {
  const root = mkdtempSync(join(tmpdir(), "m2-rollback-test-"));
  try {
    const slug = "learn-commusoft-worker";
    const paths = [
      `supabase/functions/${slug}/index.ts`,
      `supabase/functions/${slug}/work/supabase/functions/_shared/worker.ts`,
    ];
    const contents = ["import { run } from '../_shared/worker.ts'; Deno.serve(run);",
      "export const run = () => new Response('ok');"];
    paths.forEach((path, i) => {
      mkdirSync(join(root, "download", path, ".."), { recursive: true });
      writeFileSync(join(root, "download", path), contents[i]);
    });
    const output = normalizeRollbackSource(join(root, "download"), join(root, "private"),
      { name: slug }, paths.map(path => ({ path })));
    assert.equal(output.files.length, 2);
    assert.equal(readFileSync(join(root, "private/rollback-stage/supabase/functions/_shared/worker.ts"), "utf8"),
      contents[1]);
    assert.match(output.closureSha256, /^[a-f\d]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rollback stage rejects missing or unreferenced shared imports", () => {
  const root = mkdtempSync(join(tmpdir(), "m2-rollback-test-"));
  try {
    const slug = "learn-commusoft-worker";
    const path = `supabase/functions/${slug}/index.ts`;
    mkdirSync(join(root, "download", path, ".."), { recursive: true });
    writeFileSync(join(root, "download", path),
      "import { run } from '../_shared/missing.ts'; Deno.serve(run);");
    assert.throws(() => normalizeRollbackSource(join(root, "download"), join(root, "private"),
      { name: slug }, [{ path }]), /downloaded_import_missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
