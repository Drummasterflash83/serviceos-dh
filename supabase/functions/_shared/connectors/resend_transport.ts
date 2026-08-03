// Resend transport for the marketing email adapter — the alternative to the
// Gmail provider call, selected when a sender's source_kind is `resend`.
//
// Discipline mirrors the Gmail transport exactly:
//  - the payload is built EXCLUSIVELY from the FROZEN envelope values passed in
//    (from, reply-to, subject, html, text, recipient) — this module reads no
//    DB and holds no state;
//  - the API key is resolved server-side by the adapter and passed in; it never
//    appears in a result or log;
//  - classification is conservative: 401/403 (auth) and 422 (validation) are
//    PERMANENT; 429 is a retryable TRANSIENT; a 5xx or a lost response is
//    UNKNOWN — frozen for reconciliation, never an automatic resend. Resend
//    does accept an Idempotency-Key, which we set to the delivery id so a
//    bounded retry after an uncertain result cannot duplicate the message.
//
// A FIXTURE key (value "fixture" or "fixture:<variant>") short-circuits the
// network and returns a deterministic result. A real Resend key begins "re_",
// so fixture mode is structurally unreachable in production with a genuine key.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type ResendSendResult =
  | { outcome: "succeeded"; id: string }
  | { outcome: "failed_transient" | "failed_permanent" | "unknown"; code: string; message: string };

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

export function isFixtureKey(key: string): boolean {
  return key === "fixture" || key.startsWith("fixture:");
}

// deterministic fixture: a stable synthetic message id derived from the
// delivery id, no network. "fixture:fail_permanent" / "fixture:fail_transient"
// / "fixture:unknown" exercise the non-success branches for tests.
export function fixtureResult(key: string, deliveryId: string): ResendSendResult {
  const variant = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "success";
  if (variant === "fail_permanent") {
    return {
      outcome: "failed_permanent",
      code: "resend_fixture_permanent",
      message: "fixture permanent",
    };
  }
  if (variant === "fail_transient") {
    return {
      outcome: "failed_transient",
      code: "resend_fixture_transient",
      message: "fixture transient",
    };
  }
  if (variant === "unknown") {
    return { outcome: "unknown", code: "resend_fixture_unknown", message: "fixture unknown" };
  }
  return { outcome: "succeeded", id: `resend-fixture-${deliveryId}` };
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

export function classifyResendFailure(
  status: number,
  bodyText: string,
): { kind: "transient" | "permanent" | "unknown"; code: string } {
  if (status === 429) return { kind: "transient", code: "resend_rate_limited" };
  if (status === 401 || status === 403) return { kind: "permanent", code: "resend_auth_rejected" };
  if (status === 422 || status === 400) {
    // validation — but an unverified sending domain is the common 403/422 and
    // is a fixed config problem, so permanent is correct (no blind retry)
    return { kind: "permanent", code: "resend_validation_rejected" };
  }
  if (status >= 500) return { kind: "unknown", code: "resend_provider_unavailable" };
  // any other non-2xx: conservative unknown (do not fabricate an outcome)
  void bodyText;
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

export async function sendViaResend(
  input: ResendSendInput,
  signal?: AbortSignal | null,
): Promise<ResendSendResult> {
  if (isFixtureKey(input.apiKey)) {
    return fixtureResult(input.apiKey, input.deliveryId);
  }
  let resp: Response;
  let bodyText = "";
  try {
    resp = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.deliveryId,
      },
      body: JSON.stringify(buildResendBody(input)),
      signal: signal ?? null,
    });
    bodyText = await resp.text();
  } catch {
    // network failure / lost response: Resend may or may not have accepted —
    // UNKNOWN, frozen for reconciliation (the idempotency key makes a later
    // retry safe, but this module never auto-retries)
    return { outcome: "unknown", code: "resend_response_lost", message: "no response from Resend" };
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
  const cls = classifyResendFailure(resp.status, bodyText);
  if (cls.kind === "transient") {
    return {
      outcome: "failed_transient",
      code: cls.code,
      message: "Resend rejected the request (retryable)",
    };
  }
  if (cls.kind === "permanent") {
    return { outcome: "failed_permanent", code: cls.code, message: "Resend refused the request" };
  }
  return { outcome: "unknown", code: cls.code, message: "Resend returned an uncertain result" };
}
