/** A signed Slack Event is a hint to reconcile an approved source window.
 * Never persist its body or treat event delivery as captured evidence.
 */
export type PublicChannelEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "message_hint"; eventId: string; channelId: string; ts: string;
      threadTs: string | null; correction: boolean };

export class SlackEventBoundaryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const id = /^[A-Z][A-Z0-9]{1,63}$/;
const timestamp = /^\d{10,12}\.\d{1,6}$/;
const eventId = /^Ev[A-Za-z0-9]{4,100}$/;
const challenge = /^[A-Za-z0-9_-]{8,256}$/;
const hex = /^[a-f0-9]{64}$/i;
const correctionSubtypes = new Set(["message_changed", "message_deleted"]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Verify exact raw bytes before parsing or reading any event fields. */
export async function verifyPublicChannelEvent(
  raw: Uint8Array,
  headers: Headers,
  binding: { signingSecret: string; teamId: string; appId: string;
    allowedChannels: ReadonlySet<string> },
  nowMs = Date.now(),
): Promise<PublicChannelEvent> {
  if (raw.byteLength < 2 || raw.byteLength > 131072 ||
      !Number.isFinite(nowMs) ||
      typeof binding.signingSecret !== "string" || binding.signingSecret.length < 32 ||
      !id.test(binding.teamId) || !id.test(binding.appId))
    throw new SlackEventBoundaryError("invalid_boundary");
  const sent = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (!/^\d{10}$/.test(sent) || !signature.startsWith("v0=") ||
      !hex.test(signature.slice(3)) ||
      Math.abs(nowMs - Number(sent) * 1000) > 300000)
    throw new SlackEventBoundaryError("invalid_signature");
  const key = await crypto.subtle.importKey("raw", enc.encode(binding.signingSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const prefix = enc.encode(`v0:${sent}:`);
  const signed = new Uint8Array(prefix.byteLength + raw.byteLength);
  signed.set(prefix);
  signed.set(raw, prefix.byteLength);
  const signatureBytes = Uint8Array.from(signature.slice(3).match(/../g)!,
    (part) => Number.parseInt(part, 16));
  if (!await crypto.subtle.verify("HMAC", key, signatureBytes, signed))
    throw new SlackEventBoundaryError("invalid_signature");
  let payload: unknown;
  try { payload = JSON.parse(dec.decode(raw)); }
  catch { throw new SlackEventBoundaryError("invalid_payload"); }
  if (!record(payload)) throw new SlackEventBoundaryError("invalid_payload");
  if (payload.type === "url_verification") {
    if (payload.team_id !== undefined && payload.team_id !== binding.teamId ||
        payload.api_app_id !== undefined && payload.api_app_id !== binding.appId)
      throw new SlackEventBoundaryError("wrong_connection");
    if (typeof payload.challenge !== "string" || !challenge.test(payload.challenge))
      throw new SlackEventBoundaryError("invalid_challenge");
    return { kind: "challenge", challenge: payload.challenge };
  }
  if (payload.team_id !== binding.teamId || payload.api_app_id !== binding.appId)
    throw new SlackEventBoundaryError("wrong_connection");
  const message = payload.event;
  if (payload.type !== "event_callback" ||
      typeof payload.event_id !== "string" || !eventId.test(payload.event_id) ||
      payload.is_ext_shared_channel === true ||
      !record(message) || message.type !== "message" ||
      message.channel_type !== "channel" ||
      typeof message.channel !== "string" || !id.test(message.channel) ||
      !binding.allowedChannels.has(message.channel) ||
      typeof message.ts !== "string" || !timestamp.test(message.ts) ||
      !(message.thread_ts === undefined ||
        typeof message.thread_ts === "string" && timestamp.test(message.thread_ts)) ||
      !(message.subtype === undefined ||
        typeof message.subtype === "string" && /^[a-z_]{1,64}$/.test(message.subtype)))
    throw new SlackEventBoundaryError("out_of_scope_event");
  return { kind: "message_hint", eventId: payload.event_id,
    channelId: message.channel, ts: message.ts,
    threadTs: typeof message.thread_ts === "string" ? message.thread_ts : null,
    correction: correctionSubtypes.has(message.subtype as string) };
}
