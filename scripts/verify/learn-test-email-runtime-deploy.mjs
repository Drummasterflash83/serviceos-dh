/** Deploy the complete pinned runtime closure to TEST, without secrets or schedules. */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emailRuntimeBundle, EMAIL_RUNTIME_ENDPOINTS } from "./learn-email-runtime-edge-bundle.mjs";
import {
  readRuntimeCatalog,
  RUNTIME_SNAPSHOT_QUERY,
  RUNTIME_PRESERVED,
} from "./learn-email-runtime-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const EMAIL_RUNTIME_EDGE_SHA =
  "e736ecc82eaac1bd394b98ec6560490679c36834a668767af0fbf317fc91065b";
export const EMAIL_RUNTIME_DATABASE = "ec04995ee4e15970619130bb53713dc1";
export async function edgeInventory(token, fetcher = fetch) {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("TEST Edge inventory unavailable");
  const rows = await response.json();
  if (
    !Array.isArray(rows) ||
    new Set(rows.map((r) => r.slug)).size !== rows.length ||
    rows.some(
      (r) =>
        typeof r.slug !== "string" ||
        !Number.isInteger(r.version) ||
        typeof r.verify_jwt !== "boolean",
    )
  )
    throw Error("TEST Edge inventory incomplete");
  return rows.sort((a, b) => a.slug.localeCompare(b.slug));
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function sources(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== RUNTIME_PRESERVED.length ||
    new Set(rows.map((r) => r.name)).size !== rows.length ||
    rows.some(
      (r) =>
        !RUNTIME_PRESERVED.includes(r.name) ||
        !Number.isSafeInteger(r.count) ||
        r.count < 0 ||
        !/^[a-f0-9]{32}$/.test(r.fingerprint),
    )
  )
    throw Error("Complete source preservation snapshot required");
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
export async function deployEmailRuntime({
  allowProjectRef,
  token,
  persistJournal,
  replaceVersions = {},
  fetcher = fetch,
  runCli = spawnSync,
  onProgress = () => {},
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    typeof token !== "string" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token) ||
    typeof persistJournal !== "function"
  )
    throw Error("Explicit TEST deployment and durable journal required");
  const bundle = emailRuntimeBundle();
  if (bundle.sha256 !== EMAIL_RUNTIME_EDGE_SHA)
    throw Error("Reviewed email runtime bundle changed");
  const [schema, before, sourceRows] = await Promise.all([
    readRuntimeCatalog(token, { fetcher }),
    edgeInventory(token, fetcher),
    communicationQuery(token, RUNTIME_SNAPSHOT_QUERY, { fetcher }),
  ]);
  const preserved = sources(sourceRows),
    targets = EMAIL_RUNTIME_ENDPOINTS.map((e) => e.name);
  if (
    Object.keys(replaceVersions).some(
      (k) =>
        !targets.includes(k) || !Number.isInteger(replaceVersions[k]) || replaceVersions[k] < 1,
    ) ||
    schema.fingerprint !== EMAIL_RUNTIME_DATABASE ||
    EMAIL_RUNTIME_ENDPOINTS.some((e) => {
      const current = before.find((r) => r.slug === e.name),
        version = replaceVersions[e.name];
      return version === undefined
        ? !!current
        : !current ||
            current.version !== version ||
            current.status !== "ACTIVE" ||
            current.verify_jwt !== e.verifyJwt;
    })
  )
    throw Error("Exact installed TEST database and endpoint versions required");
  const journal = {
    version: "learn-email-runtime-deploy/3",
    replaceVersions,
    projectRef: TEST_PROJECT,
    sourceBundleSha256: bundle.sha256,
    databaseFingerprint: schema.fingerprint,
    observedAt: new Date().toISOString(),
    endpointsBefore: before,
    preserved,
    targets: EMAIL_RUNTIME_ENDPOINTS,
  };
  await persistJournal(journal);
  const stage = mkdtempSync(join(tmpdir(), "learn-email-runtime-")),
    attempts = [];
  try {
    for (const f of bundle.files) {
      const path = join(stage, "supabase/functions", f.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, f.source);
    }
    writeFileSync(
      join(stage, "supabase/config.toml"),
      `project_id = "${TEST_PROJECT}"\n` +
        EMAIL_RUNTIME_ENDPOINTS.map(
          (e) => `[functions.${e.name}]\nverify_jwt = ${e.verifyJwt}\n`,
        ).join("\n"),
    );
    for (const e of EMAIL_RUNTIME_ENDPOINTS) {
      let status = null;
      try {
        status = runCli(
          "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
          [
            "functions",
            "deploy",
            e.name,
            "--project-ref",
            TEST_PROJECT,
            "--use-api",
            "--workdir",
            stage,
          ],
          {
            env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
            encoding: "utf8",
            timeout: 60000,
            maxBuffer: 2097152,
          },
        ).status;
      } catch {
        /* Inspect unknown outcomes; never resubmit. */
      }
      attempts.push({ name: e.name, cliExitStatus: status });
      onProgress({ name: e.name, submitted: true, cliExitStatus: status });
      if (status !== 0) break;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  let after, afterSchema, afterSources;
  try {
    [after, afterSchema, afterSources] = await Promise.all([
      edgeInventory(token, fetcher),
      readRuntimeCatalog(token, { fetcher }),
      communicationQuery(token, RUNTIME_SNAPSHOT_QUERY, { fetcher }),
    ]);
  } catch {
    return { ...journal, state: "requires_inspection", attempts, writeAttempted: true };
  }
  const unchanged =
    equal(
      before.filter((e) => !targets.includes(e.slug)),
      after.filter((e) => !targets.includes(e.slug)),
    ) &&
    afterSchema.fingerprint === schema.fingerprint &&
    equal(preserved, sources(afterSources));
  const deployed =
    attempts.length === EMAIL_RUNTIME_ENDPOINTS.length &&
    attempts.every((a) => a.cliExitStatus === 0) &&
    EMAIL_RUNTIME_ENDPOINTS.every((e) =>
      after.some(
        (r) =>
          r.slug === e.name &&
          r.version === (replaceVersions[e.name] ?? 0) + 1 &&
          r.status === "ACTIVE" &&
          r.verify_jwt === e.verifyJwt,
      ),
    );
  return {
    version: journal.version,
    projectRef: TEST_PROJECT,
    sourceBundleSha256: bundle.sha256,
    observedAt: new Date().toISOString(),
    state: deployed && unchanged ? "deployed_needs_http_acceptance" : "requires_inspection",
    attempts,
    writeAttempted: true,
    priorSchemaAndEndpointsPreserved: unchanged,
    preservedDataSets: preserved.length,
    endpoints: after.filter((e) => targets.includes(e.slug)),
    dependencyFiles: bundle.files.length,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const replaceVersion = /^--replace-v([1-9][0-9]?)$/.exec(process.argv[2] ?? "")?.[1];
    const prefix = replaceVersion
      ? ".verification-results/email-runtime-deploy-replace-v" + replaceVersion
      : ".verification-results/email-runtime-deploy";
    if (
      process.argv.length !== 4 ||
      process.argv[3] !== "--existing-cli-login" ||
      (!replaceVersion && process.argv[2] !== "--deploy") ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST deployment required");
    const result = await deployEmailRuntime({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      replaceVersions: replaceVersion
        ? Object.fromEntries(EMAIL_RUNTIME_ENDPOINTS.map((e) => [e.name, Number(replaceVersion)]))
        : {},
      persistJournal: async (journal) => {
        const fd = openSync(prefix + "-journal.json", "wx", 0o600);
        try {
          writeSync(fd, JSON.stringify(journal, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
      onProgress: (p) => console.log(JSON.stringify(p)),
    });
    writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (result.state !== "deployed_needs_http_acceptance") process.exitCode = 1;
  } catch {
    console.error(
      "Email runtime deployment not confirmed. Inspect retained journal and TEST inventory before retrying.",
    );
    process.exitCode = 1;
  }
}
