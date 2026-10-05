// Vapi /call/web is public-scoped even when invoked server-side. Generate a
// short-lived scoped JWT using the installed private key; never send it to UI.
const uuid = (s: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
export async function webCallToken(
  privateKey: string,
  orgId: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (!privateKey || !uuid(orgId)) throw Error("Invalid voice organisation");
  const enc = new TextEncoder();
  const b64 = (v: Uint8Array) =>
    btoa(String.fromCharCode(...v))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const unsigned =
    b64(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))) +
    "." +
    b64(
      enc.encode(
        JSON.stringify({
          orgId,
          token: { tag: "public", restrictions: { enabled: true, allowTransientAssistant: true } },
          iat: now,
          exp: now + 60,
        }),
      ),
    );
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(privateKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    unsigned +
    "." +
    b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(unsigned))))
  );
}
export function definitiveWebCallRejection(status: number) {
  return [400, 401, 403, 404, 405, 422, 429].includes(status);
}
export function practiceCallMatches(call: unknown, sessionId: string, tenantId: string) {
  const c = call as {
    type?: string;
    metadata?: Record<string, unknown>;
    assistant?: { metadata?: Record<string, unknown> };
  };
  const metadata = c?.assistant?.metadata;
  return (
    c?.type === "webCall" &&
    metadata?.openfolkPracticeSession === sessionId &&
    metadata?.openfolkTenant === tenantId
  );
}

export function practiceReservationFailure(message: string | undefined, reserved: unknown) {
  if (message === "A practice conversation is already reserved")
    return {
      code: "practice_busy",
      error:
        "Another practice conversation is still active or its end has not yet been confirmed. End it first; an unconfirmed reservation expires within five minutes.",
      status: 429,
    };
  if (message === "Practice daily limit reached")
    return {
      code: "practice_daily_limit",
      error:
        "The rolling 24-hour practice allowance has been reached (10 per person or 30 per workspace). Waiting five minutes will not reset it. OpenFolk can review usage.",
      status: 429,
    };
  if (message === "Practice not enabled")
    return {
      code: "practice_disabled",
      error: "Browser practice is not enabled for this workspace.",
      status: 409,
    };
  if (!message && reserved === false)
    return {
      code: "practice_duplicate",
      error:
        "This practice request was already registered. Check the existing conversation before starting another.",
      status: 409,
    };
  return {
    code: "practice_reservation_unavailable",
    error:
      "The practice reservation could not be checked. No new call was requested. Please ask OpenFolk to check the connection.",
    status: 503,
  };
}

export async function reconcilePracticeSessions(
  sessions: { id: string; call_id: string | null }[],
  tenant: string,
  readCall: (id: string) => Promise<unknown>,
  markEnded: (id: string) => Promise<void>,
) {
  for (const session of sessions) {
    if (!session.call_id) continue;
    // A failed read, absent call or different tenant never releases a lease.
    const call = await readCall(session.call_id).catch(() => null);
    if (
      practiceCallMatches(call, session.id, tenant) &&
      (call as { status?: string }).status === "ended"
    )
      await markEnded(session.id);
  }
}
