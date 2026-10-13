/** Authorised metadata-only inventory. Source credentials stay in process memory.
 * Private object paths/recording links never enter stdout, logs or Git. */
import { savedCliToken } from "../verify/learn-test-readiness.mjs";
import { createVoicemailSource } from "./recording-backup-source.mjs";
import { createHash } from "node:crypto";
import { mkdir, lstat, mkdtemp, open, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (process.argv.slice(2).join(" ") !== "--drummonds-voicemail-metadata-only")
  throw Error("Explicit --drummonds-voicemail-metadata-only scope required");
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001",
  deadline = AbortSignal.timeout(20 * 60 * 1000);
let progress;
try {
  const token = savedCliToken();
  let managementRequests = 0;
  const management = async (suffix) => {
    if (++managementRequests > 3) throw Error("management_bound");
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(30000)]),
    });
    if (!response.ok || !response.body) throw Error("management_unavailable");
    const chunks = [];
    let bytes = 0;
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > 1024 * 1024) throw Error("management_size");
      chunks.push(part);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const identity = await management("");
  if (
    identity.id !== project ||
    identity.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
    identity.status !== "ACTIVE_HEALTHY"
  )
    throw Error("source_identity");
  const keys = await management("/api-keys?reveal=true");
  const secrets = await management("/secrets");
  const selected = secrets.find((s) => s.name === "SUPABASE_SERVICE_ROLE_KEY");
  const digest = selected?.digest ?? selected?.value;
  const matches = keys.filter(
    (k) =>
      typeof k.api_key === "string" &&
      createHash("sha256").update(k.api_key).digest("hex") === digest,
  );
  if (matches.length !== 1) throw Error("source_credential_binding");
  const key = matches[0].api_key;
  if (typeof key !== "string" || !key) throw Error("source_credential");
  const summaries = [];
  for (const bucket of ["receptionist-voicemails", "learn-voicemail-sources"]) {
    const source = createVoicemailSource({ tenantId: tenant, sourceProjectRef: project }, bucket, {
      credentials: async () => ({ apikey: key, token: key }),
      requestBudget: 5000,
      fetcher: (url, options) => {
        const path = new URL(url).pathname;
        const metadataGet =
          options.method === "GET" &&
          (path.startsWith("/rest/v1/") ||
            path === `/storage/v1/bucket/${bucket}` ||
            path.startsWith(`/storage/v1/object/info/authenticated/${bucket}/`));
        const metadataPost =
          options.method === "POST" && path === `/storage/v1/object/list/${bucket}`;
        if (!metadataGet && !metadataPost) throw Error("metadata_only_transport");
        return fetch(url, { ...options, signal: AbortSignal.any([deadline, options.signal]) });
      },
    });
    progress = setInterval(
      () =>
        console.log(
          JSON.stringify({
            outcome: "inventory_in_progress",
            sourceRequests: source.usage().requests,
            audioBytesDownloaded: 0,
            sourceWrites: 0,
          }),
        ),
      30000,
    );
    const result = await source.inventory();
    clearInterval(progress);
    const parent = fileURLToPath(new URL("../../.verification-results/", import.meta.url));
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw Error("private_directory");
    await chmod(parent, 0o700);
    const directory = await mkdtemp(join(parent, "voicemail-inventory-"));
    const writePrivate = async (name, value) => {
      const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
      const file = await open(join(directory, name), "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      return createHash("sha256").update(bytes).digest("hex");
    };
    const inventorySha256 = await writePrivate("inventory.json", result.inventory);
    const reconciliationSha256 = await writePrivate("reconciliation.json", result.reconciliation);
    const r = result.reconciliation;
    const summary = {
      version: "voicemail-source-full-inventory/1",
      sourceBucket: bucket,
      observedAt: result.inventory.observedAt,
      completedAt: new Date().toISOString(),
      outcome: "complete_metadata_inventory_verified",
      projectRef: project,
      tenantId: tenant,
      managementRequests,
      sourceRequests: source.usage().requests,
      objects: r.objects,
      recordingRows: r.recordingRows,
      totalBytes: r.totalBytes,
      unreferencedObjects: r.unreferencedObjects,
      preparedReferences: r.preparedReferences,
      rowsWithoutStoragePointer: r.rowsWithoutStoragePointer,
      missingObjectReferences: r.missingObjectReferences.length,
      inventorySha256,
      reconciliationSha256,
      sourceSnapshot: "non_atomic",
      privateInventoryPersisted: true,
      audioBytesDownloaded: 0,
      sourceWrites: 0,
      awsRequests: 0,
      backupComplete: false,
    };
    await writePrivate("summary.json", summary);
    const dirHandle = await open(directory, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
    summaries.push(summary);
    console.log(JSON.stringify(summary, null, 2));
  }
  console.log(
    JSON.stringify({
      outcome: "both_voicemail_bucket_inventories_verified",
      buckets: summaries.length,
      totalObjects: summaries.reduce((n, s) => n + s.objects, 0),
      totalBytes: summaries.reduce((n, s) => n + s.totalBytes, 0),
      downloadedBytes: 0,
      awsRequests: 0,
      backupComplete: false,
    }),
  );
} catch (error) {
  clearInterval(progress);
  console.error(
    JSON.stringify({
      outcome: "inventory_unconfirmed",
      code: error?.code && /^[a-z_]+$/.test(error.code) ? error.code : "inventory_failed",
    }),
  );
  process.exitCode = 1;
}
