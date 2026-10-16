/** Archive exact currently deployed LIVE Edge Function sources for recovery.
 * This reads the Management API and writes only to the ignored private results
 * directory. It never prints source, configuration values or credentials.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const INVENTORY_URL = `https://api.supabase.com/v1/projects/${PROJECT}/functions`;
const PRIVATE = resolve(".verification-results");
const SLUG = /^[a-z][a-z0-9-]{0,99}$/;

async function inventory(token) {
  const response = await fetch(INVENTORY_URL, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("runtime_inventory_unconfirmed");
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250 ||
      rows.some((row) => !row || !SLUG.test(row.slug) ||
        !Number.isSafeInteger(row.version) || row.version < 1 ||
        typeof row.status !== "string"))
    throw Error("runtime_inventory_invalid");
  const active = rows.filter((row) => row.status === "ACTIVE")
    .map((row) => ({ slug: row.slug, version: row.version,
      verifyJwt: row.verify_jwt ?? null }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (new Set(active.map((row) => row.slug)).size !== active.length)
    throw Error("runtime_inventory_duplicate");
  return active;
}

async function filesBelow(root) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw Error("runtime_archive_symlink");
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const content = await readFile(child);
        files.push({ path: relative(root, child), bytes: content.length,
          sha256: createHash("sha256").update(content).digest("hex") });
      } else throw Error("runtime_archive_nonfile");
    }
  }
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function archiveLiveRuntime({
  // The newer CLI download path returns one flattened index per function. This
  // pinned version retains the dependency tree needed for an isolated rebuild.
  cli = process.env.SUPABASE_CLI_BIN ??
    "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
  token = savedCliToken(),
  at = new Date(),
} = {}) {
  const before = await inventory(token);
  const root = join(PRIVATE, `build01-runtime-archive-${at.toISOString().replaceAll(/[:.]/g, "-")}`);
  await mkdir(root, { recursive: false, mode: 0o700 });
  const entries = [];
  for (const item of before) {
    const workdir = join(root, item.slug);
    await mkdir(workdir, { mode: 0o700 });
    const downloaded = spawnSync(cli, ["functions", "download", item.slug,
      "--project-ref", PROJECT, "--workdir", workdir], {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
      encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024,
    });
    if (downloaded.status !== 0) throw Error(`runtime_download_unconfirmed:${item.slug}`);
    const source = join(workdir, "supabase", "functions", item.slug);
    if (!(await stat(source)).isDirectory()) throw Error(`runtime_source_missing:${item.slug}`);
    const files = await filesBelow(source);
    if (files.length === 0) throw Error(`runtime_source_empty:${item.slug}`);
    if (item.slug === "platform-worker" &&
        !files.some((file) => file.path === "functions/_shared/email_capture_engine.ts"))
      throw Error("runtime_worker_dependency_tree_missing");
    entries.push({ ...item, files });
    if (entries.length % 10 === 0) console.log(JSON.stringify({ archived: entries.length,
      expected: before.length, sourcePrinted: false }));
  }
  const after = await inventory(token);
  const same = JSON.stringify(after) === JSON.stringify(before);
  const manifest = { contract: "build01-live-runtime-archive/1", project: PROJECT,
    startedAt: at.toISOString(), completedAt: new Date().toISOString(),
    inventoryStable: same, activeFunctions: before.length, entries };
  await writeFile(join(root, "manifest.private.json"),
    JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const bytes = entries.reduce((n, entry) => n + entry.files.reduce((m, file) => m + file.bytes, 0), 0);
  const files = entries.reduce((n, entry) => n + entry.files.length, 0);
  const result = { state: same ? "runtime_source_archive_verified" : "runtime_inventory_changed",
    activeFunctions: before.length, archivedFunctions: entries.length,
    files, bytes, sourcePrinted: false, productionWrites: false,
    manifest: join(root, "manifest.private.json") };
  if (!same) throw Error("runtime_inventory_changed");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).join(" ") !== "--live-read-only")
      throw Error("runtime_archive_mode_invalid");
    console.log(JSON.stringify(await archiveLiveRuntime()));
  } catch (error) {
    console.error(JSON.stringify({ state: "runtime_archive_unconfirmed",
      code: error instanceof Error ? error.message : "unknown", sourcePrinted: false }));
    process.exitCode = 1;
  }
}
