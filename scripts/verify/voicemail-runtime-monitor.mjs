/** Runtime guards for the real voicemail path. Shared helper edits are compiled
 * into these bundles, so their immutable hashes cover the dependency closure. */
export const voicemailRuntimeDependencies = Object.freeze([
  "platform-worker", // discovery tick, queue, signed-source import and email engine
  "learn-voicemail-import", // direct, privileged signed-source endpoint
  "email-workspace-scheduled-sync",
  "email-workspace-backfill-scheduled-sync",
  "email-scheduled-sync", // existing queue schedulers for notification ingestion
  "gmail-workspace-sync-messages",
  "gmail-workspace-backfill-messages",
  "gmail-sync-messages", // direct adapters using the same capture engine
  "google-workspace-discover-mailboxes", // explicitly invoked by queue discovery
  "receptionist-voicemail-recording", // private voicemail playback authorization
]);
const fingerprint = (row) =>
  row
    ? JSON.stringify([
        row.slug,
        row.id,
        row.version,
        row.ezbr_sha256,
        row.verify_jwt,
        row.status,
        row.entrypoint_path,
        row.import_map,
        row.import_map_path,
      ])
    : null;
function index(rows) {
  if (!Array.isArray(rows)) throw Error("runtime_metadata_unverified");
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.slug !== "string" || map.has(row.slug))
      throw Error("runtime_metadata_unverified");
    map.set(row.slug, row);
  }
  return map;
}
export function inspectVoicemailRuntimes(expected, current) {
  const before = index(expected),
    after = index(current),
    relevant = new Set(voicemailRuntimeDependencies);
  for (const name of relevant) {
    if (
      !before.has(name) ||
      !after.has(name) ||
      before.get(name).status !== "ACTIVE" ||
      after.get(name).status !== "ACTIVE" ||
      fingerprint(before.get(name)) !== fingerprint(after.get(name))
    )
      throw Error("voicemail_dependency_runtime_changed");
  }
  const unrelated = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    if (relevant.has(name) || fingerprint(before.get(name)) === fingerprint(after.get(name)))
      continue;
    const a = before.get(name),
      b = after.get(name);
    unrelated.push({
      name,
      beforeVersion: a?.version ?? null,
      afterVersion: b?.version ?? null,
      beforeHash: a?.ezbr_sha256 ?? null,
      afterHash: b?.ezbr_sha256 ?? null,
      change: !a ? "added" : !b ? "removed" : "changed",
    });
  }
  return {
    verifiedDependencies: relevant.size,
    unrelated: unrelated.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
