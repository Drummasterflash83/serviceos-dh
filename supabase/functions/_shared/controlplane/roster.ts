/** Read the complete bounded operator inventory through keyset pages. A failed,
 * changing or truncated inventory must never appear as an empty team. This is a
 * current read, not a transactionally frozen directory snapshot. */
const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;
const MAX_REQUESTS_PER_TABLE = 100;
const MAX_BYTES_PER_TABLE = 8 * 1024 * 1024;
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(v);

export async function loadRoster(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
) {
  if (!uuid(tenantId) || !Number.isFinite(now) || Math.abs(now) > 8.64e15)
    throw new Error("Invalid roster scope");
  const cutoff = new Date(now).toISOString();
  const read = async (table: string, columns: string, order: string, openOnly = false) => {
    const unavailable = () => new Error(`Complete roster data could not be read (${table})`);
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
      if (openOnly) q = q.or(`effective_to.is.null,effective_to.gt.${cutoff}`);
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
        String(a[order] ?? "").localeCompare(String(b[order] ?? "")) || a.id.localeCompare(b.id),
    );
    return retained;
  };
  const [members, responsibilities, authorityGrants] = await Promise.all([
    read(
      "team_members",
      "id,display_name,formal_role,formal_role_status,target_role,observed_role,observed_status,authority_level,org_unit_id,profile_id,effective_from,effective_to",
      "display_name",
    ),
    read(
      "responsibility_assignments",
      "id,member_id,kind,target_ref,label,raci_role,is_shared,weekday_mask,cover_for,confirmed,effective_from,effective_to,version",
      "label",
      true,
    ),
    read(
      "authority_grants",
      "id,member_id,permission,scope,scope_ref,confirmed,effective_from,effective_to",
      "permission",
      true,
    ),
  ]);
  return { members, responsibilities, authorityGrants };
}
