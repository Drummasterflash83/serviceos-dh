/** Operator connection metadata. Retained inventory does not prove current capture. */
import { readOperatorInventory } from "./inventory.ts";
import { providerCapabilities } from "../telephony/capabilities.ts";
type Db = { from(table: string): any };
type Row = Record<string, any>;
const phoneProviders = new Set(["sipcentric", "birchills", "simwood"]);
const label: Record<string, string> = {
  sipcentric: "Birchills",
  birchills: "Birchills",
  simwood: "Simwood",
};
const time = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const newer = (...values: unknown[]) =>
  values
    .map(time)
    .filter((v): v is string => !!v)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const domain = (value: unknown) =>
  typeof value === "string" && value.includes("@")
    ? value
        .slice(value.lastIndexOf("@") + 1)
        .trim()
        .toLowerCase()
    : "";

async function latest(
  db: Db,
  tenant: string,
  table: string,
  provider: string,
  cutoff: string,
  kind: "event" | "sync",
  filter: (q: any) => any = (q) => q,
  completed = false,
) {
  const column = kind === "event" ? "created_at" : completed ? "completed_at" : "started_at";
  let q = db
    .from(table)
    .select(
      kind === "event"
        ? "id,tenant_id,provider,event,created_at"
        : "id,tenant_id,provider,sync_type,status,started_at,completed_at,records_processed",
    )
    .eq("tenant_id", tenant)
    .eq("provider", provider)
    .lte(column, cutoff);
  q = filter(q).order(column, { ascending: false }).order("id", { ascending: false }).limit(1);
  const { data, error } = await q;
  if (
    error ||
    !Array.isArray(data) ||
    data.length > 1 ||
    data.some(
      (r) =>
        r.tenant_id !== tenant ||
        r.provider !== provider ||
        !time(r[column]) ||
        Date.parse(r[column]) > Date.parse(cutoff),
    )
  )
    throw Error(`Connection evidence could not be read (${table})`);
  return data[0] as Row | undefined;
}

async function lifecycle(
  db: Db,
  tenant: string,
  conn: Row,
  provider: string,
  cutoff: string,
  email = false,
) {
  const event = (filter?: (q: any) => any) =>
    latest(db, tenant, "provider_connection_events", provider, cutoff, "event", filter);
  const run = (filter?: (q: any) => any, completed = false) =>
    latest(
      db,
      tenant,
      email ? "email_sync_runs" : "phone_sync_runs",
      provider,
      cutoff,
      "sync",
      (q) => {
        q = q.not("sync_type", "in", "(workspace_test,test_connection,oauth)");
        return filter ? filter(q) : q;
      },
      completed,
    );
  const [ev, goodDiscovery, badDiscovery, recent, goodSync, badSync, emailDiscovery] =
    await Promise.all([
      event(),
      event((q) => q.in("event", ["discovery_completed", "inventory_imported"])),
      event((q) => q.eq("event", "discovery_failed")),
      run(),
      run((q) => q.in("status", ["completed", "success", "succeeded"]), true),
      run((q) => q.in("status", ["failed", "error"]), true),
      email
        ? run(
            (q) =>
              q
                .eq("sync_type", "workspace_discover")
                .in("status", ["completed", "success", "succeeded"]),
            true,
          )
        : undefined,
    ]);
  const lt = conn.last_test;
  const testStatus =
    lt?.ok === true
      ? "passed"
      : lt?.ok === false
        ? "failed"
        : ["passed", "failed", "success", "error"].includes(lt?.status)
          ? lt.status
          : null;
  const completed = (r: Row | undefined) =>
    r && time(r.completed_at) && Date.parse(r.completed_at) <= Date.parse(cutoff)
      ? r.completed_at
      : null;
  return {
    connection_id: conn.id,
    provider,
    status: conn.status,
    auth_mode: conn.auth_mode ?? null,
    account_ref: conn.account_ref ?? null,
    configured_fields: Array.isArray(conn.configured_fields)
      ? conn.configured_fields.filter((f: unknown) => typeof f === "string")
      : [],
    has_secrets:
      !!conn.secret_refs &&
      typeof conn.secret_refs === "object" &&
      !Array.isArray(conn.secret_refs) &&
      Object.keys(conn.secret_refs).length > 0,
    verified_at: time(email ? conn.last_verified_at : conn.verified_at),
    last_test_status: testStatus,
    last_test_at: newer(lt?.at, lt?.tested_at, lt?.verified_at, lt?.completed_at),
    revoked_at: time(conn.revoked_at),
    latest_event: ev?.event ?? null,
    latest_event_at: ev?.created_at ?? null,
    last_successful_discovery: newer(goodDiscovery?.created_at, completed(emailDiscovery)),
    last_failed_discovery: badDiscovery?.created_at ?? null,
    last_successful_sync: completed(goodSync),
    last_failed_sync: completed(badSync),
    last_sync_status: recent?.status ?? null,
    last_sync_at: recent?.started_at ?? null,
    discovery_counts: {
      last_run_processed:
        typeof recent?.records_processed === "number" &&
        Number.isSafeInteger(recent.records_processed) &&
        recent.records_processed >= 0
          ? recent.records_processed
          : null,
    },
    is_fallback: false,
    fallback_reason: null,
  };
}

