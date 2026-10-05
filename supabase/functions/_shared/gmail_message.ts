// ServiceOS — shared Gmail message parsing (Deno).
//
// Turns raw Gmail message resources (users.messages.get, format=full) into
// email_threads / email_messages upsert rows. Used by BOTH gmail-sync-messages
// (OAuth) and gmail-workspace-sync-messages (domain-wide delegation) so the
// parsing lives in exactly one place. Bodies/headers only — NO attachment bytes,
// NO tokens.

function decodeB64Url(data: string): string {
  const b = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b.length % 4 ? b + "=".repeat(4 - (b.length % 4)) : b;
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
}

/** Walk the MIME tree for the first text/plain and text/html bodies. */
function extractBodies(payload: Part | undefined): {
  text: string | null;
  html: string | null;
  hasAttachments: boolean;
} {
  let text: string | null = null;
  let html: string | null = null;
  let hasAttachments = false;
  function walk(part: Part | undefined): void {
    if (!part) return;
    const mime = part.mimeType ?? "";
    if (part.filename && part.body?.attachmentId) hasAttachments = true;
    if (mime === "text/plain" && part.body?.data && text === null) {
      text = decodeB64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data && html === null) {
      html = decodeB64Url(part.body.data);
    }
    for (const p of part.parts ?? []) walk(p);
  }
  walk(payload);
  return { text, html, hasAttachments };
}

function headerMap(payload: Part | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of payload?.headers ?? []) {
    if (h?.name) map[h.name.toLowerCase()] = h.value ?? "";
  }
  return map;
}

function parseAddress(v: string): { name: string | null; email: string | null } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() || null };
  const e = v.trim().toLowerCase();
  return { name: null, email: e || null };
}

function parseAddressList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => parseAddress(s).email)
    .filter((x): x is string => Boolean(x));
}

function toIsoFromInternalDate(v: unknown): string | null {
  const ms = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toIsoFromDateHeader(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

interface ThreadAgg {
  subject: string | null;
  lastTs: string | null;
  participants: Set<string>;
}

export interface ParsedGmailData {
  messageRows: Record<string, unknown>[];
  threadRows: Record<string, unknown>[];
}

/**
 * Parse a batch of full Gmail message resources into idempotent upsert rows for
 * email_messages and email_threads. `mailbox` is the connected/impersonated
 * address, used to derive message direction.
 */
export function parseGmailMessages(
  rawMessages: Record<string, unknown>[],
  opts: { tenantId: string; provider: string; mailbox: string },
): ParsedGmailData {
  const { tenantId, provider, mailbox } = opts;
  const messageRows: Record<string, unknown>[] = [];
  const threads = new Map<string, ThreadAgg>();
  const nowIso = new Date().toISOString();

  for (const msg of rawMessages) {
    const id = msg.id != null ? String(msg.id) : null;
    if (!id) continue;
    const threadId = (msg.threadId as string | null) ?? null;
    const labelIds = Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : [];
    const payload = msg.payload as Part | undefined;
    const h = headerMap(payload);
    const bodies = extractBodies(payload);

    const fromParsed = parseAddress(h["from"] ?? "");
    const toEmails = parseAddressList(h["to"]);
    const ccEmails = parseAddressList(h["cc"]);
    const subject = h["subject"] ?? null;

    const receivedAt = toIsoFromInternalDate(msg.internalDate);
    const sentAt = toIsoFromDateHeader(h["date"]) ?? receivedAt;
    const ts = receivedAt ?? sentAt;

    const isOutbound =
      labelIds.includes("SENT") || (Boolean(mailbox) && fromParsed.email === mailbox);
    const direction = isOutbound ? "outbound" : "inbound";

    messageRows.push({
      tenant_id: tenantId,
      provider,
      provider_message_id: id,
      provider_thread_id: threadId,
      from_email: fromParsed.email,
      from_name: fromParsed.name,
      to_emails: toEmails,
      cc_emails: ccEmails,
      subject,
      snippet: (msg.snippet as string | null) ?? null,
      body_text: bodies.text,
      body_html: bodies.html,
      sent_at: sentAt,
      received_at: receivedAt,
      direction,
      // Safe metadata only — NO body, NO attachment bytes, NO tokens.
      raw_payload: {
        label_ids: labelIds,
        size_estimate: (msg.sizeEstimate as number | null) ?? null,
        history_id: (msg.historyId as string | null) ?? null,
        has_attachments: bodies.hasAttachments,
      },
    });

    if (threadId) {
      const agg = threads.get(threadId) ?? {
        subject: null,
        lastTs: null,
        participants: new Set<string>(),
      };
      if (fromParsed.email) agg.participants.add(fromParsed.email);
      for (const e of toEmails) agg.participants.add(e);
      for (const e of ccEmails) agg.participants.add(e);
      if (!agg.lastTs || (ts && ts > agg.lastTs)) {
        agg.lastTs = ts;
        agg.subject = subject;
      }
      threads.set(threadId, agg);
    }
  }

  const threadRows = Array.from(threads.entries()).map(([provider_thread_id, agg]) => ({
    tenant_id: tenantId,
    provider,
    provider_thread_id,
    subject: agg.subject,
    participants: Array.from(agg.participants),
    last_message_at: agg.lastTs,
    updated_at: nowIso,
  }));

  return { messageRows, threadRows };
}
