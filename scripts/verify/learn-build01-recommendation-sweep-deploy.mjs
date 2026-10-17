/** Exact staged TEST/LIVE Edge release with rollback bytes and before/after inventory. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const [mode, manifestArg, receiptFlag, receiptArg] = process.argv.slice(2);
if (!["--deploy-test", "--deploy-live"].includes(mode) || !manifestArg ||
    (mode === "--deploy-test" && (receiptFlag || receiptArg)) ||
    (mode === "--deploy-live" && (receiptFlag !== "--test-receipt" || !receiptArg)))
  throw Error("Exact staged release arguments required");
const label = mode.endsWith("test") ? "test" : "live";
const project = label === "test" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const privateRoot = resolve(".verification-results");
const manifestPath = resolve(manifestArg);
if (!manifestPath.startsWith(privateRoot + "/") || realpathSync(manifestPath) !== manifestPath)
  throw Error("Private stage path invalid");
const staged = JSON.parse(readFileSync(manifestPath, "utf8"));
if (staged.version !== "learn-build01-recommendation-sweep-stage/1" ||
    staged.label !== label || staged.project !== project ||
    !Array.isArray(staged.results) ||
    staged.results.length !== (label === "test" ? 1 : 2))
  throw Error("Exact staged release manifest changed");
const compiled = JSON.parse(readFileSync(join(staged.root, "compile-manifest-network.json"), "utf8"));
if (compiled.version !== "learn-build01-recommendation-sweep-compile/1" ||
    compiled.label !== label || !compiled.dependencyNetworkEnabled ||
    !Array.isArray(compiled.results) || compiled.results.length !== staged.results.length ||
    compiled.results.some(item => item.status !== 0 || !item.eszip))
  throw Error("Exact candidate compile not verified");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const candidates = staged.results.map((entry, index) => {
  const build = compiled.results[index];
  if (build.slug !== entry.slug || entry.candidateHandlerSha256 !== staged.results[0].candidateHandlerSha256)
    throw Error("Compiled candidate differs from staged source");
  const bytes = readFileSync(join(staged.root, "artifacts", `${entry.slug}.eszip`));
  if (sha(bytes) !== build.sha256 || !bytes.subarray(0, 5).equals(Buffer.from("ESZIP")))
    throw Error("Compiled executable differs");
  const wire = Buffer.concat([Buffer.from("EZBR"), brotliCompressSync(bytes,
    { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })]);
  if (!brotliDecompressSync(wire.subarray(4)).equals(bytes)) throw Error("Candidate wire roundtrip differs");
  return { entry, build, bytes, wire, wireSha256: sha(wire) };
});
if (label === "live") {
  const receiptPath = resolve(receiptArg);
  if (!receiptPath.startsWith(privateRoot + "/") || realpathSync(receiptPath) !== receiptPath)
    throw Error("TEST acceptance receipt path invalid");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.state !== "hosted_test_full_sweep_verified" ||
      receipt.candidateHandlerSha256 !== staged.results[0].candidateHandlerSha256 ||
      receipt.workerArtifactSha256 !== candidates[0].build.sha256)
    throw Error("Exact hosted TEST acceptance missing");
}
const token = savedCliToken();
const base = `https://api.supabase.com/v1/projects/${project}`;
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Edge ${path.split("?")[0]} HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const inventory = async () => JSON.parse((await request("/functions")).toString("utf8"));
const slugs = new Set(candidates.map(item => item.entry.slug));
const other = rows => rows.filter(row => !slugs.has(row.slug))
  .map(row => [row.slug, row.version, row.ezbr_sha256, row.verify_jwt])
  .sort((a, b) => a[0].localeCompare(b[0]));
const beforeAll = await inventory();
for (const { entry } of candidates) {
  const current = beforeAll.find(row => row.slug === entry.slug);
  if (!current || current.version !== entry.version ||
      current.ezbr_sha256 !== entry.beforeWireSha256 ||
      current.verify_jwt !== entry.verifyJwt || current.status !== "ACTIVE" ||
      sha(await request(`/functions/${entry.slug}/body`)) !== entry.beforeBodySha256)
    throw Error(`Current ${entry.slug} runtime differs from stage`);
}
const journalPath = join(staged.root, "deploy-journal.json");
const journal = { state: "prepared", project, label, startedAtUtc: new Date().toISOString(),
  before: staged.results.map(entry => ({ slug: entry.slug, version: entry.version,
    wireSha256: entry.beforeWireSha256, bodySha256: entry.beforeBodySha256 })),
  otherBefore: other(beforeAll), completed: [] };
const save = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
for (const candidate of candidates) {
  const { entry, build, wire, wireSha256 } = candidate;
  journal.state = `${entry.slug}_patch_requested`; save();
  const params = new URLSearchParams({ verify_jwt: String(entry.verifyJwt),
    entrypoint_path: `file:///work/supabase/functions/${entry.slug}/index.ts`,
    ezbr_sha256: wireSha256 });
  await request(`/functions/${entry.slug}?${params}`, { method: "PATCH",
    headers: { "Content-Type": "application/vnd.denoland.eszip" }, body: wire });
  journal.state = `${entry.slug}_patch_acknowledged`; save();
  const current = (await inventory()).find(row => row.slug === entry.slug);
  const body = await request(`/functions/${entry.slug}/body`);
  if (!current || current.version !== entry.version + 1 ||
      current.ezbr_sha256 !== wireSha256 || current.status !== "ACTIVE" ||
      current.verify_jwt !== entry.verifyJwt || sha(body) !== build.sha256) {
    journal.state = `${entry.slug}_readback_mismatch_inspect`; save();
    throw Error(`Current ${entry.slug} deployment unconfirmed`);
  }
  journal.completed.push({ slug: entry.slug, version: current.version,
    bodySha256: sha(body), wireSha256 });
  journal.state = `${entry.slug}_verified`; save();
}
const afterAll = await inventory();
if (JSON.stringify(other(beforeAll)) !== JSON.stringify(other(afterAll))) {
  journal.state = "unrelated_inventory_changed_inspect"; save();
  throw Error("Unrelated Edge inventory changed");
}
journal.state = "exact_candidates_deployed";
journal.verifiedAtUtc = new Date().toISOString(); save();
console.log(JSON.stringify({ state: journal.state, project, label,
  versions: journal.completed, unrelatedChanged: false,
  providerRequests: 0, productionDataWrites: false }));
