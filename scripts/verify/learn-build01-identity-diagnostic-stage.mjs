/** Read-only stage of the current worker closure for a narrow identity diagnostic. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--stage-test", "--stage-live"].includes(mode))
  throw Error("Exact TEST or LIVE read-only stage mode required");
const label = mode.endsWith("test") ? "test" : "live";
const project = label === "test" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const target = "_shared/worker_handlers/identity_resolve.ts";
// functions download returns the serving transpiled source, not the original TS.
const baseline = "b75f111652cf3253b7d3bf2a950ec22968772908a423ca51c1616da3089eaddf";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const candidate = readFileSync(resolve("supabase/functions", target));
const candidateSha256 = sha(candidate);
if (candidateSha256 === baseline) throw Error("Identity diagnostic source unchanged");
const token = savedCliToken();
async function management(path) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Current Edge ${path.split("/")[1]} read HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const inventory = JSON.parse((await management("/functions")).toString("utf8"));
if (!Array.isArray(inventory)) throw Error("Edge inventory invalid");
const root = mkdtempSync(resolve(`.verification-results/build01-identity-diagnostic-${label}-`));
const results = [];
// Identity publication is owned by the claimed platform worker on both hosts.
const slugs = ["platform-worker"];
for (const slug of slugs) {
  const entry = inventory.find(item => item.slug === slug);
  if (!entry || !Number.isSafeInteger(entry.version) || entry.status !== "ACTIVE" ||
      typeof entry.verify_jwt !== "boolean" || typeof entry.ezbr_sha256 !== "string")
    throw Error(`Current ${slug} runtime changed: ${JSON.stringify({
      version: entry?.version, status: entry?.status, verifyJwt: entry?.verify_jwt,
      hasHash: typeof entry?.ezbr_sha256 === "string" })}`);
  const workspace = join(root, slug);
  mkdirSync(workspace, { mode: 0o700 });
  const downloaded = spawnSync(cli, ["functions", "download", slug,
    "--project-ref", project, "--workdir", workspace], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 2 * 1024 * 1024,
  });
  if (downloaded.status !== 0) throw Error(`Current ${slug} source download unavailable`);
  const sourceRoot = join(workspace, "supabase/functions", slug);
  const stage = join(workspace, "stage");
  const paths = [];
  function collect(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) collect(path);
      else if (item.isFile()) paths.push(path);
      else throw Error("Downloaded Edge closure contains non-file");
    }
  }
  collect(sourceRoot);
  const minimumFiles = 100;
  if (paths.length < minimumFiles || paths.length > 250 ||
      !paths.some(path => relative(sourceRoot, path) === "index.ts"))
    throw Error(`Current ${slug} closure shape changed`);
  const manifest = [];
  let patched = 0;
  for (const path of paths) {
    const fromSlug = relative(sourceRoot, path).replaceAll("\\", "/");
    const rel = fromSlug.startsWith("functions/")
      ? fromSlug.slice("functions/".length) : `${slug}/${fromSlug}`;
    if (rel.includes("..") || !/\.(ts|js|json)$/.test(rel))
      throw Error("Downloaded Edge closure path invalid");
    const source = readFileSync(path);
    const next = rel === target ? candidate : source;
    if (rel === target) {
      if (sha(source) !== baseline) throw Error(`Current ${slug} handler baseline changed`);
      patched++;
    }
    const destination = join(stage, "supabase/functions", rel);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, next, { mode: 0o600 });
    manifest.push({ path: rel, sha256: sha(next) });
  }
  if (patched !== 1 || new Set(manifest.map(item => item.path)).size !== manifest.length)
    throw Error(`Current ${slug} handler mapping changed`);
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${project}"\n[functions.${slug}]\nverify_jwt = ${entry.verify_jwt}\n`,
    { mode: 0o600 });
  const rollback = await management(`/functions/${slug}/body`);
  if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
    throw Error(`Current ${slug} rollback body invalid`);
  writeFileSync(join(workspace, "rollback.eszip"), rollback, { flag: "wx", mode: 0o600 });
  results.push({ slug, version: entry.version, beforeWireSha256: entry.ezbr_sha256,
    verifyJwt: entry.verify_jwt,
    beforeBodySha256: sha(rollback), candidateHandlerSha256: candidateSha256,
    closureSha256: sha(JSON.stringify(manifest.sort((a, b) => a.path.localeCompare(b.path)))),
    sourceFiles: manifest.length, stage });
}
const result = { version: "learn-build01-identity-diagnostic-stage/1",
  observedAtUtc: new Date().toISOString(), project, label, root, results,
  productionWrites: false, providerRequests: 0, secretsReturned: false };
writeFileSync(join(root, "manifest.json"), JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
