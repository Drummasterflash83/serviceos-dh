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
