import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRunArgs,
  loadWriterCredential,
  binding,
  createLiveRecordingPorts,
} from "./run-drummonds-recording-backup.mjs";
test("source request ceiling is validated before opening live credentials", async () => {
  for (const requestBudget of [0, -1, 100001, Infinity, 1.5])
    await assert.rejects(createLiveRecordingPorts(AbortSignal.abort(), { requestBudget }), {
      code: "runner_source_budget_invalid",
    });
});
test("live CLI requires exact Drummonds action, pinned inventory and bounded copy limits", () => {
  const args = ["--copy-drummonds", "/private/inventory", "a".repeat(64)];
  assert.equal(parseRunArgs(args).mode, "copy");
  assert.equal(parseRunArgs(["--finalize-drummonds", ...args.slice(1)]).mode, "finalize");
  assert.equal(parseRunArgs([...args, "100", "268435456"]).maxObjects, 100);
  for (const invalid of [
    [],
    ["--copy", ...args.slice(1)],
    args.slice(0, 2),
    [...args, "101", "1"],
    [...args, "1", "268435457"],
    [...args, "0", "1"],
    [...args, "1", "-1"],
  ])
    assert.throws(() => parseRunArgs(invalid), { code: "runner_arguments_invalid" });
});
test("credential loader reads only the approved Writer Keychain service/account and rejects root or Restore", async () => {
  const credential = {
    accessKeyId: "AKIA" + "A".repeat(16),
    secretAccessKey: "A".repeat(40),
    principalArn: `arn:aws:iam::${binding.accountId}:user/serviceos/recording-backup/openfolk-drummonds-recording-access-Writer-SYNTHETIC`,
  };
  const execute = async (cmd, args, opts) => {
    assert.equal(cmd, "/usr/bin/security");
    assert.deepEqual(args, [
      "find-generic-password",
      "-s",
      "OpenFolk.ServiceOS.RecordingBackup.Writer",
      "-a",
      binding.accountId,
      "-w",
    ]);
    assert.equal(opts.maxBuffer, 4096);
    assert.equal(opts.timeout, 15000);
    return { stdout: JSON.stringify(credential) };
  };
  assert.equal((await loadWriterCredential(execute)).principalArn, credential.principalArn);
  for (const principalArn of [
    `arn:aws:iam::${binding.accountId}:root`,
    credential.principalArn.replace("-Writer-", "-Restore-"),
    credential.principalArn.replace(binding.accountId, "123456789012"),
  ])
    await assert.rejects(
      loadWriterCredential(async () => ({
        stdout: JSON.stringify({ ...credential, principalArn }),
      })),
      { code: "runner_writer_credential_unverified" },
    );
});