export async function loadConnectionsAndEvidence(db: Db, tenant: string, now = Date.now()) {
  if (!Number.isFinite(now) || Math.abs(now) > 8.64e15)
    throw Error("Invalid connection observation time");
  const cutoff = new Date(now).toISOString();
  const read = (table: string, columns: string, filter?: (q: any) => any) =>
    readOperatorInventory(db, tenant, table, columns, { filter, label: "connection inventory" });
  const [gw, providers, mailboxes, inventory, profiles] = await Promise.all([
    read("google_workspace_connections", "id,domain,status,last_verified_at,created_at,updated_at"),
    read(
      "provider_connections",
      "id,provider,status,auth_mode,account_ref,configured_fields,secret_refs,verified_at,last_test,revoked_at,created_at,updated_at",
    ),
    read("google_workspace_mailboxes", "id,email_address,status"),
    read(
      "telephony_inventory",
      "id,provider,provider_object_id,canonical_type,label,status,discovery_source",
    ),
    read("operating_profile_entries", "id,value", (q) =>
      q
        .eq("scope_kind", "tenant")
        .eq("namespace", "controlplane")
        .eq("key", "email.approved_domains"),
    ),
  ]);
  if (profiles.length > 1) throw Error("Ambiguous approved email-domain configuration");
  const raw = profiles[0]?.value?.approved_domains;
  if (raw !== undefined && (!Array.isArray(raw) || raw.some((d: unknown) => typeof d !== "string")))
    throw Error("Invalid approved email domains");
  const approved: string[] = [
    ...new Set<string>(
      (raw ?? []).map((d: string) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean),
    ),
  ];
  let imported = 0;
  const excludedDomains: Record<string, number> = {};
  for (const m of mailboxes) {
    const d = domain(m.email_address);
    if (approved.includes(d)) imported++;
    else excludedDomains[d || "(unparseable)"] = (excludedDomains[d || "(unparseable)"] ?? 0) + 1;
  }
  const phone = providers.filter((p) => phoneProviders.has(p.provider));
  if (new Set(phone.map((p) => p.provider)).size !== phone.length)
    throw Error("Ambiguous phone provider connections");
  const phones = await Promise.all(
    phone.map(async (conn) => ({
      commercial_provider: label[conn.provider],
      underlying_provider: conn.provider,
      account_ref: conn.account_ref ?? "",
      status: conn.status,
      credentials: Object.keys(conn.secret_refs ?? {}).length
        ? "stored (verification separate)"
        : "not configured",
      capabilities: providerCapabilities(
        conn.provider === "birchills" ? "sipcentric" : conn.provider,
      ).capabilities,
      external_write: "disabled",
      evidence_count: inventory.filter((i) => i.provider === conn.provider).length,
      lifecycle: await lifecycle(db, tenant, conn, conn.provider, cutoff),
    })),
  );
  const googleLifecycle =
    gw.length === 1 ? await lifecycle(db, tenant, gw[0], "google_workspace", cutoff, true) : null;
  const emptyPhone = {
    commercial_provider: "Phone",
    underlying_provider: "",
    account_ref: "",
    status: phone.length > 1 ? "multiple_connections" : "not_configured",
    credentials: "not configured",
    capabilities: null,
    external_write: "disabled",
    evidence_count: inventory.length,
  };
  return {
    connections: {
      google_workspace: {
        status:
          gw.length > 0 && gw.every((c) => c.status === "active")
            ? "connected"
            : gw.length > 0 && gw.every((c) => c.status === gw[0].status)
              ? gw[0].status
              : gw.length > 0
                ? "degraded"
                : "not_connected",
        connections: gw.map((c) => ({ domain: c.domain, status: c.status })),
        approved_domains: approved,
        imported,
        excluded: mailboxes.length - imported,
        excluded_domains: excludedDomains,
        read_only: true,
        ...(googleLifecycle ? { lifecycle: googleLifecycle } : {}),
      },
      telephony: phones.length === 1 ? phones[0] : emptyPhone,
      telephony_accounts: phones,
      slack: {
        status: "not_verified",
        note: "Check LEARN Inputs for current Slack connection and capture status; this directory view does not verify message ingestion.",
      },
    },
    phoneEvidence: inventory.map((r) => ({
      id: r.id,
      provider: r.provider,
      external_ref: r.provider_object_id,
      canonical_type: r.canonical_type,
      label: r.label,
      status: r.status,
      discovery_source: r.discovery_source,
    })),
  };
}
