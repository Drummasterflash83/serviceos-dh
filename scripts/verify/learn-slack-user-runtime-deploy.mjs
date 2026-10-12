/** Replace only TEST Slack worker v10 with the explicit user-credential path. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { deployPinnedTestRuntime, edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const mode = process.argv[2],
  path = "supabase/release/learn-test/080_slack_user_runtime.manifest.json";
if (
  !["--prepare", "--deploy"].includes(mode) ||
  process.argv.slice(3).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST runtime scope required");
const schema = JSON.parse(
  readFileSync(".verification-results/slack-user-release-apply-result.json", "utf8"),
);
if (
  schema.projectRef !== TEST_PROJECT ||
  schema.state !== "installed_verified" ||
  schema.preservedDatasets !== 194
)
  throw Error("Verified matching TEST schema required");
const packageManifest = JSON.parse(
  readFileSync("supabase/release/learn-test/080_slack_user_credential.manifest.json", "utf8"),
);
if (schema.packageSha256 !== packageManifest.sha256)
  throw Error("Installed package identity changed");
const token = savedCliToken(),
  q = (sql) => communicationQuery(token, sql),
  endpoints = [{ name: "learn-slack-worker", verifyJwt: true }],
  bundle = edgeRuntimeBundle(endpoints);
const tables = packageManifest.tables;
if (
  tables.length !== 194 ||
  tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Preservation inventory differs");
const snapshot = tables
  .map(
    (t) =>
      `select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t} s`,
  )
  .join(" union all ");
const catalog = `select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')`;
if ((await q(catalog))[0]?.fingerprint !== schema.afterFingerprint)
  throw Error("Full installed schema changed");
if (
  (
    await q(
      "select count(*)::int active from platform_jobs where job_type in('slack.history_sync','slack.thread_sync') and status in('queued','running','retrying')",
    )
  )[0]?.active !== 0
)
  throw Error("Slack capture must be idle for rollout");
const prior = await edgeInventory(token),
  current = prior.find((r) => r.slug === "learn-slack-worker");
if (current?.version !== 10 || current.status !== "ACTIVE" || current.verify_jwt !== true)
  throw Error("Exact TEST worker v10 required; inspect current state");
const rows = await q(snapshot),
  runtime = await readRuntimeCatalog(token);
if (mode === "--prepare") {
  const manifest = {
    projectRef: TEST_PROJECT,
    bundleSha256: bundle.sha256,
    fullSchema: schema.afterFingerprint,
    runtimeSchema: runtime.fingerprint,
    endpoints,
    replaceVersions: { "learn-slack-worker": 10 },
    modules: bundle.files.length,
    external: bundle.external,
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ state: "prepared", ...manifest }));
} else {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (
    manifest.projectRef !== TEST_PROJECT ||
    manifest.bundleSha256 !== bundle.sha256 ||
    manifest.fullSchema !== schema.afterFingerprint ||
    manifest.runtimeSchema !== runtime.fingerprint ||
    JSON.stringify(manifest.endpoints) !== JSON.stringify(endpoints)
  )
    throw Error("Pinned runtime differs");
  const stem = ".verification-results/slack-user-runtime-deploy";
  const result = await deployPinnedTestRuntime(
    {
      allowProjectRef: TEST_PROJECT,
      token,
      replaceVersions: { "learn-slack-worker": 10 },
      persistJournal: async (journal) => {
        const fd = openSync(stem + "-journal.json", "wx", 0o600);
        try {
          writeSync(
            fd,
            JSON.stringify(
              { ...journal, fullPreserved: rows, fullSchema: schema.afterFingerprint },
              null,
              2,
            ),
          );
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (r) => console.log(JSON.stringify(r)),
    },
    {
      bundle: () => edgeRuntimeBundle(endpoints),
      endpoints,
      bundleSha: manifest.bundleSha256,
      databaseFingerprint: manifest.runtimeSchema,
      version: "learn-slack-user-runtime/1",
      stagePrefix: "learn-slack-user-runtime-",
    },
  );
  const after = await q(snapshot),
    post = await q(catalog),
    stable = (rs) => JSON.stringify([...rs].sort((a, b) => a.name.localeCompare(b.name)));
  const preserved =
    stable(rows) === stable(after) && post[0]?.fingerprint === schema.afterFingerprint;
  const report = {
    ...result,
    state: preserved ? result.state : "requires_inspection",
    fullPreservedDatasets: preserved ? 194 : null,
    credentialsUploaded: 0,
    channelsActivated: 0,
    providerRequests: 0,
    productionChanged: false,
  };
  writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
  if (report.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
}
