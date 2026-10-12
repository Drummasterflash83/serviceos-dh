import test from "node:test";
import assert from "node:assert/strict";
import { createRecoveryEscrow, RecoveryEscrowError } from "./onepassword-database-recovery.mjs";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
const binding = {
  accountId: "a".repeat(26),
  vaultId: "b".repeat(26),
  itemId: "c".repeat(26),
  title: "Openfolk ServiceOS",
};
const material = {
  contract: "serviceos-database-recovery-material/1",
  project: "tgbnakbxwcqjeimygroz",
  ageRecipient: "age1" + "a".repeat(58),
  ageIdentity: "AGE-SECRET-KEY-1" + "A".repeat(59),
  vaultRootKey: "12".repeat(32),
};
function fixture() {
  let item = {
    id: binding.itemId,
    title: binding.title,
    vault: { id: binding.vaultId },
    category: "SECURE_NOTE",
    version: 1,
    fields: [{ id: "notesPlain", type: "STRING", value: "Existing synthetic note; preserve me" }],
    tags: ["synthetic"],
  };
  const calls = [];
  let loseReply = false,
    editOnSecondRead = false,
    reads = 0;
  const execute = async (args, input) => {
    calls.push({ args, input });
    assert.deepEqual(args.slice(2), [
      binding.itemId,
      "--account",
      binding.accountId,
      "--vault",
      binding.vaultId,
      "--format=json",
    ]);
    assert.ok(!args.join(" ").includes(material.ageIdentity));
    assert.ok(!args.join(" ").includes(material.vaultRootKey));
    if (args[1] === "get") {
      if (++reads === 2 && editOnSecondRead) item.version++;
      return JSON.stringify(item);
    }
    assert.equal(args[1], "edit");
    item = { ...JSON.parse(input), version: item.version + 1 };
    if (loseReply) {
      loseReply = false;
      throw Error("PRIVATE vendor response");
    }
    return JSON.stringify(item);
  };
  return {
    escrow: createRecoveryEscrow(binding, { execute }),
    calls,
    get item() {
      return item;
    },
    set item(value) {
      item = value;
    },
    set loseReply(v) {
      loseReply = v;
    },
    set editOnSecondRead(v) {
      editOnSecondRead = v;
    },
  };
}
test("only named pinned item is updated using stdin; existing note survives and readback matches", async () => {
  const f = fixture();
  const old = structuredClone(f.item.fields[0]);
  const receipt = await f.escrow.saveIfAbsent(material);
  assert.equal(receipt.state, "material_saved_and_read_back");
  assert.ok(!JSON.stringify(receipt).includes(material.vaultRootKey));
  assert.deepEqual(f.item.fields[0], old);
  assert.deepEqual(await f.escrow.read(), material);
  await f.escrow.saveIfAbsent(material);
  assert.equal(f.calls.filter((c) => c.args[1] === "edit").length, 1);
});
test("ambiguous/wrong item, passkeys, attachments, changed version and conflicting values stop edits", async () => {
  for (const alter of [
    (f) => (f.item.id = "z".repeat(26)),
    (f) => (f.item.title = "Different note"),
    (f) => (f.item.files = [{}]),
    (f) => (f.item.passkeys = [{}]),
    (f) => (f.item.category = "LOGIN"),
    (f) => (f.editOnSecondRead = true),
  ]) {
    const f = fixture();
    alter(f);
    await assert.rejects(f.escrow.saveIfAbsent(material), RecoveryEscrowError);
    assert.equal(f.calls.filter((c) => c.args[1] === "edit").length, 0);
  }
  const f = fixture();
  await f.escrow.saveIfAbsent(material);
  await assert.rejects(
    f.escrow.saveIfAbsent({ ...material, vaultRootKey: "34".repeat(32) }),
    /recovery_material_conflict/,
  );
  assert.equal(f.calls.filter((c) => c.args[1] === "edit").length, 1);
});
test("uncertain edit stops without leaking diagnostics; next read confirms original saved value", async () => {
  const f = fixture();
  f.loseReply = true;
  await assert.rejects(
    f.escrow.saveIfAbsent(material),
    (e) =>
      e.code === "onepassword_write_unconfirmed_read_before_retry" &&
      !e.message.includes("PRIVATE"),
  );
  const result = await f.escrow.saveIfAbsent(material);
  assert.equal(result.state, "existing_material_read_back");
  assert.equal(f.calls.filter((c) => c.args[1] === "edit").length, 1);
});
test("database credentials use their own role-specific Keychain entry and reject cross-role access", async () => {
  for (const role of ["Writer", "Restore"]) {
    let calls = 0;
    const execute = async (command, args) => {
      calls++;
      assert.equal(command, "/usr/bin/security");
      assert.deepEqual(args, [
        "find-generic-password",
        "-s",
        `OpenFolk.ServiceOS.DatabaseBackup.${role}`,
        "-a",
        "235099643372",
        "-w",
      ]);
      return {
        stdout: JSON.stringify({
          accessKeyId: "AKIA" + "A".repeat(16),
          secretAccessKey: "a".repeat(40),
          principalArn: `arn:aws:iam::235099643372:user/serviceos/database-backup/openfolk-serviceos-database-backup-${role}-synthetic`,
        }),
      };
    };
    assert.ok((await loadDatabaseCredential(role, execute)).principalArn.includes(role));
    assert.equal(calls, 1);
    await assert.rejects(
      loadDatabaseCredential(role, async () => ({
        stdout: JSON.stringify({
          accessKeyId: "AKIA" + "A".repeat(16),
          secretAccessKey: "a".repeat(40),
          principalArn: "arn:aws:iam::235099643372:user/serviceos/recording-backup/other",
        }),
      })),
      /database_scoped_credential_unverified/,
    );
  }
});
