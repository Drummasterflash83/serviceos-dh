/** Fixed TEST worker update for atomic observe-only delivery. No schedules or credentials. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime, edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv[2],
  path = "supabase/release/learn-test/086_observation_runtime.manifest.json";
if (
  !["--prepare", "--deploy"].includes(mode) ||
  process.argv[3] !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Fixed TEST scope required");
const token = savedCliToken(),
  q = (sql) => communicationQuery(token, sql),
  endpoints = [{ name: "platform-worker", verifyJwt: false }],
  bundle = () => edgeRuntimeBundle(endpoints);
const proof = JSON.parse(
  readFileSync(".verification-results/observation-release-apply-result.json"),
);
if (proof.state !== "installed_verified" || proof.preservedDatasets !== 199)
  throw Error("Verified TEST 086 install required");
const ledger = await q(
  "select source_sha256 from of_test_deploy.migrations where migration_name='learn_observation_delivery_v1'",
);
if (ledger.length !== 1 || ledger[0].source_sha256 !== proof.packageSha256)
  throw Error("Installed package differs");
const catalog = await readRuntimeCatalog(token),
  inventory = await edgeInventory(token);
const tables = (
  await q(
    "select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1",
  )
).map((r) => r.name);
if (
  tables.length !== 201 ||
  tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Preservation scope differs");
const snapshot = tables
  .map(
    (t) =>
      `select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t} s`,
  )
  .join(" union all ");
const current = bundle(),
  sha = (v) => createHash("sha256").update(v).digest("hex");
if (mode === "--prepare") {
  const worker = inventory.find((e) => e.slug === "platform-worker");
  if (
    worker?.version !== 22 ||
    !worker.ezbr_sha256 ||
    worker.verify_jwt ||
    worker.status !== "ACTIVE"
  )
    throw Error("Expected idle worker version 22");
  writeFileSync(
    path,
    JSON.stringify(
      {
        projectRef: TEST_PROJECT,
        sourceClosureSha256: current.sha256,
        packageSha256: proof.packageSha256,
        runtimeSchema: catalog.fingerprint,
        replaceVersion: 22,
        priorEzbr: worker.ezbr_sha256,
        files: current.files.map((f) => ({ path: f.path, sha256: sha(f.source) })),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      state: "prepared",
      files: current.files.length,
      sourceClosureSha256: current.sha256,
    }),
  );
} else {
  const m = JSON.parse(readFileSync(path));
  if (
    m.projectRef !== TEST_PROJECT ||
    m.sourceClosureSha256 !== current.sha256 ||
    m.runtimeSchema !== catalog.fingerprint ||
    m.packageSha256 !== proof.packageSha256
  )
    throw Error("Pinned runtime changed");
  if ((await q("select count(*)::int n from platform_jobs where status='running'"))[0]?.n !== 0)
    throw Error("Worker busy");
  const before = await q(snapshot),
    stem = ".verification-results/observation-runtime-deploy";
  const result = await deployPinnedTestRuntime(
    {
      allowProjectRef: TEST_PROJECT,
      token,
      replaceVersions: { "platform-worker": 22 },
      persistJournal: async (journal) => {
        const fd = openSync(stem + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify({ ...journal, before }));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (r) => console.log(JSON.stringify(r)),
    },
    {
      bundle,
      endpoints,
      bundleSha: m.sourceClosureSha256,
      databaseFingerprint: m.runtimeSchema,
      version: "learn-observation-runtime/1",
      stagePrefix: "learn-observation-runtime-",
    },
  );
  const after = await q(snapshot);
  result.allRetainedDatasetsPreserved = JSON.stringify(before) === JSON.stringify(after);
  result.preservedDatasets = result.allRetainedDatasetsPreserved ? tables.length : 0;
  if (!result.allRetainedDatasetsPreserved) result.state = "requires_inspection";
  writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify(result));
  if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
}
