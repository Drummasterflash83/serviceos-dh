/** Exact pg_dump command for an exported PostgreSQL snapshot. */
export function databaseDumpCommand(snapshot, { dedicatedReader = false } = {}) {
  if (typeof snapshot !== "string" || !/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/.test(snapshot))
    throw Error("database_snapshot_invalid");
  return `pg_dump -w --format=custom --compress=6 ${dedicatedReader ? "" : "--role=postgres "}--snapshot=${snapshot} --lock-wait-timeout=5s`;
}
