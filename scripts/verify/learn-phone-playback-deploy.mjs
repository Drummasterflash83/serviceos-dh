/** Deploy just the playback endpoint to TEST; deny replacement without inspection. */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import {
  readPhonePlaybackCatalog,
  phonePlaybackSourceQuery,
} from "./learn-phone-playback-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
if (
  process.argv.slice(2).join(" ") !== "--deploy --existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST operation required");
const token = savedCliToken(),
  name = "learn-phone-playback",
  paths = [name + "/index.ts", "_shared/authz.ts", "_shared/learn-phone-playback.ts"];
const prefix = ".verification-results/phone-playback-runtime",
  cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const api = async (path) => {
  const r = await fetch("https://api.supabase.com/v1/projects/" + TEST_PROJECT + path, {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("TEST metadata unavailable");
  return r.json();
};
const report = {
  projectRef: TEST_PROJECT,
  observedAt: new Date().toISOString(),
  state: "prepared",
};
let stage;
try {
  const installed = JSON.parse(
    readFileSync(".verification-results/phone-playback-apply-result.json"),
  );
  const before = await readPhonePlaybackCatalog(token);
  if (
    installed.state !== "installed_needs_hosted_acceptance" ||
    before.fingerprint !== installed.afterFingerprint
  )
    throw Error("Exact installed playback schema required");
  const snapshot =
    phonePlaybackSourceQuery(before.catalog.phone) +
    " union all select 'public.learn_phone_playback_audit' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_playback_audit s";
  const preserved = await communicationQuery(token, snapshot),
    endpoints = await api("/functions");
  if (endpoints.some((f) => f.slug === name))
    throw Error("Endpoint already exists; inspect before replacement");
  const files = paths.map((path) => ({
    path,
    source: readFileSync("supabase/functions/" + path, "utf8"),
  }));
  report.sourceBundleSha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const fd = openSync(prefix + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(report, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  stage = mkdtempSync(join(tmpdir(), "serviceos-playback-"));
  mkdirSync(join(stage, "supabase/functions", name), { recursive: true });
  mkdirSync(join(stage, "supabase/functions/_shared"), { recursive: true });
  for (const f of files) writeFileSync(join(stage, "supabase/functions", f.path), f.source);
  writeFileSync(
    join(stage, "supabase/config.toml"),
    `project_id = "${TEST_PROJECT}"\n[functions.${name}]\nverify_jwt = true\n`,
  );
  const run = spawnSync(
    cli,
    ["functions", "deploy", name, "--project-ref", TEST_PROJECT, "--use-api", "--workdir", stage],
    {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 2097152,
    },
  );
  report.cliExitStatus = run.status;
  const after = await readPhonePlaybackCatalog(token),
    afterData = await communicationQuery(token, snapshot),
    afterEndpoints = await api("/functions");
  const endpoint = afterEndpoints.find((f) => f.slug === name),
    rest = (items) =>
      JSON.stringify(
        items.filter((f) => f.slug !== name).sort((a, b) => a.slug.localeCompare(b.slug)),
      );
  report.schemaUnchanged = after.fingerprint === before.fingerprint;
  report.retainedSourcesUnchanged = JSON.stringify(preserved) === JSON.stringify(afterData);
  report.otherEndpointsUnchanged = rest(endpoints) === rest(afterEndpoints);
  report.preservedDataSets = preserved.length;
  report.endpoint = endpoint
    ? {
        name: endpoint.slug,
        version: endpoint.version,
        status: endpoint.status,
        verifyJwt: endpoint.verify_jwt,
      }
    : null;
  report.state =
    run.status === 0 &&
    report.schemaUnchanged &&
    report.retainedSourcesUnchanged &&
    report.otherEndpointsUnchanged &&
    endpoint?.status === "ACTIVE" &&
    endpoint.verify_jwt === true
      ? "deployed_needs_hosted_acceptance"
      : "requires_inspection";
} catch {
  report.state = "requires_inspection";
} finally {
  if (stage) rmSync(stage, { recursive: true, force: true });
}
report.completedAt = new Date().toISOString();
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (report.state !== "deployed_needs_hosted_acceptance") process.exitCode = 1;
