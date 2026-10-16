/** One escrow read and an in-memory verification of the exact off-site copy. */
import { spawn } from "node:child_process";
import { readFile, lstat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRecoveryEscrow } from "./onepassword-database-recovery.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const privateRoot = join(repo, ".verification-results");
const bindingPath = join(privateRoot, "database-backup-onepassword-binding.json");
const encryptedPath = join(privateRoot,
  "build01-live-edge-source-restore-b7c9a0e4-8420-4c22-a7f8-58b743d10903.age");
const agePath = "/private/tmp/serviceos-age-1.3.2/age";

async function privateFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw Error("runtime_private_file_invalid");
  }
}

async function main() {
  if (process.argv.length !== 2) throw Error("runtime_arguments_invalid");
  await privateFile(bindingPath);
  await privateFile(encryptedPath);
  const binding = JSON.parse(await readFile(bindingPath, "utf8"));
  const material = await createRecoveryEscrow(binding).read();
  return await new Promise((resolve, reject) => {
    const child = spawn("python3", ["-B", join(repo, "scripts/backup/verify_live_runtime_package.py"),
      "--encrypted", encryptedPath, "--age", agePath], {
      cwd: repo, stdio: ["pipe", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 120000);
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (output.length > 8192) child.kill("SIGTERM");
    });
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code !== 0 || result.state !== "decrypted_live_edge_source_verified") {
          reject(Error(result.code ?? "runtime_restore_unverified"));
        } else resolve(result);
      } catch {
        reject(Error("runtime_restore_unverified"));
      }
    });
    child.stdin.end(material.ageIdentity + "\n");
    material.ageIdentity = "";
    material.vaultRootKey = "";
  });
}

try {
  console.log(JSON.stringify(await main()));
} catch (error) {
  console.error(JSON.stringify({ state: "runtime_restore_unverified",
    code: error.message === "onepassword_operation_unconfirmed" ? error.message
      : "runtime_restore_unverified", secretsPrinted: false }));
  process.exitCode = 1;
}
