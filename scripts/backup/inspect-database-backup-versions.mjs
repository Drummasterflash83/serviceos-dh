/** Read-only, aggregate-only check for objects possibly left by a failed hosted run. */
import { S3Client, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { loadDatabaseCredential } from "./serviceos-database-backup-access.mjs";
import { databaseBackupBinding as binding } from "./database-backup-template.mjs";

const arg = process.argv[2];
if (process.argv.length !== 3 || !/^--since=20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(arg ?? ""))
  throw Error("exact_read_only_since_required");
const since = Date.parse(arg.slice(8));
if (!Number.isFinite(since) || since > Date.now() || Date.now() - since > 7 * 86400000)
  throw Error("backup_inspection_window_invalid");

const credential = await loadDatabaseCredential("Restore");
const credentials = { accessKeyId: credential.accessKeyId,
  secretAccessKey: credential.secretAccessKey };
const options = { region: binding.region, credentials, maxAttempts: 1 };
const sts = new STSClient(options);
const s3 = new S3Client(options);
try {
  const identity = await sts.send(new GetCallerIdentityCommand({}),
    { abortSignal: AbortSignal.timeout(15000) });
  if (identity.Account !== binding.accountId || identity.Arn !== credential.principalArn)
    throw Error("backup_restore_identity_changed");
  let keyMarker, versionMarker, pages = 0;
  const observed = [];
  do {
    const page = await s3.send(new ListObjectVersionsCommand({
      Bucket: binding.bucket, Prefix: `${binding.prefix}objects/`, MaxKeys: 1000,
      ...(keyMarker ? { KeyMarker: keyMarker, VersionIdMarker: versionMarker } : {}),
    }), { abortSignal: AbortSignal.timeout(30000) });
    pages++;
    for (const value of page.Versions ?? []) {
      if (typeof value.Key !== "string" ||
        !value.Key.startsWith(`${binding.prefix}objects/`) ||
        !(value.LastModified instanceof Date) || !Number.isSafeInteger(value.Size))
        throw Error("backup_version_listing_unverified");
      if (value.LastModified.getTime() >= since)
        observed.push({ at: value.LastModified.toISOString(), bytes: value.Size });
    }
    if (!page.IsTruncated) break;
    if (pages >= 4 || !page.NextKeyMarker || !page.NextVersionIdMarker)
      throw Error("backup_version_listing_incomplete");
    keyMarker = page.NextKeyMarker;
    versionMarker = page.NextVersionIdMarker;
  } while (true);
  observed.sort((a, b) => b.at.localeCompare(a.at));
  console.log(JSON.stringify({ version: "serviceos-database-object-inspection/1",
    observedAt: new Date().toISOString(), since: new Date(since).toISOString(),
    identity: "approved_restore_only", objectsSince: observed.length,
    newest: observed[0] ?? null, pagesChecked: pages,
    objectKeysPrinted: false, productionWrites: false }));
} finally {
  s3.destroy(); sts.destroy();
  credential.secretAccessKey = "";
}
