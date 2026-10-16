/** Inactive read-only hint boundary for an exact Commusoft job subscription.
 * The webhook body is never a job source record. A later worker must fetch the
 * job through the existing guarded API adapter and preserve source versions.
 */
export type CommusoftJobWebhookBinding = {
  signingSecret: string;
  applicationId: string;
  clientId: string;
  apiOrigin: "https://app.commusoft.co.uk/api/v2";
};
export type CommusoftJobHint = {
  kind: "job_hint";
  eventId: string;
  action: "created" | "updated";
  jobId: string;
  sourceTimestamp: string;
};
export class CommusoftWebhookBoundaryError extends Error {
  readonly code: "invalid_boundary" | "invalid_signature" |
    "invalid_payload" | "out_of_scope";
  constructor(code: CommusoftWebhookBoundaryError["code"]) {
    super(code);
    this.code = code;
  }
}

const bytes = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: true });
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const signature = /^t=([0-9]{10}),v1=([a-fA-F0-9]{64})$/;
const error = (code: CommusoftWebhookBoundaryError["code"]): never => {
  throw new CommusoftWebhookBoundaryError(code);
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Verify the provider's documented t + '.' + raw-body HMAC before parsing. */
export async function verifyCommusoftJobWebhook(
  raw: Uint8Array,
  headers: Headers,
  binding: CommusoftJobWebhookBinding,
  nowMs = Date.now(),
): Promise<CommusoftJobHint> {
  if (!(raw instanceof Uint8Array) || raw.length < 2 || raw.length > 65536 ||
    !Number.isFinite(nowMs) || !binding ||
    typeof binding.signingSecret !== "string" || binding.signingSecret.length < 32 ||
    !identifier.test(binding.applicationId) || !identifier.test(binding.clientId) ||
    binding.apiOrigin !== "https://app.commusoft.co.uk/api/v2")
    return error("invalid_boundary");
  const match = signature.exec(headers.get("x-commusoft-signature") ?? "");
  if (!match || Math.abs(nowMs - Number(match[1]) * 1000) > 300000)
    return error("invalid_signature");
  const prefix = bytes.encode(`${match[1]}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", bytes.encode(binding.signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const mac = Uint8Array.from(match[2].match(/../g)!, (part) => parseInt(part, 16));
  if (!await crypto.subtle.verify("HMAC", key, mac, signed))
    return error("invalid_signature");
  let payload: unknown;
  try { payload = JSON.parse(text.decode(raw)); }
  catch { return error("invalid_payload"); }
  if (!record(payload) || payload.applicationID !== binding.applicationId ||
    payload.clientID !== binding.clientId || payload.version !== "2" ||
    typeof payload.eventID !== "string" || !identifier.test(payload.eventID) ||
    typeof payload.timestamp !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(payload.timestamp) ||
    !Number.isFinite(Date.parse(payload.timestamp)))
    return error("invalid_payload");
  if (payload.object !== "jobs" ||
    !["job.created", "job.updated"].includes(String(payload.eventType)) ||
    !Number.isSafeInteger(payload.id) || (payload.id as number) < 1 ||
    !record(payload.links) ||
    payload.links.self !== `${binding.apiOrigin}/jobs/${payload.id}`)
    return error("out_of_scope");
  return {
    kind: "job_hint",
    eventId: payload.eventID,
    action: payload.eventType === "job.created" ? "created" : "updated",
    jobId: String(payload.id),
    sourceTimestamp: payload.timestamp,
  };
}
