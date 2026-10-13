/** Read-only Supabase source adapter. Run inside an authorised ServiceOS/server
 * environment. Never export its source credentials to AWS or persist them. */
import { createHash, randomUUID } from "node:crypto";
import {
  recordingIdentity,
  RecordingBackupError,
  voicemailBackupBuckets,
} from "./recording-backup-core.mjs";
const uuid = (v) =>
  typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const requireValue = (ok, code) => {
  if (!ok) throw new RecordingBackupError(code);
};
const safe = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RecordingBackupError) throw e;
    throw new RecordingBackupError("source_request_unconfirmed");
  }
};
const canonical = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const hash = (v) => createHash("sha256").update(canonical(v)).digest("hex");
const etag = (v) => {
  requireValue(
    typeof v === "string" &&
      v.length > 0 &&
      v.length <= 200 &&
      !v.startsWith("W/") &&
      !/[\r\n]/.test(v),
    "source_etag_unverified",
  );
  const result = v.replace(/^"(.*)"$/, "$1");
  requireValue(/^[a-zA-Z0-9-]+$/.test(result), "source_etag_unverified");
  return result;
};
export function createRecordingSource(binding, options = {}) {
  return createBucketSource(binding, "phone-recordings", options);
}
/** The only additional source buckets; no caller-supplied table, origin or path. */
export function createVoicemailSource(binding, bucket, options = {}) {
  requireValue(voicemailBackupBuckets.includes(bucket), "source_bucket_outside_scope");
  return createBucketSource(binding, bucket, options);
}
function createBucketSource(
  binding,
  bucket,
  { credentials, fetcher = fetch, now = Date.now, requestBudget = 100000 } = {},
) {
  requireValue(
    uuid(binding?.tenantId) &&
      /^[a-z]{20}$/.test(binding?.sourceProjectRef ?? "") &&
      typeof credentials === "function" &&
      Number.isSafeInteger(requestBudget) &&
      requestBudget > 0 &&
      requestBudget <= 100000,
    "source_binding_invalid",
  );
  const tenantId = binding.tenantId,
    sourceProjectRef = binding.sourceProjectRef;
  const origin = `https://${sourceProjectRef}.supabase.co`,
    prefix = `${tenantId}/`;
  let requests = 0,
    inspectedAt = null;
  const keyValid = (key) =>
    requireValue(
      typeof key === "string" &&
        key.startsWith(prefix) &&
        key.length <= 4096 &&
        !/[\x00-\x1f\x7f\\]/.test(key) &&
        key.split("/").every((p) => p && p !== "." && p !== ".."),
      "source_key_outside_scope",
    );
  const encodeKey = (key) => {
    keyValid(key);
    return key.split("/").map(encodeURIComponent).join("/");
  };
  async function request(path, { query = {}, body, extraHeaders = {}, timeout = 30000 } = {}) {
    requireValue(requests < requestBudget, "source_request_budget_exhausted");
    requests++;
    const auth = await credentials();
    requireValue(
      typeof auth?.apikey === "string" &&
        auth.apikey &&
        typeof auth?.token === "string" &&
        auth.token,
      "source_credentials_missing",
    );
    const url = new URL(path, origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const response = await fetcher(url, {
      method: body ? "POST" : "GET",
      headers: {
        apikey: auth.apikey,
        Authorization: `Bearer ${auth.token}`,
        "Cache-Control": "no-cache",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new RecordingBackupError("source_response_unavailable");
    }
    return response;
  }
  async function json(path, options) {
    const response = await request(path, options),
      reader = response.body.getReader(),
      chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        requireValue(bytes <= 8 * 1024 * 1024, "source_response_too_large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const inspect = () =>
    safe(async () => {
      if (inspectedAt !== null && now() >= inspectedAt && now() - inspectedAt < 60000)
        return { tenantId, sourceProjectRef, bucket, private: true };
      const tenant = await json("/rest/v1/tenants", {
        query: { select: "id", id: `eq.${tenantId}`, limit: "1" },
      });
      requireValue(
        Array.isArray(tenant) && tenant.length === 1 && tenant[0].id === tenantId,
        "source_tenant_unverified",
      );
      const store = await json(`/storage/v1/bucket/${bucket}`);
      requireValue(
        store?.id === bucket && store.name === bucket && store.public === false,
        "source_bucket_unverified",
      );
      inspectedAt = now();
      return { tenantId, sourceProjectRef, bucket, private: true };
    });
  async function voicemailReferences(path) {
    const rows = [],
      isAudio = bucket === "receptionist-voicemails";
    let cursor = null;
    while (true) {
      const page = await json(
        `/rest/v1/${isAudio ? "receptionist_voicemail_intakes" : "receptionist_voicemail_sources"}`,
        {
          query: {
            select: isAudio
              ? "id,tenant_id,mailbox_id,audio_sha256,audio_bytes,state"
              : "id,tenant_id,intake_id,raw_sha256,raw_bytes",
            tenant_id: `eq.${tenantId}`,
            order: "id.asc",
            limit: "500",
            ...(cursor ? { id: `gt.${cursor}` } : {}),
          },
        },
      );
      requireValue(Array.isArray(page) && page.length <= 500, "source_references_unverified");
      if (!page.length) break;
      for (const r of page) {
        const digest = isAudio ? r.audio_sha256 : r.raw_sha256,
          size = isAudio ? r.audio_bytes : r.raw_bytes;
        requireValue(
          r?.tenant_id === tenantId &&
            uuid(r.id) &&
            (!cursor || r.id > cursor) &&
            uuid(isAudio ? r.mailbox_id : r.intake_id) &&
            /^[a-f0-9]{64}$/.test(digest ?? "") &&
            Number.isSafeInteger(size) &&
            size > 0 &&
            size <= (isAudio ? 26214400 : 1048576) &&
            (!isAudio || ["prepared", "published"].includes(r.state)),
          "source_references_unverified",
        );
        const storagePath = isAudio
          ? `${tenantId}/${r.mailbox_id}/${r.id}`
          : `${tenantId}/${r.intake_id}/${r.id}.eml`;
        keyValid(storagePath);
        rows.push({
          id: r.id,
          storagePath,
          sha256: digest,
          size,
          state: isAudio ? r.state : "source_retained",
        });
        cursor = r.id;
        requireValue(rows.length <= 10000, "source_reference_limit");
      }
    }
    if (isAudio) {
      let last = null,
        count = 0;
      const published = new Set();
      while (true) {
        const page = await json("/rest/v1/receptionist_voicemails", {
          query: {
            select: "id,tenant_id,mailbox_id,recording_path",
            tenant_id: `eq.${tenantId}`,
            order: "id.asc",
            limit: "500",
            ...(last ? { id: `gt.${last}` } : {}),
          },
        });
        requireValue(
          Array.isArray(page) && page.length <= 500,
          "source_published_references_unverified",
        );
        if (!page.length) break;
        for (const r of page) {
          const ref = rows.find((x) => x.id === r.id);
          requireValue(
            r.tenant_id === tenantId &&
              uuid(r.id) &&
              (!last || r.id > last) &&
              uuid(r.mailbox_id) &&
              ref?.state === "published" &&
              r.recording_path === ref.storagePath &&
              r.recording_path === `${tenantId}/${r.mailbox_id}/${r.id}`,
            "source_published_references_unverified",
          );
          published.add(r.id);
          last = r.id;
          requireValue(++count <= 10000, "source_reference_limit");
        }
      }
      requireValue(
        rows.filter((r) => r.state === "published").every((r) => published.has(r.id)),
        "source_published_references_unverified",
      );
    }
    return path === undefined ? rows : rows.filter((r) => r.storagePath === path);
  }
  async function references(path) {
    if (path !== undefined) keyValid(path);
    if (bucket !== "phone-recordings") return voicemailReferences(path);
    const rows = [];
    let cursor = null;
    while (true) {
      const page = await json("/rest/v1/phone_recordings", {
        query: {
          select: "id,tenant_id,storage_path",
          tenant_id: `eq.${tenantId}`,
          order: "id.asc",
          limit: "500",
          ...(path !== undefined ? { storage_path: `eq.${path}` } : {}),
          ...(cursor ? { id: `gt.${cursor}` } : {}),
        },
      });
      requireValue(Array.isArray(page) && page.length <= 500, "source_references_unverified");
      if (!page.length) break;
      for (const row of page) {
        requireValue(
          row?.tenant_id === tenantId &&
            uuid(row.id) &&
            (!cursor || row.id > cursor) &&
            (row.storage_path === null || typeof row.storage_path === "string") &&
            (path === undefined || row.storage_path === path),
          "source_references_unverified",
        );
        if (row.storage_path !== null) keyValid(row.storage_path);
        rows.push({ id: row.id, storagePath: row.storage_path });
        cursor = row.id;
        requireValue(rows.length <= 10000, "source_reference_limit");
      }
    }
    return rows;
  }
  async function listAll() {
    // Begin at the tenant root, not the folders implied by existing row pointers.
    const pending = [tenantId],
      folders = new Set(pending),
      objects = [],
      ids = new Set(),
      paths = new Set();
    while (pending.length) {
      const folder = pending.shift();
      let offset = 0;
      const names = new Set();
      while (true) {
        const page = await json(`/storage/v1/object/list/${bucket}`, {
          body: { prefix: folder, limit: 500, offset, sortBy: { column: "name", order: "asc" } },
        });
        requireValue(Array.isArray(page) && page.length <= 500, "source_listing_unverified");
        if (!page.length) break;
        for (const item of page) {
          requireValue(
            item &&
              typeof item.name === "string" &&
              item.name &&
              !item.name.includes("/") &&
              !names.has(item.name),
            "source_listing_unverified",
          );
          names.add(item.name);
          const key = `${folder}/${item.name}`;
          keyValid(key);
          if (item.id === null) {
            requireValue(
              item.metadata === null && !folders.has(key) && key.split("/").length <= 32,
              "source_folder_unverified",
            );
            folders.add(key);
            pending.push(key);
            requireValue(folders.size <= 10000, "source_folder_limit");
            continue;
          }
          requireValue(
            uuid(item.id) &&
              !ids.has(item.id) &&
              !paths.has(key) &&
              Number.isSafeInteger(item.metadata?.size) &&
              item.metadata.size >= 0 &&
              Number.isFinite(Date.parse(item.updated_at)),
            "source_object_unverified",
          );
          ids.add(item.id);
          paths.add(key);
          objects.push({
            id: item.id,
            key,
            size: item.metadata.size,
            updatedAt: new Date(item.updated_at).toISOString(),
            etag: etag(item.metadata.eTag),
          });
          requireValue(objects.length <= 10000, "source_object_limit");
        }
        offset += page.length;
      }
    }
    return objects.sort((a, b) => a.id.localeCompare(b.id));
  }
  async function info(key) {
    const result = await json(`/storage/v1/object/info/authenticated/${bucket}/${encodeKey(key)}`);
    requireValue(
      uuid(result?.id) &&
        result.name === key &&
        result.bucket_id === bucket &&
        typeof result.version === "string" &&
        result.version.length > 0 &&
        result.version.length <= 128 &&
        Number.isSafeInteger(result.size) &&
        result.size >= 0 &&
        result.size <= 256 * 1024 * 1024 &&
        Number.isFinite(Date.parse(result.last_modified)) &&
        result.is_delete_marker !== true,
      "source_info_unverified",
    );
    return {
      id: result.id,
      key,
      size: result.size,
      updatedAt: new Date(result.last_modified).toISOString(),
      etag: etag(result.etag),
      version: result.version,
    };
  }
  const identity = (details, ids, refs = []) => {
    const matches = refs.filter((r) => r.storagePath === details.key);
    requireValue(
      matches.every((r) => r.size === details.size) &&
        new Set(matches.map((r) => r.sha256)).size <= 1,
      "source_content_binding_changed",
    );
    return recordingIdentity({
      tenantId,
      objectId: details.id,
      sourceKey: details.key,
      size: details.size,
      sourceVersion: JSON.stringify([details.version, details.etag, details.updatedAt]),
      recordingIds: ids,
      ...(bucket === "phone-recordings" ? {} : { sourceBucket: bucket }),
      ...(matches.length ? { sourceContentSha256: matches[0].sha256 } : {}),
    });
  };
  const metadata = (input) =>
    safe(async () => {
      const entry = recordingIdentity(input);
      requireValue(entry.tenantId === tenantId, "foreign_tenant");
      requireValue(
        entry.sourceBucket === (bucket === "phone-recordings" ? undefined : bucket),
        "source_bucket_outside_scope",
      );
      keyValid(entry.sourceKey);
      await inspect();
      const details = await info(entry.sourceKey),
        refs = await references(entry.sourceKey);
      return identity(
        details,
        refs.map((r) => r.id),
        bucket === "phone-recordings" ? [] : refs,
      );
    });
  const read = (input) =>
    safe(async () => {
      const entry = recordingIdentity(input);
      requireValue(entry.tenantId === tenantId, "foreign_tenant");
      requireValue(
        entry.sourceBucket === (bucket === "phone-recordings" ? undefined : bucket),
        "source_bucket_outside_scope",
      );
      const current = await metadata(entry);
      requireValue(canonical(current) === canonical(entry), "source_changed");
      const version = JSON.parse(entry.sourceVersion),
        expectedEtag = etag(version[1]);
      const response = await request(
        `/storage/v1/object/authenticated/${bucket}/${encodeKey(entry.sourceKey)}`,
        { extraHeaders: { "If-Match": `"${expectedEtag}"` }, timeout: 120000 },
      );
      try {
        const length = response.headers.get("content-length");
        requireValue(
          length !== null &&
            /^\d+$/.test(length) &&
            Number(length) === entry.size &&
            etag(response.headers.get("etag")) === expectedEtag &&
            !response.headers.get("content-range") &&
            (!response.headers.get("content-encoding") ||
              response.headers.get("content-encoding") === "identity"),
          "source_download_unverified",
        );
      } catch (e) {
        await response.body.cancel().catch(() => {});
        throw e;
      }
      return (async function* () {
        const reader = response.body.getReader();
        let bytes = 0;
        const contentHash = createHash("sha256");
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            contentHash.update(part.value);
            requireValue(bytes <= entry.size, "source_byte_length_mismatch");
            yield part.value;
          }
          requireValue(bytes === entry.size, "source_byte_length_mismatch");
          const digest = contentHash.digest("hex");
          requireValue(
            entry.sourceContentSha256 === undefined || digest === entry.sourceContentSha256,
            "source_content_hash_mismatch",
          );
        } catch (e) {
          if (e instanceof RecordingBackupError) throw e;
          throw new RecordingBackupError("source_stream_unconfirmed");
        } finally {
          await reader.cancel().catch(() => {});
        }
      })();
    });
  const inventory = () =>
    safe(async () => {
      await inspect();
      const observedAt = new Date(now()).toISOString();
      const beforeRefs = await references(),
        before = await listAll();
      const entries = [];
      const idsByPath = new Map();
      for (const row of beforeRefs)
        if (row.storagePath !== null) {
          const ids = idsByPath.get(row.storagePath) ?? [];
          ids.push(row.id);
          idsByPath.set(row.storagePath, ids);
        }
      // Shorten the non-atomic observation window without weakening either
      // complete listing/reference comparison. Drain each bounded batch before
      // propagating failure; no requests may outlive the inventory attempt.
      for (let offset = 0; offset < before.length; offset += 4) {
        const batch = await Promise.allSettled(
          before.slice(offset, offset + 4).map(async (object) => {
            const details = await info(object.key);
            requireValue(
              canonical({ ...details, version: undefined }) === canonical(object),
              "source_changed",
            );
            return identity(
              details,
              idsByPath.get(object.key) ?? [],
              bucket === "phone-recordings" ? [] : beforeRefs,
            );
          }),
        );
        const failure = batch.find((r) => r.status === "rejected");
        if (failure) throw failure.reason;
        entries.push(...batch.map((r) => r.value));
      }
      const after = await listAll(),
        afterRefs = await references();
      requireValue(
        canonical(before) === canonical(after) && canonical(beforeRefs) === canonical(afterRefs),
        "source_inventory_changed",
      );
      const keys = new Set(entries.map((e) => e.sourceKey));
      const missing = beforeRefs.filter((r) => r.storagePath !== null && !keys.has(r.storagePath));
      return {
        inventory: {
          contract: "recording-inventory/1",
          runId: randomUUID(),
          tenantId,
          sourceProjectRef,
          observedAt,
          listingComplete: true,
          sourceSnapshot: "non_atomic",
          objects: entries,
        },
        reconciliation: {
          contract: "recording-source-reconciliation/1",
          tenantId,
          sourceProjectRef,
          recordingRows: beforeRefs.length,
          ...(bucket === "phone-recordings"
            ? {}
            : {
                sourceBucket: bucket,
                preparedReferences: beforeRefs.filter((r) => r.state === "prepared").length,
              }),
          objects: entries.length,
          totalBytes: entries.reduce((n, e) => n + e.size, 0),
          unreferencedObjects: entries.filter((e) => !e.recordingIds.length).length,
          rowsWithoutStoragePointer: beforeRefs.filter((r) => r.storagePath === null).length,
          missingObjectReferences: missing,
          referenceSha256: hash(beforeRefs),
          listingSha256: hash(before),
          verification: "matching_recursive_listings_and_reference_passes",
          limitations: [
            "Non-atomic observation; copy rechecks each source revision and references.",
            "Missing files and null pointers remain unresolved; this inventory is not a backup or database restore.",
          ],
        },
      };
    });
  return { inspect, inventory, metadata, read, usage: () => ({ requests, requestBudget }) };
}
