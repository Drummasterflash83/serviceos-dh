/** Private durable configuration readbacks. These contain metadata/digests only;
 * this module rejects secret values and conflicting replacements.
 */
import {
  constants,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  lstatSync,
  fstatSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const check = (v, m) => {
  if (!v) throw Error(m);
};
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const exact = (o, keys) => o && Object.keys(o).sort().join(",") === [...keys].sort().join(",");
export function validateConfigurationReceipt(r) {
  check(
    exact(r, [
      "projectRef",
      "candidateSha256",
      "stepId",
      "stepPinSha256",
      "secretDigests",
      "before",
      "after",
    ]) &&
      r.projectRef === "tgbnakbxwcqjeimygroz" &&
      ["matching-server-configuration", "activate-reviewed-input-dispatch"].includes(r.stepId) &&
      [r.candidateSha256, r.stepPinSha256].every(
        (s) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s),
      ),
    "Invalid receipt scope",
  );
  check(
    Array.isArray(r.secretDigests) &&
      r.secretDigests.length <= 200 &&
      new Set(r.secretDigests.map((s) => s.name)).size === r.secretDigests.length &&
      r.secretDigests.every(
        (s) =>
          exact(s, ["name", "digest"]) &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.name) &&
          /^[a-f0-9]{64}$/.test(s.digest),
      ),
    "Only secret names and digests may be persisted",
  );
  for (const rows of [r.before, r.after])
    check(
      Array.isArray(rows) &&
        rows.length >= 1 &&
        rows.length <= 200 &&
        new Set(rows.map((s) => s.name)).size === rows.length &&
        rows.every(
          (s) =>
            exact(s, ["name", "id", "version", "hash", "jwt", "status"]) &&
            /^[a-z0-9-]+$/.test(s.name) &&
            typeof s.id === "string" &&
            s.id.length < 100 &&
            Number.isSafeInteger(s.version) &&
            s.version >= 1 &&
            /^[a-f0-9]{64}$/.test(s.hash) &&
            typeof s.jwt === "boolean" &&
            s.status === "ACTIVE",
        ),
      "Invalid receipt runtime inventory",
    );
  return structuredClone(r);
}
export function openConfigurationReceiptStore(directory, { create = false } = {}) {
  const root = resolve(directory);
  if (create) mkdirSync(root, { mode: 0o700 });
  const st = lstatSync(root);
  check(
    st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0,
    "Private receipt directory required",
  );
  const path = (id) => {
    check(
      ["matching-server-configuration", "activate-reviewed-input-dispatch"].includes(id),
      "Unknown configuration step",
    );
    return join(root, id + ".json");
  };
  function load(id) {
    const file = path(id);
    let fd;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
    try {
      const info = fstatSync(fd);
      check(
        info.isFile() && (info.mode & 0o077) === 0 && info.size < 200000,
        "Unsafe receipt file",
      );
      const row = JSON.parse(readFileSync(fd, "utf8"));
      check(
        exact(row, ["receipt", "sha256"]) && row.sha256 === digest(row.receipt),
        "Receipt digest differs",
      );
      const r = validateConfigurationReceipt(row.receipt);
      check(r.stepId === id, "Receipt step differs");
      return r;
    } finally {
      closeSync(fd);
    }
  }
  return {
    load,
    save(id, value) {
      const receipt = validateConfigurationReceipt(value);
      check(receipt.stepId === id, "Receipt step differs");
      const prior = load(id);
      if (prior) {
        check(digest(prior) === digest(receipt), "Configuration receipt changed; do not replace");
        // A prior save may have reached the file but failed during directory fsync.
        // Re-establish durability before allowing the journal to accept that receipt.
        const fd = openSync(path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const dir = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
        return;
      }
      const fd = openSync(
        path(id),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, JSON.stringify({ receipt, sha256: digest(receipt) }) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const dir = openSync(root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    },
  };
}
