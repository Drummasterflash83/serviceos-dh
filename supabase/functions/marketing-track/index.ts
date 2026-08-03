// PUBLIC open/click tracking endpoint — deliberately unauthenticated, like
// marketing-unsubscribe. It records an open (1x1 gif) or a click (302 redirect)
// only when the HMAC token verifies against the delivery id; otherwise it
// behaves identically (a gif / a neutral redirect) so it never discloses
// whether a delivery exists or a token was valid. It reveals no tenant data and
// accepts no body — the only inputs are the signed query params the adapter
// embedded. verify_jwt is OFF (set in config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { safeRedirectTarget, verifyTrackingToken } from "../_shared/marketing_tracking.ts";

// 1x1 transparent GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

function pixelResponse(): Response {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "content-length": String(PIXEL.length),
    },
  });
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store, private" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const kind = url.searchParams.get("k"); // 'open' | 'click'
  const delivery = url.searchParams.get("d");
  const token = url.searchParams.get("t") ?? "";
  const target = url.searchParams.get("u");
  const safeTarget = safeRedirectTarget(target);
  // neutral fallback for clicks whose target is missing/unsafe
  const fallback =
    safeRedirectTarget(Deno.env.get("MARKETING_PUBLIC_BASE_URL") ?? null) ?? "https://example.com";

  const secret = Deno.env.get("MARKETING_TRACKING_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // uuid shape guard (never hits the DB with junk)
  const uuidOk =
    !!delivery && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(delivery);

  let verified = false;
  if (secret && uuidOk && (kind === "open" || kind === "click")) {
    verified = await verifyTrackingToken(secret, delivery!, kind, token);
  }

  // record only a verified event; never disclose the outcome
  if (verified && supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      await admin.rpc("marketing_track_record", {
        p_delivery: delivery,
        p_kind: kind,
        p_url: kind === "click" ? safeTarget : null,
      });
    } catch {
      // recording is best-effort; the recipient experience never depends on it
    }
  }

  // response shape depends ONLY on the requested kind, not on validity
  if (kind === "click") return redirect(safeTarget ?? fallback);
  return pixelResponse();
});
