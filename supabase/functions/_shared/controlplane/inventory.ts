/** Read the complete bounded operator inventory through keyset pages. A failed,
 * changing or truncated inventory must never appear as an empty team. This is a
 * current read, not a transactionally frozen directory snapshot. */
const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;
const MAX_REQUESTS_PER_TABLE = 100;
const MAX_BYTES_PER_TABLE = 8 * 1024 * 1024;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);

export async function readOperatorInventory(
  db: { from(table: string): any },
  tenantId: string,
  table: string,
  columns: string,
  options: { filter?: (query: any) => any; order?: string; label?: string } = {},
) {
  if (!uuid(tenantId)) throw new Error("Invalid operator inventory scope");
  const unavailable = () =>
    new Error(`Complete ${options.label ?? "operator"} data could not be read (${table})`);
  let requests = 0;
  const query = (countOnly = false) => {
    if (++requests > MAX_REQUESTS_PER_TABLE) throw unavailable();
    let q = db
      .from(table)
      .select(
        countOnly ? "id" : `tenant_id,${columns}`,
        countOnly ? { count: "exact", head: true } : undefined,
      )
      .eq("tenant_id", tenantId);
    if (options.filter) q = options.filter(q);
    return q;
  };
  const count = async () => {
    const result = await query(true);
    if (
      result.error ||
      !Number.isSafeInteger(result.count) ||
      result.count < 0 ||
      result.count > MAX_ROWS
    )
      throw unavailable();
    return result.count as number;
  };
  const expected = await count();
  const retained: any[] = [];
  let cursor: string | null = null,
    bytes = 0;
  while (true) {
    let q = query().order("id", { ascending: true });
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q.limit(PAGE_SIZE);
    if (error || !Array.isArray(data) || data.length > PAGE_SIZE) throw unavailable();
    // A server may enforce a lower limit. Only an empty page proves exhaustion.
    if (data.length === 0) break;
    bytes += new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (bytes > MAX_BYTES_PER_TABLE || retained.length + data.length > expected)
      throw unavailable();
    for (const row of data) {
      if (
        !row ||
        row.tenant_id !== tenantId ||
        !uuid(row.id) ||
        (cursor !== null && row.id <= cursor)
      )
        throw unavailable();
      cursor = row.id;
      retained.push(row);
    }
  }
  if (retained.length !== expected || (await count()) !== expected) throw unavailable();
  // Preserve the operator's readable ordering after transport paging by stable ID.
  retained.sort(
    (a, b) =>
      String(a[options.order ?? "id"] ?? "").localeCompare(
        String(b[options.order ?? "id"] ?? ""),
      ) || a.id.localeCompare(b.id),
  );
  return retained;
}
