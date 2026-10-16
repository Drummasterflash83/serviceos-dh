/** Read-only receipt scan for the latest failed communication inventory. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { binding, loadRecordingCredential } from "../backup/drummonds-recording-backup-access.mjs";
import { createRecordingS3 } from "../backup/recording-backup-s3.mjs";
import { recordingReceiptIdentity } from "../backup/recording-backup-core.mjs";

if (process.argv.slice(2).join(" ") !== "--latest-failed-read-only")
  throw Error("Exact latest-failed read-only mode required");
const attempt = JSON.parse(readFileSync(".verification-results/recording-daily/last-attempt.json"));
if (attempt.state !== "failed" || attempt.code !== "s3_request_unconfirmed" ||
    typeof attempt.runDirectory !== "string" ||
    !attempt.runDirectory.startsWith(process.cwd() + "/.verification-results/recording-daily/run-"))
  throw Error("Expected latest failed inventory unavailable");
const inventory = JSON.parse(readFileSync(join(attempt.runDirectory, "inventory.json")));
if (inventory.contract !== "recording-inventory/1" ||
    inventory.tenantId !== binding.tenantId || !inventory.listingComplete ||
    !Array.isArray(inventory.objects) || inventory.objects.length > 10000)
  throw Error("Failed inventory scope changed");
const writer = await loadRecordingCredential("Writer");
const s3 = createRecordingS3(binding, {
  credentials: async () => ({ accessKeyId: writer.accessKeyId,
    secretAccessKey: writer.secretAccessKey }),
  expectedPrincipalArn: writer.principalArn,
  readAttempts: 3,
  signal: AbortSignal.timeout(360000),
});
let next = 0, found = 0, absent = 0, failure = null;
try {
  await s3.destination.inspect();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (failure === null) {
      const index = next++;
      if (index >= inventory.objects.length) return;
      try {
        const receipt = await s3.journal.load(
          recordingReceiptIdentity(inventory.objects[index], binding));
        if (receipt) found++; else absent++;
        if ((found + absent) % 500 === 0)
          console.log(JSON.stringify({ state: "scanning", checked: found + absent,
            total: inventory.objects.length }));
      } catch (error) {
        failure ??= { index, code: error?.code ?? "unconfirmed" };
      }
    }
  }));
} finally {
  s3.close();
}
const result = { state: failure ? "journal_read_failed" : "journal_read_verified",
  total: inventory.objects.length, found, absent, failure,
  sourceContentRead: false, newObjectsWritten: 0, messageContentReturned: false };
console.log(JSON.stringify(result));
if (failure) process.exitCode = 1;
