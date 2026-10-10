export type VerificationRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: {
    kind: "verify_commusoft";
    reason: string;
    connection_id: string;
    revision: string;
    one_read_confirmed: true;
  };
};
export const verificationCodes = [
  "access_verified",
  "authority_changed",
  "invalid_request",
  "authority_unavailable",
  "transport_unavailable",
  "authentication_required",
  "access_denied",
  "rate_limited",
  "provider_unavailable",
  "provider_rejected",
  "response_too_large",
  "invalid_response",
] as const;
export type VerificationCode = (typeof verificationCodes)[number];
export type VerificationReceipt =
  | { tenant_id: string; request_id: string; state: "pending" | "cancelled" }
  | {
      tenant_id: string;
      request_id: string;
      state: "approved" | "running" | "expired";
      expires_at: string;
    }
  | {
      tenant_id: string;
      request_id: string;
      state: "recorded";
      connection_id: string;
      code: VerificationCode;
      verified_at: string | null;
      revision: string | null;
    };
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function validateVerificationRequest(r: unknown): asserts r is VerificationRequest {
  if (
    !object(r) ||
    Object.keys(r).length !== 4 ||
    !uuid(r.tenantId) ||
    !uuid(r.actorId) ||
    !uuid(r.requestId) ||
    !object(r.definition)
  )
    throw Error("verification_request_invalid");
  const d = r.definition;
  if (
    Object.keys(d).length !== 5 ||
    d.kind !== "verify_commusoft" ||
    typeof d.reason !== "string" ||
    !d.reason.trim() ||
    d.reason.length > 1000 ||
    !uuid(d.connection_id) ||
    !date(d.revision) ||
    d.one_read_confirmed !== true
  )
    throw Error("verification_request_invalid");
}
/** Construct a safe projection; never forward arbitrary server fields/errors. */
export function parseVerificationReceipt(
  raw: unknown,
  r: VerificationRequest,
): VerificationReceipt {
  if (!object(raw) || raw.tenant_id !== r.tenantId || raw.request_id !== r.requestId)
    throw Error("verification_receipt_invalid");
  const base = { tenant_id: r.tenantId, request_id: r.requestId };
  if (raw.state === "pending" || raw.state === "cancelled") return { ...base, state: raw.state };
  if (["approved", "running", "expired"].includes(raw.state) && date(raw.expires_at))
    return { ...base, state: raw.state, expires_at: raw.expires_at };
  if (
    raw.state !== "recorded" ||
    raw.connection_id !== r.definition.connection_id ||
    !verificationCodes.includes(raw.code) ||
    !(raw.verified_at === null || date(raw.verified_at)) ||
    !(raw.revision === null || date(raw.revision)) ||
    (raw.code === "access_verified"
      ? raw.verified_at === null || raw.revision === null
      : raw.verified_at !== null) ||
    (raw.code === "authority_changed" ? raw.revision !== null : raw.revision === null)
  )
    throw Error("verification_receipt_invalid");
  return {
    ...base,
    state: "recorded",
    connection_id: raw.connection_id,
    code: raw.code,
    verified_at: raw.verified_at,
    revision: raw.revision,
  };
}
