/** Bounded read-only Drummonds metadata probe. Reuses the existing CLI login and
 * existing service credential in memory; no credentials or customer paths output.
 * Never downloads audio, creates access, changes source data or contacts AWS. */
import { savedCliToken } from "../verify/learn-test-readiness.mjs";
import { createRecordingSource } from "./recording-backup-source.mjs";
import { createHash } from "node:crypto";
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
if (process.argv.slice(2).join(" ") !== "--drummonds-metadata-only")
  throw Error("Explicit --drummonds-metadata-only scope required");
try {
  const token = savedCliToken();
  let managementRequests = 0;
  async function management(path, query) {
    if (++managementRequests > 3) throw Error("bound");
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
      method: query ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(query ? { body: JSON.stringify({ query }) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error("unavailable");
    const parts = [];
    let bytes = 0;
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > 1024 * 1024) throw Error("size");
      parts.push(part);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  }
  const identity = await management("");
  if (
    identity.id !== project ||
    identity.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
    identity.status !== "ACTIVE_HEALTHY"
  )
    throw Error("identity");
  const sample = await management(
    "/database/query/read-only",
    `select o.id,o.name as storage_path,(o.metadata->>'size')::bigint as size,
  o.updated_at,o.metadata->>'eTag' as etag,coalesce((select jsonb_agg(r.id order by r.id) from public.phone_recordings r
  where r.tenant_id='${tenant}' and r.storage_path=o.name),'[]') as recording_ids
  from storage.objects o where o.bucket_id='phone-recordings' and o.name like '${tenant}/%'
  and o.metadata->>'size' ~ '^[0-9]+$' order by o.id limit 1`,
  );
  if (!Array.isArray(sample) || sample.length !== 1) throw Error("sample");
  const keys = await management("/api-keys");
  const key = keys.find((k) => k.name === "service_role")?.api_key;
  if (typeof key !== "string" || !key) throw Error("credential");
  const source = createRecordingSource(
    { tenantId: tenant, sourceProjectRef: project },
    { credentials: async () => ({ apikey: key, token: key }), requestBudget: 12 },
  );
  const row = sample[0];
  const entry = {
    tenantId: tenant,
    objectId: row.id,
    sourceKey: row.storage_path,
    sourceVersion: "metadata-probe",
    size: Number(row.size),
    recordingIds: row.recording_ids,
  };
  const first = await source.metadata(entry),
    second = await source.metadata(first);
  const revision = JSON.parse(first.sourceVersion);
  if (
    JSON.stringify(first) !== JSON.stringify(second) ||
    first.objectId !== entry.objectId ||
    first.sourceKey !== entry.sourceKey ||
    first.size !== entry.size ||
    JSON.stringify(first.recordingIds) !== JSON.stringify(entry.recordingIds) ||
    new Date(revision[2]).getTime() !== new Date(row.updated_at).getTime() ||
    revision[1] !== row.etag.replace(/^"(.*)"$/, "$1")
  )
    throw Error("metadata_differs");
  console.log(
    JSON.stringify(
      {
        version: "recording-source-metadata-probe/1",
        observedAt: new Date().toISOString(),
        projectRef: project,
        tenantId: tenant,
        outcome: "one_real_object_metadata_verified",
        managementRequests,
        sourceRequests: source.usage().requests,
        storagePrivate: true,
        objectIdAndPathMatch: true,
        versionPresent: true,
        etagMatches: true,
        updatedAtMatches: true,
        sizeMatches: true,
        recordingReferences: first.recordingIds.length,
        repeatedMetadataMatches: true,
        adapterSha256: createHash("sha256")
          .update(
            await (
              await import("node:fs/promises")
            ).readFile(new URL("./recording-backup-source.mjs", import.meta.url)),
          )
          .digest("hex"),
        audioBytesDownloaded: 0,
        sourceWrites: 0,
        awsRequests: 0,
        limitations: [
          "One-object metadata probe; not complete source coverage or a backup.",
          "No audio playback, real S3 transfer, restored database or scheduled operation verified.",
        ],
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      outcome: "source_probe_unconfirmed",
      code: error?.code && /^[a-z_]+$/.test(error.code) ? error.code : "source_probe_failed",
    }),
  );
  process.exitCode = 1;
}
