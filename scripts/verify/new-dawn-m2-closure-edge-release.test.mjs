import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import ts from "typescript";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { reviewedEdgeBundle } from "./new-dawn-m2-closure-edge-prepare.mjs";
import { REVIEWED_EDGE_EZBR_SHA256 } from "./new-dawn-m2-closure-release.mjs";
import { assessBefore, assessAfter, transportRequest,
  deployLive, assessPost, verifyDownloadedClosure, livePostReadOnly,
  livePostClosureReadOnly } from
  "./new-dawn-m2-closure-edge-release.mjs";

const optional = readFileSync(new URL(
  "../../supabase/migrations/20261107150000_new_dawn_commusoft_job_optional_source_facts.sql",
  import.meta.url), "utf8");
const closure = readFileSync(new URL(
  "../../supabase/migrations/20261107160000_new_dawn_commusoft_job_closure_source_facts.sql",
  import.meta.url), "utf8");
const old = {
  id: "009b9fb6-8e3c-49b8-8a3e-95531ba370bd",
  slug: "learn-commusoft-job-detail", version: 5, status: "ACTIVE",
  verify_jwt: false,
  ezbr_sha256: "eafe6d4310c3e6588c7e89f630890d5b14be2e18b6651062ba6d3d6549957bfa",
};
const before = () => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  functions: [{ ...old }, { id: "other", slug: "another-function", version: 1,
    ezbr_sha256: "c".repeat(64), status: "ACTIVE", verify_jwt: true }],
  ledger: [{ version: "20261107150000",
    name: "new_dawn_commusoft_job_optional_source_facts", statements: [optional] },
    { version: "20261107140000", name: "new_dawn_commusoft_job_source_quote",
      statements: [] }],
  catalog: [{ function_sha256:
    "8eb34ddd828420ea84f695b5a893ff9f9e4d1786537f36921aa9408370026090",
    permit_table: true, active_permits: 0, enabled_flags: 0 }],
});

// Optional-facts preflight requires the quote ledger first.
const quote = readFileSync(new URL(
  "../../supabase/migrations/20261107140000_new_dawn_commusoft_job_source_quote.sql",
  import.meta.url), "utf8");
function snapshot() {
  const value = before();
  value.ledger = [
    { version: "20261107140000", name: "new_dawn_commusoft_job_source_quote",
      statements: [quote] },
    { version: "20261107150000", name: "new_dawn_commusoft_job_optional_source_facts",
      statements: [optional] },
  ];
  return value;
}
function after(value) {
  const changed = structuredClone(value);
  changed.functions[0].version = 6;
  changed.functions[0].ezbr_sha256 = REVIEWED_EDGE_EZBR_SHA256;
  return changed;
}
function closureSnapshot() {
  const current = after(snapshot());
  current.ledger = [
    { version: "20261107150000", name: "new_dawn_commusoft_job_optional_source_facts",
      statements: [optional] },
    { version: "20261107160000", name: "new_dawn_commusoft_job_closure_source_facts",
      statements: [closure] },
  ];
  current.catalog[0].function_sha256 =
    "7c4bb1e4baf72f56935ed40dd441ea1cbd25412d205576583152677d7f4ce36c";
  return current;
}

test("transport names one exact PATCH artifact and no provider route", () => {
  const req = transportRequest();
  assert.equal(req.method, "PATCH");
  assert.equal(req.contentType, "application/vnd.denoland.eszip");
  assert.match(req.url, /\/projects\/tgbnakbxwcqjeimygroz\/functions\/learn-commusoft-job-detail\?/);
  assert.match(req.url, /ezbr_sha256=b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb/);
  assert.match(req.url, /verify_jwt=false/);
  assert.doesNotMatch(req.url, /commusoft\.co/);
});

test("old exact runtime and v4 SQL are required before Edge-only patch", () => {
  assert.equal(assessBefore(snapshot()).state, "exact_edge_v5_deploy_ready");
  for (const change of [
    s => { s.functions[0].version = 6; },
    s => { s.functions[0].ezbr_sha256 = "0".repeat(64); },
    s => { s.catalog[0].active_permits = 1; },
    s => { s.catalog[0].enabled_flags = 1; },
    s => { s.catalog[0].function_sha256 = "0".repeat(64); },
    s => { s.ledger[1].statements[0] = "changed"; },
  ]) {
    const state = snapshot();
    change(state);
    assert.throws(() => assessBefore(state));
  }
});

test("post-PATCH readback requires exact v6, stable SQL, no permits and untouched other Edge routes", () => {
  const oldState = snapshot();
  assert.equal(assessAfter(oldState, after(oldState)).state,
    "exact_edge_v6_metadata_readback");
  for (const change of [
    s => { s.functions[0].version = 7; },
    s => { s.functions[0].ezbr_sha256 = "0".repeat(64); },
    s => { s.functions[1].version = 2; },
    s => { s.catalog[0].active_permits = 1; },
    s => { s.ledger.pop(); },
  ]) {
    const state = after(oldState);
    change(state);
    assert.throws(() => assessAfter(oldState, state));
  }
});

test("candidate source bundle includes the v5 handler and route entrypoint", () => {
  const bundle = reviewedEdgeBundle();
  assert.equal(bundle.sha256,
    "be16e43e707f180a11fa68cf73c71a5284aafb01698c405560683821cb755884");
  assert.equal(bundle.files.length, 3);
  assert.equal(bundle.external.length, 1);
});

