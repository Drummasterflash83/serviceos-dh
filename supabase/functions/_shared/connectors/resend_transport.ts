// Resend transport for the marketing email adapter — the alternative to the
// Gmail provider call, selected when a sender's source_kind is `resend`.
//
// SAFETY CONTRACT (hardened):
//  - there is NO magic-key / fixture short-circuit. A simulated or placeholder
//    key can NEVER produce a `succeeded` result or a synthetic provider id.
//    A missing / malformed / non-`re_` key FAILS CLOSED (config error), makes
//    no network call and returns no success. Tests inject a mock `fetchImpl`;
//    the deployed runtime always uses the real global fetch against Resend.
//  - the payload is built EXCLUSIVELY from the FROZEN envelope values passed in
//    (from, reply-to, subject, html, text, recipient); this module reads no DB
//    and holds no state; the key rides ONLY the Authorization header and never
//    appears in a result or log.
//  - classification is conservative: 401/403 (auth) and 400/422 (validation,
//    incl. unverified domain) are PERMANENT; 429 is a retryable TRANSIENT
//    carrying Retry-After; a 5xx, a timeout or a lost response is UNKNOWN —
//    frozen for reconciliation, never an automatic resend. The delivery-scoped
//    Idempotency-Key makes a later governed retry non-duplicating.
//  - provider acceptance is `submitted`, NEVER `delivered`; bounce/complaint/
//    final-delivery are provider webhooks this module never fabricates.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_RETRY_AFTER_S = 3_600;

export type ResendSendResult =
  | { outcome: "succeeded"; id: string }
  | {
      outcome: "failed_transient" | "failed_permanent" | "unknown";
      code: string;
      message: string;
      retryAfterSeconds?: number;
    };

export interface ResendSendInput {
  apiKey: string;
  from: string; // "Name <addr>" or bare address — caller composes
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  deliveryId: string; // idempotency key + correlation
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ResendSendOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

// A genuine Resend secret key looks like `re_` + a long token. Anything else
// (blank, "fixture", a placeholder, a publishable key) is NOT a send key and is
// refused BEFORE any network work — no simulation, no success.
export function isPlausibleResendKey(key: string | null | undefined): boolean {
  return typeof key === "string" && /^re_[A-Za-z0-9_-]{16,}$/.test(key);
}

export function composeFrom(address: string, name?: string | null): string {
  const clean = (name ?? "").replace(/[\r\n"<>]/g, "").trim();
  return clean ? `${clean} <${address}>` : address;
}

export function buildResendBody(input: ResendSendInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from: input.from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: { "X-Entity-Ref-ID": input.deliveryId },
  };
  if (input.replyTo) body.reply_to = input.replyTo;
  return body;
}

export function classifyResendFailure(status: number): {
  kind: "transient" | "permanent" | "unknown";
  code: string;
} {
  if (status === 429) return { kind: "transient", code: "resend_rate_limited" };
  if (status === 401 || status === 403) return { kind: "permanent", code: "resend_auth_rejected" };
  if (status === 400 || status === 422) {
    // validation — an unverified sending domain is the common 403/422 and is a
    // fixed config problem, so permanent is correct (no blind retry)
    return { kind: "permanent", code: "resend_validation_rejected" };
  }
  if (status >= 500) return { kind: "unknown", code: "resend_provider_unavailable" };
  // any other non-2xx: conservative unknown (never fabricate an outcome)
  return { kind: "unknown", code: `resend_status_${status}` };
}

export function parseResendId(bodyText: string): string | null {
  try {
    const j = JSON.parse(bodyText) as { id?: unknown };
    return typeof j.id === "string" && j.id.length > 0 ? j.id : null;
  } catch {
    return null;
  }
}

function parseRetryAfter(resp: Response): number | undefined {
  const raw = resp.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(Math.trunc(secs), MAX_RETRY_AFTER_S);
  return undefined;
}

async function readBounded(resp: Response): Promise<string> {
  const text = await resp.text();
  return text.length > MAX_RESPONSE_BYTES ? text.slice(0, MAX_RESPONSE_BYTES) : text;
}

export async function sendViaResend(
  input: ResendSendInput,
  options: ResendSendOptions = {},
): Promise<ResendSendResult> {
  // FAIL CLOSED: a missing / malformed / placeholder key can never send and can
  // never succeed. No network call, no synthetic id — an honest config error.
  if (!isPlausibleResendKey(input.apiKey)) {
    return {
      outcome: "failed_permanent",
      code: "resend_key_invalid",
      message: "RESEND_API_KEY is missing or not a valid Resend secret key",
    };
  }

  const doFetch: FetchLike = options.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const onOuterAbort = () => ac.abort();
  if (options.signal) {
    if (options.signal.aborted) ac.abort();
    else options.signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let resp: Response;
  let bodyText = "";
  try {
    resp = await doFetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.deliveryId,
      },
      body: JSON.stringify(buildResendBody(input)),
      signal: ac.signal,
    });
    bodyText = await readBounded(resp);
  } catch {
    // timeout / abort / network failure / lost response: Resend may or may not
    // have accepted — UNKNOWN, frozen for reconciliation. The idempotency key
    // makes a later governed retry safe; this module never auto-retries.
    return { outcome: "unknown", code: "resend_response_lost", message: "no response from Resend" };
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onOuterAbort);
  }

  if (resp.ok) {
    const id = parseResendId(bodyText);
    if (!id) {
      return {
        outcome: "unknown",
        code: "resend_response_unparseable",
        message: "accepted response had no id",
      };
    }
    return { outcome: "succeeded", id };
  }

  const cls = classifyResendFailure(resp.status);
  if (cls.kind === "transient") {
    return {
      outcome: "failed_transient",
      code: cls.code,
      message: "Resend rejected the request (retryable)",
      retryAfterSeconds: parseRetryAfter(resp),
    };
  }
  if (cls.kind === "permanent") {
    return { outcome: "failed_permanent", code: cls.code, message: "Resend refused the request" };
  }
  return { outcome: "unknown", code: cls.code, message: "Resend returned an uncertain result" };
}
