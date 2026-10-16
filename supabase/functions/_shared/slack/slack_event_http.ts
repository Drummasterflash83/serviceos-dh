/** Inactive HTTP boundary for an approved public Slack Events roster.
 * The caller must load a current, connection-bound roster and durably record
 * each hint before this handler acknowledges it. No event body is retained.
 */
import {
  SlackEventBoundaryError,
  verifyPublicChannelEvent,
  type PublicChannelEvent,
} from "./slack_events_boundary.ts";

export type SlackEventBinding = {
  signingSecret: string;
  teamId: string;
  appId: string;
  allowedChannels: ReadonlySet<string>;
  minTs: string;
};
export type SlackEventHint = Exclude<PublicChannelEvent, { kind: "challenge" }>;
export type SlackHintReceipt = "recorded" | "duplicate" | "excluded";
export type SlackEventDependencies = {
  loadBinding: () => Promise<SlackEventBinding | null>;
  recordHint: (hint: SlackEventHint) => Promise<SlackHintReceipt>;
  nowMs?: () => number;
};

const MAX_BODY_BYTES = 131072;
const json = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function boundedRawBody(request: Request): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d{1,10}$/.test(declared) || Number(declared) > MAX_BODY_BYTES))
    return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return raw;
}

export function slackEventEndpoint(deps: SlackEventDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ ok: false }, 405);
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? ""))
      return json({ ok: false }, 415);
    let raw: Uint8Array | null;
    try { raw = await boundedRawBody(request); }
    catch { return json({ ok: false }, 400); }
    if (raw === null) return json({ ok: false }, 413);
    let binding: SlackEventBinding | null;
    try { binding = await deps.loadBinding(); }
    catch { return json({ ok: false }, 503); }
    if (!binding) return json({ ok: false }, 503);
    let event: PublicChannelEvent;
    try {
      event = await verifyPublicChannelEvent(raw, request.headers, binding, deps.nowMs?.());
    } catch (error) {
      if (error instanceof SlackEventBoundaryError) {
        // A validly signed event for a DM, private or unapproved channel is
        // deliberately consumed without a queue write or retry storm.
        if (error.code === "out_of_scope_event") return json({ ok: true, ignored: true }, 200);
        if (error.code === "invalid_signature") return json({ ok: false }, 401);
        return json({ ok: false }, 400);
      }
      return json({ ok: false }, 503);
    }
    if (event.kind === "challenge") return json({ challenge: event.challenge }, 200);
    try {
      const receipt = await deps.recordHint(event);
      if (receipt === "recorded" || receipt === "duplicate") return json({ ok: true }, 200);
      if (receipt === "excluded") return json({ ok: true, ignored: true }, 200);
    } catch { /* Unknown persistence outcome: Slack should retry the same event ID. */ }
    return json({ ok: false }, 503);
  };
}
