/** Read-only merged history; cursor paging never depends on a globally capped inventory. */
type Db = { from(table: string): any };
const sources = ["data_imports", "email_sync_runs", "phone_sync_runs"] as const;
type Source = (typeof sources)[number];
type Key = { source: Source; id: string; at: string | null };
type Cursor = Key & {
  v: 1;
  tenant: string;
  provider: string | null;
  status: string | null;
  size: number;
  asOf: string;
  counts: number[];
  page: number;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
// Preserve PostgreSQL microseconds rather than treating distinct timestamps as ties.
const micros = (v: string) =>
  BigInt(Date.parse(v)) * 1000n +
  BigInt((v.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6) || "0");
function compare(a: Key, b: Key) {
  if (a.at !== b.at) {
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    const diff = micros(b.at) - micros(a.at);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
  }
  return a.source.localeCompare(b.source) || b.id.localeCompare(a.id);
}
function filterValue(v: unknown) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 128 || /[\u0000-\u001f\u007f]/.test(v))
    throw Error("Invalid discovery history filter");
  return v.trim() || null;
}
const encode = (v: Cursor) =>
  btoa(
    JSON.stringify(v).replace(
      /[\u007f-\uffff]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    ),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
function decode(value: string): Cursor {
  if (value.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw Error("Invalid discovery history cursor");
  try {
    const decoded = JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/")));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw Error("Invalid cursor");
    return decoded;
  } catch {
    throw Error("Invalid discovery history cursor");
  }
}
function predicate(source: Source, key: Key | null, asOf: string) {
  if (!key) return `started_at.is.null,started_at.lte.${asOf}`;
  const tie = source.localeCompare(key.source);
  const same =
    tie > 0
      ? key.at === null
        ? "started_at.is.null"
        : `started_at.eq.${key.at}`
      : tie === 0
        ? `and(started_at.${key.at === null ? "is.null" : `eq.${key.at}`},id.lt.${key.id})`
        : null;
  if (key.at === null) return same;
  return [`started_at.is.null`, `started_at.lt.${key.at}`, same].filter(Boolean).join(",");
}
const number = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
function normalize(r: any, source: Source) {
  const imported = source === "data_imports";
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    run_id: r.id,
    connection_id: null,
    provider: text(imported ? r.source_system : r.provider),
    capability: text(imported ? r.entity_type : r.sync_type),
    source,
    trigger: imported ? "import" : text(r.sync_type),
    actor: imported ? text(r.uploaded_by) : null,
    status: text(r.status),
    started_at: r.started_at,
    completed_at: r.completed_at,
    scanned: number(imported ? r.row_count : r.records_processed),
    created: imported ? number(r.created_records) : null,
    updated: imported ? number(r.updated_records) : null,
    unchanged: null,
    excluded: imported ? number(r.skipped_records) : null,
    ambiguous: imported ? number(r.conflict_records) : null,
    failed: imported ? number(r.invalid_rows) : null,
    warnings: imported ? number(r.duplicate_records) : null,
    error: text(imported ? r.failure : r.error_message)?.slice(0, 2000) ?? null,
    correlation_id: null,
  };
}

export async function loadDiscoveryHistory(
  db: Db,
  tenant: string,
  opts: {
    page?: number;
    page_size?: number;
    provider?: string | null;
    status?: string | null;
    cursor?: string | null;
  } = {},
  now = Date.now(),
) {
  const size = opts.page_size ?? 25,
    provider = filterValue(opts.provider),
    status = filterValue(opts.status);
  if (
    !uuid(tenant) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100 ||
    !Number.isFinite(now) ||
    Math.abs(now) > 8.64e15
  )
    throw Error("Invalid discovery history request");
  const cursor = opts.cursor ? decode(opts.cursor) : null;
  if (
    cursor &&
    (cursor.v !== 1 ||
      cursor.tenant !== tenant ||
      cursor.provider !== provider ||
      cursor.status !== status ||
      cursor.size !== size ||
      !timestamp(cursor.asOf) ||
      Date.parse(cursor.asOf) > now ||
      !sources.includes(cursor.source) ||
      !uuid(cursor.id) ||
      !(cursor.at === null || timestamp(cursor.at)) ||
      (cursor.at !== null && micros(cursor.at) > micros(cursor.asOf)) ||
      !Number.isSafeInteger(cursor.page) ||
      cursor.page < 1 ||
      !Array.isArray(cursor.counts) ||
      cursor.counts.length !== 3 ||
      cursor.counts.some((n) => number(n) === null))
  )
    throw Error("History cursor does not match this company or filter");
  if (
    opts.page !== undefined &&
    (!Number.isSafeInteger(opts.page) || opts.page < 0 || opts.page !== (cursor?.page ?? 0))
  )
    throw Error("Use the returned discovery history cursor for navigation");
  const asOf = cursor?.asOf ?? new Date(now).toISOString();
  const base = (source: Source, columns: string, head = false) => {
    let q = db
      .from(source)
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("tenant_id", tenant);
    if (provider) q = q.eq(source === "data_imports" ? "source_system" : "provider", provider);
    if (status) q = q.eq("status", status);
    if (source === "data_imports") q = q.lte("created_at", asOf);
    return q;
  };
  const counts = () =>
    Promise.all(
      sources.map(async (source) => {
        const r = await base(source, "id", true).or(predicate(source, null, asOf));
        if (r.error || number(r.count) === null)
          throw Error("Discovery history counts are unavailable");
        return r.count as number;
      }),
    );
  const before = await counts();
  if (cursor && before.some((n, i) => n !== cursor.counts[i]))
    throw Error("History changed. Refresh before continuing.");
  const total = before.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total)) throw Error("History count exceeds supported range");
  if (cursor && cursor.page >= Math.ceil(total / size))
    throw Error("History cursor is beyond the available pages");
  const collected = await Promise.all(
    sources.map(async (source, index) => {
      const retained: any[] = [];
      let key: Key | null = cursor,
        requests = 0,
        bytes = 0;
      const columns =
        source === "data_imports"
          ? "id,tenant_id,source_system,entity_type,status,started_at,completed_at,created_at,row_count,created_records,updated_records,skipped_records,duplicate_records,conflict_records,invalid_rows,uploaded_by,failure"
          : "id,tenant_id,provider,sync_type,status,started_at,completed_at,records_processed,error_message";
      const initialWhere = predicate(source, cursor, asOf);
      let remaining = 0;
      if (initialWhere !== null && before[index] > 0) {
        const counted = await base(source, "id", true).or(initialWhere);
        if (counted.error || number(counted.count) === null || counted.count > before[index])
          throw Error("Discovery history remaining count is unavailable");
        remaining = counted.count;
      }
      const target = Math.min(size + 1, remaining);
      while (retained.length < target) {
        const where = predicate(source, key, asOf);
        if (where === null) break;
        if (++requests > 150) throw Error("Discovery history read budget exceeded");
        const limit = target - retained.length;
        const r = await base(source, columns)
          .or(where)
          .order("started_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false })
          .limit(limit);
        if (r.error || !Array.isArray(r.data) || r.data.length > limit)
          throw Error("Discovery history could not be read");
        if (r.data.length === 0) break;
        bytes += new TextEncoder().encode(JSON.stringify(r.data)).byteLength;
        if (bytes > 2 * 1024 * 1024) throw Error("Discovery history response too large");
        for (const row of r.data) {
          const next: Key = { source, id: row.id, at: row.started_at };
          if (
            row.tenant_id !== tenant ||
            !uuid(row.id) ||
            !(row.started_at === null || timestamp(row.started_at)) ||
            !(row.completed_at === null || timestamp(row.completed_at)) ||
            (row.started_at !== null && micros(row.started_at) > micros(asOf)) ||
            (source === "data_imports" &&
              (!timestamp(row.created_at) || micros(row.created_at) > micros(asOf))) ||
            (key && compare(next, key) <= 0) ||
            (provider &&
              (source === "data_imports" ? row.source_system : row.provider) !== provider) ||
            (status && row.status !== status)
          )
            throw Error("Discovery history scope or ordering changed");
          retained.push(normalize(row, source));
          key = next;
        }
      }
      if (retained.length !== target) throw Error("Discovery history was truncated");
      return retained;
    }),
  );
  const after = await counts();
  if (after.some((n, i) => n !== before[i]))
    throw Error("History changed. Refresh before continuing.");
  const keyOf = (r: any): Key => ({ source: r.source, id: r.run_id, at: r.started_at });
  const merged = collected.flat().sort((a, b) => compare(keyOf(a), keyOf(b)));
  const page = cursor?.page ?? 0,
    runs = merged.slice(0, size),
    hasMore = merged.length > size;
  // Count arithmetic detects premature empty pages, not just server errors.
  const expected = Math.min(size, Math.max(0, total - page * size));
  if (runs.length !== expected || hasMore !== total > (page + 1) * size)
    throw Error("Discovery history was incomplete; refresh before continuing");
  const next = hasMore
    ? encode({
        ...keyOf(runs[runs.length - 1]),
        v: 1,
        tenant,
        provider,
        status,
        size,
        asOf,
        counts: before,
        page: page + 1,
      })
    : null;
  return { runs, page, page_size: size, total, has_more: hasMore, next_cursor: next, as_of: asOf };
}
