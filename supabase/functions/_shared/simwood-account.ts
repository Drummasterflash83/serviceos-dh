/** Resolve company-owned phone accounts from the existing server-managed registry.
 * Never discover a customer using shared credentials or trust a caller's account ID.
 */
type AccountDb = { from: (table: string) => any };
export type SimwoodAccountResult =
  | { ok: true; customerId: string; accountId: string; connectorId: string }
  | { ok: false; code: string; message: string; httpStatus: number };
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const customer = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const unavailable = (): SimwoodAccountResult => ({
  ok: false,
  code: "phone_account_unavailable",
  message: "The company phone account could not be verified. Review its registered connection.",
  httpStatus: 409,
});
export async function resolveSimwoodAccount(
  db: AccountDb,
  tenantId: string,
  supplied?: unknown,
): Promise<SimwoodAccountResult> {
  if (
    !uuid(tenantId) ||
    (supplied !== undefined &&
      supplied !== null &&
      (typeof supplied !== "string" || (supplied.trim() !== "" && !customer(supplied.trim()))))
  )
    return {
      ok: false,
      code: "invalid_phone_account",
      message: "A valid company phone account is required.",
      httpStatus: 400,
    };
  const requested = typeof supplied === "string" && supplied.trim() ? supplied.trim() : null;
  try {
    const { data, error, count } = await db
      .from("connector_accounts")
      .select(
        "id,tenant_id,tenant_connector_id,account_key,status,customer:settings->>provider_customer_id,connector:tenant_connectors!inner(id,tenant_id,connector_id,provider,status,enabled)",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("connector.tenant_id", tenantId)
      .eq("connector.connector_id", "simwood")
      .eq("connector.provider", "simwood")
      .limit(101);
    if (
      error ||
      !Array.isArray(data) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 100 ||
      count !== data.length
    )
      return unavailable();
    const seen = new Set<string>(),
      ids = new Set<string>();
    const active: { customerId: string; accountId: string; connectorId: string }[] = [];
    for (const a of data) {
      const c = a?.connector;
      const id =
        typeof a?.customer === "string" && a.customer.trim() ? a.customer.trim() : a?.account_key;
      if (
        !a ||
        !uuid(a.id) ||
        ids.has(a.id) ||
        a.tenant_id !== tenantId ||
        !c ||
        !uuid(c.id) ||
        a.tenant_connector_id !== c.id ||
        c.tenant_id !== tenantId ||
        c.connector_id !== "simwood" ||
        c.provider !== "simwood" ||
        typeof c.enabled !== "boolean" ||
        !customer(id) ||
        seen.has(id)
      )
        return unavailable();
      ids.add(a.id);
      seen.add(id);
      if (a.status === "active" && c.enabled && ["active", "error"].includes(c.status))
        active.push({ customerId: id, accountId: a.id, connectorId: c.id });
    }
    const candidates = requested ? active.filter((a) => a.customerId === requested) : active;
    if (candidates.length !== 1) return unavailable();
    return { ok: true, ...candidates[0] };
  } catch {
    return unavailable();
  }
}
/** Retain a recorded URL only if it names the exact registered account and recording.
 * Missing URLs use the same canonical endpoint. No provider-wide discovery fallback.
 */
export function simwoodRecordingCustomer(recordingId: string, stored: unknown): string | null {
  if (
    typeof recordingId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(recordingId) ||
    typeof stored !== "string" ||
    !stored
  )
    return null;
  try {
    const u = new URL(stored, "https://pbx.sipcentric.com");
    const match =
      /^\/api\/v1\/customers\/([A-Za-z0-9_-]{1,128})\/recordings\/([A-Za-z0-9_-]{1,200})$/.exec(
        u.pathname,
      );
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.hostname !== "pbx.sipcentric.com" ||
      u.port ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      !match ||
      match[2] !== recordingId
    )
      return null;
    return match[1];
  } catch {
    return null;
  }
}
export function boundSimwoodRecordingUrl(
  customerId: string,
  recordingId: string,
  stored: unknown,
): string | null {
  if (
    !customer(customerId) ||
    typeof recordingId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(recordingId)
  )
    return null;
  const canonical = `https://pbx.sipcentric.com/api/v1/customers/${customerId}/recordings/${recordingId}`;
  if (stored === null || stored === undefined || stored === "") return canonical;
  return simwoodRecordingCustomer(recordingId, stored) === customerId ? canonical : null;
}
