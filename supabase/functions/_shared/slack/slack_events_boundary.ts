/** A signed Slack Event is a hint to reconcile an approved source window.
 * Never persist its body or treat event delivery as captured evidence.
 */
export type PublicChannelEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "message_hint"; eventId: string; channelId: string; ts: string;
      threadTs: string | null }
  | { kind: "correction_hint"; eventId: string; channelId: string;
      eventTs: string; sourceTs: string; threadTs: string | null;
      correction: "changed" | "deleted"; requiresVisibilityCheck: true };

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
const micros = (value: string): bigint => {
  const [seconds, fraction] = value.split(".");
  return BigInt(seconds) * 1000000n + BigInt(fraction.padEnd(6, "0"));
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Verify exact raw bytes before parsing or reading any event fields. */
export async function verifyPublicChannelEvent(
  raw: Uint8Array,
  headers: Headers,
  binding: { signingSecret: string; teamId: string; appId: string;
    allowedChannels: ReadonlySet<string>; minTs: string },
  nowMs = Date.now(),
): Promise<PublicChannelEvent> {
  if (raw.byteLength < 2 || raw.byteLength > 131072 ||
      !Number.isFinite(nowMs) ||
      typeof binding.signingSecret !== "string" || binding.signingSecret.length < 32 ||
      !id.test(binding.teamId) || !id.test(binding.appId) ||
      !timestamp.test(binding.minTs))
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
      typeof message.channel !== "string" || !id.test(message.channel) ||
      !binding.allowedChannels.has(message.channel) ||
      typeof message.ts !== "string" || !timestamp.test(message.ts) ||
      micros(message.ts) < micros(binding.minTs))
    throw new SlackEventBoundaryError("out_of_scope_event");
  if (message.subtype === undefined) {
    if (message.channel_type !== "channel" ||
        !(message.thread_ts === undefined ||
          typeof message.thread_ts === "string" && timestamp.test(message.thread_ts)))
      throw new SlackEventBoundaryError("out_of_scope_event");
    return { kind: "message_hint", eventId: payload.event_id,
      channelId: message.channel, ts: message.ts,
      threadTs: typeof message.thread_ts === "string" ? message.thread_ts : null };
  }
  // Slack's edit/delete examples omit channel_type and use event.ts for the
  // change time. The original message has a different timestamp. A receiver
  // must recheck current public visibility before acting on these hints.
  if ((message.subtype !== "message_changed" && message.subtype !== "message_deleted") ||
      (message.channel_type !== undefined && message.channel_type !== "channel"))
    throw new SlackEventBoundaryError("out_of_scope_event");
  const original = message.subtype === "message_changed" && record(message.message)
    ? message.message.ts : message.deleted_ts;
  const thread = message.subtype === "message_changed" && record(message.message)
    ? message.message.thread_ts : undefined;
  if (typeof original !== "string" || !timestamp.test(original) ||
      !(thread === undefined || typeof thread === "string" && timestamp.test(thread)))
    throw new SlackEventBoundaryError("out_of_scope_event");
  return { kind: "correction_hint", eventId: payload.event_id,
    channelId: message.channel, eventTs: message.ts, sourceTs: original,
    threadTs: typeof thread === "string" ? thread : null,
    correction: message.subtype === "message_changed" ? "changed" : "deleted",
    requiresVisibilityCheck: true };
}
