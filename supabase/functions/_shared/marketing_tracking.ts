// Marketing email tracking — pure helpers shared by the send adapter (which
// SIGNS + injects, write-free) and the public marketing-track endpoint (which
// VERIFIES + records). The token is an HMAC over `${deliveryId}:${kind}` with a
// server-only secret, so a recipient cannot forge an event for another
// delivery. The click target rides an unsigned `u` param — good enough for
// basic tracking (it can only change the recorded last_click_url of a delivery
// the recipient already legitimately holds a token for).

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// constant-time string compare (equal length short-circuits are unavoidable,
// but the per-char work does not early-exit on the first mismatch)
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function trackingToken(
  secret: string,
  deliveryId: string,
  kind: "open" | "click",
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${deliveryId}:${kind}`));
  return base64url(new Uint8Array(sig));
}

export async function verifyTrackingToken(
  secret: string,
  deliveryId: string,
  kind: "open" | "click",
  token: string,
): Promise<boolean> {
  if (!token) return false;
  const expected = await trackingToken(secret, deliveryId, kind);
  return timingSafeEqualStr(expected, token);
}

export interface TrackingInjection {
  openUrl: string; // fully-formed pixel URL (already carries d, k=open, t)
  clickBase: string; // "<base>/functions/v1/marketing-track"
  clickToken: string; // HMAC for (deliveryId, 'click')
  deliveryId: string;
}

export function clickUrlFor(inj: TrackingInjection, targetUrl: string): string {
  return (
    `${inj.clickBase}?d=${encodeURIComponent(inj.deliveryId)}` +
    `&k=click&t=${encodeURIComponent(inj.clickToken)}&u=${encodeURIComponent(targetUrl)}`
  );
}

// Rewrite absolute http(s) links to route through the click tracker, and append
// a hidden open-pixel before </body> (or at the end). Anchors without an http
// href (mailto:, #, already-tracked) are left untouched. Pure + synchronous —
// the caller pre-computes the signed URLs.
export function injectTrackingHtml(html: string, inj: TrackingInjection): string {
  const rewritten = html.replace(
    /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
    (_m, url: string) => `href="${clickUrlFor(inj, url)}"`,
  );
  const pixel =
    `<img src="${inj.openUrl}" alt="" width="1" height="1" ` +
    `style="display:none;max-width:0;max-height:0;overflow:hidden" />`;
  if (/<\/body>/i.test(rewritten)) {
    return rewritten.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return rewritten + pixel;
}

// A safe redirect target: only http(s), bounded length. Anything else → null so
// the endpoint sends the recipient to a neutral fallback instead of an
// attacker-chosen scheme (javascript:, data:, etc.).
export function safeRedirectTarget(u: string | null): string | null {
  if (!u || u.length > 2048) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
