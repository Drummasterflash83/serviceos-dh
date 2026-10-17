/** Read-only proof for recovering the current Control Plane from the v107
 * off-site Edge source plus its checked-in Git delta. Never reads secrets or
 * production rows, and removes the downloaded source after comparison. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--stage-exact-overlay"].includes(mode))
  throw Error("Exact LIVE read-only or reviewed local staging mode required");
const project = "tgbnakbxwcqjeimygroz";
const slug = "openfolk-control-plane";
const archive = ".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z";
const manifestPath = join(archive, "manifest.private.json");
const expectedManifest = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const fileSha = path => sha(readFileSync(path));
if (fileSha(manifestPath) !== expectedManifest) throw Error("Verified v107 manifest changed");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const baseline = manifest.entries.find(entry => entry.slug === slug);
if (manifest.project !== project || manifest.inventoryStable !== true ||
    manifest.entries.length !== 103 || baseline?.version !== 37 ||
    baseline.files?.length !== 24) throw Error("Verified v107 inventory changed");

const token = savedCliToken();
async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Function inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 103 ||
      new Set(rows.map(row => row.slug)).size !== 103)
    throw Error("Current function inventory changed");
  return rows;
}
const before = await inventory();
const oldVersions = new Map(manifest.entries.map(entry => [entry.slug, entry]));
const versionChanges = before.filter(row => {
  const old = oldVersions.get(row.slug);
  return !old || old.version !== row.version || old.verifyJwt !== row.verify_jwt;
});
if (versionChanges.length !== 1 || versionChanges[0].slug !== slug ||
    versionChanges[0].version !== 38 || versionChanges[0].verify_jwt !== false ||
    versionChanges[0].status !== "ACTIVE")
  throw Error("Current LIVE function changes differ from one Control Plane update");

const temp = mkdtempSync("/private/tmp/learn-cp-v38-readback-");
try {
  mkdirSync(join(temp, "supabase"), { recursive: true });
  writeFileSync(join(temp, "supabase", "config.toml"), `project_id = "${project}"\n`);
  const downloaded = spawnSync(cli,
    ["functions", "download", slug, "--project-ref", project, "--workdir", temp, "--yes"],
    { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
      timeout: 120000, maxBuffer: 1024 * 1024 });
  if (downloaded.status !== 0) throw Error(`Function download failed (${downloaded.status})`);
  const root = join(temp, "supabase", "functions", slug);
  const actual = [];
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) actual.push(relative(root, path));
      else throw Error("Downloaded source shape changed");
    }
  };
  walk(root);
  const downloadedPath = path => path.startsWith("work/supabase/")
    ? path.slice("work/supabase/".length) : path;
  const expected = baseline.files.map(item => downloadedPath(item.path)).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected))
    throw Error("Downloaded Control Plane file list changed");
  const changed = [];
  for (const item of baseline.files) {
    const currentSha256 = fileSha(join(root, downloadedPath(item.path)));
    if (currentSha256 === item.sha256) continue;
    const repositoryPath = item.path === "index.ts"
      ? "supabase/functions/openfolk-control-plane/index.ts"
      : item.path.startsWith("work/") ? item.path.slice(5) : null;
    changed.push({ path: item.path, currentSha256,
      trackedGitMatches: !!repositoryPath && currentSha256 === fileSha(repositoryPath) });
  }
  const after = await inventory();
  const shape = rows => JSON.stringify(rows.map(row =>
    [row.slug, row.version, row.ezbr_sha256, row.verify_jwt, row.status])
    .sort((a, b) => a[0].localeCompare(b[0])));
  if (shape(before) !== shape(after)) throw Error("Function inventory moved during readback");
  const expectedDelta = new Map([
    ["index.ts", "00a3476d5488389e35a94306b91b1917c3ed2109c5cf618e288f0af6473583c1"],
    ["work/supabase/functions/_shared/controlplane/authz.ts", "784796439ceb49050808b14e981b1cae3ff217b10a6996bba250c5d0dc48cfb6"],
    ["work/supabase/functions/_shared/controlplane/roster.ts", "7d3733818cd15ba3415b4ea76542f8064a3a1ed855f07ee5e55edd572c61fc17"],
  ]);
  const exactDelta = changed.length === expectedDelta.size && changed.every(item =>
    expectedDelta.get(item.path) === item.currentSha256);
  let staged = false;
  if (mode === "--stage-exact-overlay") {
    if (!exactDelta) throw Error("Current Control Plane delta changed; no overlay staged");
    const output = ".verification-results/learn-build01-cp-v38-overlay-stage";
    if (existsSync(output)) throw Error("Overlay stage already exists; inspect before retry");
    mkdirSync(output, { mode: 0o700 });
    try {
      for (const item of changed) {
        const target = join(output, item.path);
        mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
        writeFileSync(target, readFileSync(join(root, downloadedPath(item.path))),
          { flag: "wx", mode: 0o600 });
        if (fileSha(target) !== item.currentSha256) throw Error("Staged overlay hash changed");
      }
      staged = true;
    } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
  }
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
    sourceArchiveManifestSha256: expectedManifest, sourceArchiveFunctions: 103,
    currentFunctions: before.length, unchangedFunctionVersions: 102,
    changedFunction: slug, oldVersion: 37, currentVersion: 38,
    currentFunctionFiles: actual.length, changedFiles: changed,
    unchangedFiles: actual.length - changed.length,
    exactExpectedDelta: exactDelta, overlayStagedLocally: staged,
    currentSourceRecoverableFrom: staged
      ? "v107 off-site package plus staged exact v38 overlay"
      : "not established by read-only comparison",
    credentialRecoveryProven: false, downloadedSourceDeleted: true,
    productionDataWrites: false, providerRequests: 0, secretValuesReturned: false }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
