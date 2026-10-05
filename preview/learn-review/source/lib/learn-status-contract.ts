/** Pure excerpt from f19cb393 src/lib/learn-status.ts; transport/auth excluded. */
export interface LearnStatusSource {
  read_status: "ok" | "unavailable";
  record_count: number | null;
  latest_record_at: string | null;
}
export interface LearnStatusSnapshot {
  version: "learn-status/1";
  tenant_id: string;
  observed_at: string;
  valid_until: string;
  phone: LearnStatusSource;
  email: LearnStatusSource;
}
export type LearnStatusResult = { state: "ready"; snapshot: LearnStatusSnapshot }
  | { state: "denied" | "unavailable" | "failed" };
export const learnStatusContract = "learn-status/1";
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
export function validateLearnStatus(value: unknown, tenantId: string): LearnStatusSnapshot | null {
  if (!uuid(tenantId) || !object(value) || !exact(value, ["version", "tenant_id", "observed_at", "valid_until", "phone", "email"])
    || value.version !== learnStatusContract || value.tenant_id !== tenantId || !timestamp(value.observed_at) || !timestamp(value.valid_until)
    || Date.parse(value.valid_until) <= Date.parse(value.observed_at)
    || Date.parse(value.valid_until) - Date.parse(value.observed_at) > 60_000) return null;
  const observed = Date.parse(value.observed_at);
  const source = (v: unknown): LearnStatusSource | null => {
    if (!object(v) || !exact(v, ["read_status", "record_count", "latest_record_at"])) return null;
    if (v.read_status === "unavailable") return v.record_count === null && v.latest_record_at === null
      ? Object.freeze({ read_status: "unavailable", record_count: null, latest_record_at: null }) : null;
    if (v.read_status !== "ok" || typeof v.record_count !== "number" || !Number.isSafeInteger(v.record_count) || v.record_count < 0
      || (v.latest_record_at !== null && (!timestamp(v.latest_record_at) || Date.parse(v.latest_record_at) > observed))
      || (v.record_count === 0 ? v.latest_record_at !== null : v.latest_record_at === null)) return null;
    return Object.freeze({ read_status: "ok", record_count: v.record_count, latest_record_at: v.latest_record_at });
  };
  const phone = source(value.phone), email = source(value.email);
  if (!phone || !email) return null;
  return Object.freeze({ version: learnStatusContract, tenant_id: tenantId, observed_at: value.observed_at, valid_until: value.valid_until, phone, email });
}
export function learnStatusState(snapshot: LearnStatusSnapshot, now: number): "ready" | "stale" | "empty" | "partial" | "unavailable" {
  if (now >= Date.parse(snapshot.valid_until) || now < Date.parse(snapshot.observed_at)) return "stale";
  const sources = [snapshot.phone, snapshot.email];
  if (sources.every(s => s.read_status === "unavailable")) return "unavailable";
  if (sources.some(s => s.read_status === "unavailable")) return "partial";
  return sources.every(s => s.record_count === 0) ? "empty" : "ready";
}
