/** Exact-item recovery escrow. No account access until an exported async method
 * is called; enabling CLI integration requires the separate owner decision. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const OP = "/private/tmp/serviceos-op-2.40.0/op";
const OP_SHA256 = "7dff93952c49d25133c8a2487ab7072e656368d4e7089f055f119bc8d1066ae2";
const FIELD = "serviceos_database_recovery";
const TITLE = "Openfolk ServiceOS";
const canonical = (value) =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export class RecoveryEscrowError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const need = (ok, code) => {
  if (!ok) throw new RecoveryEscrowError(code);
};
export function validateRecoveryMaterial(value) {
  need(
    value?.contract === "serviceos-database-recovery-material/1" &&
      value.project === "tgbnakbxwcqjeimygroz" &&
      /^age1[0-9a-z]{58}$/.test(value.ageRecipient ?? "") &&
      /^AGE-SECRET-KEY-1[0-9A-Z]{50,100}$/.test(value.ageIdentity ?? "") &&
      /^[0-9a-fA-F]{64}$/.test(value.vaultRootKey ?? ""),
    "recovery_material_invalid",
  );
  need(
    Object.keys(value).sort().join(",") ===
      "ageIdentity,ageRecipient,contract,project,vaultRootKey",
    "recovery_material_fields_unexpected",
  );
  return { ...value };
}
function validateBinding(binding) {
  need(
    ["accountId", "vaultId", "itemId"].every((k) => /^[a-z0-9]{26}$/.test(binding?.[k] ?? "")),
    "onepassword_binding_invalid",
  );
  need(binding.title === TITLE, "onepassword_title_invalid");
  return {
    accountId: binding.accountId,
    vaultId: binding.vaultId,
    itemId: binding.itemId,
    title: TITLE,
  };
}
function validateItem(item, binding) {
  need(
    item?.id === binding.itemId && item?.vault?.id === binding.vaultId && item.title === TITLE,
    "onepassword_item_mismatch",
  );
  need(
    item.category === "SECURE_NOTE" &&
      Array.isArray(item.fields) &&
      item.fields.every((f) => typeof f.id === "string") &&
      new Set(item.fields.map((f) => f.id)).size === item.fields.length,
    "onepassword_item_shape_unverified",
  );
  // CLI template editing warns that passkeys would be overwritten. Do not edit
  // an item carrying unsupported attachments or passkey material.
  need(
    !item.files?.length &&
      !item.passkeys?.length &&
      !item.fields.some((f) => /passkey/i.test(f.type ?? "")),
    "onepassword_item_has_unsupported_material",
  );
  need(Number.isSafeInteger(item.version) && item.version > 0, "onepassword_item_version_missing");
  return item;
}
function savedMaterial(item) {
  const fields = item.fields.filter((f) => f.id === FIELD);
  need(fields.length === 1 && fields[0].type === "CONCEALED", "recovery_material_missing");
  try {
    return validateRecoveryMaterial(JSON.parse(fields[0].value));
  } catch {
    throw new RecoveryEscrowError("recovery_material_invalid");
  }
}
async function executeCli(args, input) {
  need(
    createHash("sha256")
      .update(await readFile(OP))
      .digest("hex") === OP_SHA256,
    "onepassword_binary_pin_mismatch",
  );
  // No inherited OP_SERVICE_ACCOUNT_TOKEN, OP_SESSION or Connect credentials.
  // This route is the owner-authorised desktop session only.
  const env = { PATH: "/usr/bin:/bin", HOME: process.env.HOME, LANG: "en_US.UTF-8" };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return new Promise((resolve, reject) => {
    const child = spawn(OP, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0,
      failure = false;
    const timer = setTimeout(() => {
      failure = true;
      child.kill("SIGTERM");
    }, 120000);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        failure = true;
        child.kill("SIGTERM");
      } else chunks.push(chunk);
    });
    child.stderr.on("data", () => {}); // Never forward potentially secret-bearing diagnostics.
    child.stdin.on("error", () => {
      failure = true;
    });
    child.once("error", () => {
      failure = true;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0)
        reject(new RecoveryEscrowError("onepassword_operation_unconfirmed"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(input ?? "");
  });
}
export function createRecoveryEscrow(binding, { execute = executeCli } = {}) {
  const bound = validateBinding(binding);
  const suffix = ["--account", bound.accountId, "--vault", bound.vaultId, "--format=json"];
  const get = async () => {
    try {
      return validateItem(
        JSON.parse(await execute(["item", "get", bound.itemId, ...suffix])),
        bound,
      );
    } catch (error) {
      if (error instanceof RecoveryEscrowError) throw error;
      throw new RecoveryEscrowError("onepassword_read_unconfirmed");
    }
  };
  return {
    binding: bound,
    async read() {
      return savedMaterial(await get());
    },
    async saveIfAbsent(input) {
      const material = validateRecoveryMaterial(input);
      const before = await get();
      if (before.fields.some((f) => f.id === FIELD)) {
        need(
          canonical(savedMaterial(before)) === canonical(material),
          "recovery_material_conflict",
        );
        return { state: "existing_material_read_back", ...bound, secretsPrinted: false };
      }
      need(
        !before.fields.some((f) => f.label === "ServiceOS database recovery"),
        "recovery_field_label_conflict",
      );
      const next = structuredClone(before);
      next.fields.push({
        id: FIELD,
        label: "ServiceOS database recovery",
        type: "CONCEALED",
        value: canonical(material),
      });
      // A last read catches an intervening change; CLI/server concurrency is not
      // claimed as a compare-and-swap contract. Post-write preservation is checked.
      need(canonical(await get()) === canonical(before), "onepassword_item_changed");
      try {
        await execute(["item", "edit", bound.itemId, ...suffix], JSON.stringify(next));
      } catch {
        throw new RecoveryEscrowError("onepassword_write_unconfirmed_read_before_retry");
      }
      const after = await get();
      need(canonical(savedMaterial(after)) === canonical(material), "recovery_readback_mismatch");
      for (const field of before.fields)
        need(
          canonical(after.fields.find((f) => f.id === field.id)) === canonical(field),
          "onepassword_existing_field_changed",
        );
      for (const key of ["title", "category", "sections", "tags", "urls", "notesPlain", "files"])
        need(
          canonical(after[key]) === canonical(before[key]),
          "onepassword_existing_metadata_changed",
        );
      return { state: "material_saved_and_read_back", ...bound, secretsPrinted: false };
    },
  };
}