test("downloaded v6 CLI layout matches executable AST despite stripped types and formatting", () => {
  const root = `.verification-results/v6-source-fixture-${randomUUID()}`;
  const bundle = reviewedEdgeBundle();
  try {
    for (const file of bundle.files) {
      const path = join(root, "supabase/functions/learn-commusoft-job-detail",
        file.path.startsWith("learn-commusoft-job-detail/")
          ? "index.ts" : "work/supabase/functions/" + file.path);
      mkdirSync(dirname(path), { recursive: true });
      const js = ts.transpileModule(file.source, { compilerOptions: {
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        removeComments: true,
      } }).outputText;
      writeFileSync(path, js);
    }
    assert.equal(verifyDownloadedClosure(root, bundle.sha256), bundle.sha256);
    const handler = join(root, "supabase/functions/learn-commusoft-job-detail/work/supabase/functions/_shared/commusoft/exact_job_detail.ts");
    writeFileSync(handler, readFileSync(handler, "utf8") + "\nthrow Error('mutated_runtime');\n");
    assert.throws(() => verifyDownloadedClosure(root, bundle.sha256),
      /executable_structure_changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("independent v6 readback keeps v4 SQL, default-off state and exact Edge", async () => {
  const current = after(snapshot());
  assert.equal(assessPost(current).state, "exact_edge_v6_metadata_readback");
  const changed = structuredClone(current);
  changed.catalog[0].active_permits = 1;
  assert.throws(() => assessPost(changed), /default_off_changed/);
  let reads = 0, downloads = 0;
  const result = await livePostReadOnly({
    token: "fixture", artifactPath: ".verification-results/fixture/artifacts/learn-commusoft-job-detail.ezbr",
    out: `.verification-results/edge-post-test-${randomUUID()}`,
    artifactReader: () => ({}),
    read: async () => { reads++; return after(snapshot()); },
    downloader: async () => { downloads++; },
    sourceVerifier: (_, hash) => assert.equal(hash, reviewedEdgeBundle().sha256),
  });
  assert.equal(result.state, "exact_edge_v6_source_readback");
  assert.equal(result.productionChanged, false);
  assert.deepEqual([reads, downloads], [2, 1]);
});

test("independent post-closure v6 readback requires exact closure SQL and source", async () => {
  let reads = 0, downloads = 0, verifies = 0;
  const result = await livePostClosureReadOnly({
    token: "fixture", artifactPath: ".verification-results/fixture/artifacts/learn-commusoft-job-detail.ezbr",
    out: `.verification-results/edge-closure-post-test-${randomUUID()}`,
    artifactReader: () => ({}),
    read: async () => { reads++; return closureSnapshot(); },
    downloader: async () => { downloads++; },
    sourceVerifier: (_, hash) => { verifies++; assert.equal(hash, reviewedEdgeBundle().sha256); },
  });
  assert.equal(result.state, "exact_edge_v6_post_closure_source_readback");
  assert.equal(result.closureSqlVersion, "20261107160000");
  assert.equal(result.productionChanged, false);
  assert.deepEqual([reads, downloads, verifies], [2, 1, 1]);
  for (const change of [
    s => { s.catalog[0].function_sha256 = "0".repeat(64); },
    s => { s.catalog[0].active_permits = 1; },
    s => { s.ledger[1].statements[0] = "changed"; },
    s => { s.functions[0].ezbr_sha256 = "0".repeat(64); },
  ]) {
    const current = closureSnapshot();
    change(current);
    await assert.rejects(() => livePostClosureReadOnly({
      token: "fixture", artifactPath: ".verification-results/fixture/artifacts/learn-commusoft-job-detail.ezbr",
      out: `.verification-results/edge-closure-post-test-${randomUUID()}`,
      artifactReader: () => ({}), read: async () => current,
      downloader: async () => { throw Error("must_not_download"); },
    }));
  }
});

test("one exact Edge PATCH needs metadata and downloaded source readback", async () => {
  let reads = 0, writes = 0, downloads = 0, verified = 0;
  const result = await deployLive({
    token: "fixture", artifactPath: ".verification-results/fixture/artifacts/learn-commusoft-job-detail.ezbr",
    out: `.verification-results/edge-release-test-${randomUUID()}`,
    artifactReader: () => ({ bytes: Buffer.from("reviewed exact artifact") }),
    read: async () => ++reads <= 2 ? snapshot() : after(snapshot()),
    downloader: async () => { downloads++; },
    sourceVerifier: (_, hash) => { verified++; assert.match(hash, /^[a-f0-9]{64}$/); },
    patcher: async (url, options) => {
      writes++;
      assert.equal(options.method, "PATCH");
      assert.equal(url, transportRequest().url);
      return { ok: true, body: null };
    },
  });
  assert.equal(result.state, "exact_edge_v6_source_readback");
  assert.equal(result.providerRequests, 0);
  assert.equal(result.acknowledged, true);
  assert.deepEqual([reads, writes, downloads, verified], [4, 1, 2, 2]);
});

test("uncertain Edge PATCH is never replayed, and no matching readback is rejected", async () => {
  let writes = 0;
  const out = () => `.verification-results/edge-release-test-${randomUUID()}`;
  const deps = {
    token: "fixture", artifactPath: ".verification-results/fixture/artifacts/learn-commusoft-job-detail.ezbr",
    artifactReader: () => ({ bytes: Buffer.from("reviewed exact artifact") }),
    downloader: async () => {},
    sourceVerifier: () => {},
    patcher: async () => { writes++; throw Error("connection_lost_after_patch"); },
  };
  let reads = 0;
  const result = await deployLive({ ...deps, out: out(),
    read: async () => ++reads <= 2 ? snapshot() : after(snapshot()) });
  assert.equal(result.acknowledged, false);
  assert.equal(writes, 1);
  writes = 0; reads = 0;
  await assert.rejects(() => deployLive({ ...deps, out: out(),
    read: async () => { reads++; return snapshot(); } }),
  /outcome_unverified_no_replay/);
  assert.equal(writes, 1);
  assert.equal(reads, 3);
});
