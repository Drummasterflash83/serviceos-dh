// PUBLIC open/click tracking endpoint — deliberately unauthenticated, like
// marketing-unsubscribe. HARDENED against open-redirect:
//  - a click is redirected to the request-supplied destination ONLY when the
//    v2 token cryptographically binds (delivery id + event kind + that exact
//    canonical destination). ANY failure — missing / malformed / forged /
//    wrong-kind / wrong-delivery / altered-destination / unsafe-scheme /
//    ambiguous token — redirects ONLY to a fixed neutral first-party fallback
//    and makes ZERO database writes.
//  - opens always return a valid 1x1 gif; only a valid open token records.
//  - responses depend only on the requested kind, never on validity, so the
//    endpoint never discloses whether a delivery exists (non-enumerating).
//  - every query value is bounded BEFORE any HMAC/DB work; duplicate params are
//    rejected; the target is HTTPS-only, no credentials, no control chars, and
//    can never be a marketing-track URL (no self-wrapping).
//
// BOUNDED PUBLIC WRITES: a valid token is replayable for the life of the
// delivery (see the token-lifetime decision in migration 20260908120400), so
// the recorder is write-once per event kind: the FIRST open and the FIRST click
// are recorded, and every later request — including a flood of valid ones —
// performs zero writes. The lifetime write budget for any delivery is at most
// one INSERT plus one open UPDATE plus one click UPDATE, and a CHECK constraint
// makes over-counting unrepresentable. Only unique-delivery evidence exists;
// no per-request ledger and no recipient behavioural profile is kept.
//
// The tracking secret is REQUIRED: without MARKETING_TRACKING_SECRET no token
// can verify, so nothing records and nothing redirects to a supplied target.
// The secret is never logged, never echoed and never appears in a response.
// verify_jwt is OFF (set in config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  canonicalDestination,
  isUsableTrackingSecret,
  MAX_TRACK_URL_LEN,
  verifyClickToken,
  verifyOpenToken,
} from "../_shared/marketing_tracking.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LEN = 256;

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

// A FIXED neutral first-party fallback — never the request-supplied target.
function neutralFallback(): string {
  return (
    canonicalDestination(Deno.env.get("MARKETING_PUBLIC_BASE_URL") ?? null) ??
    "https://serviceos-dh-staging.vercel.app/"
  );
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const sp = url.searchParams;

  // Duplicate/ambiguous params: a request we cannot interpret unambiguously
  // records NOTHING. The response still depends only on the requested KIND, so
  // an ambiguous click follows the SAME invalid-click contract as every other
  // failure (the fixed neutral fallback) rather than being distinguishable by
  // its response shape. If `k` ITSELF is duplicated the kind is unknowable, so
  // the neutral pixel is the only honest answer.
  const kindAmbiguous = sp.getAll("k").length > 1;
  const paramsAmbiguous = ["d", "k", "t", "u"].some((k) => sp.getAll(k).length > 1);

  const kind = kindAmbiguous ? null : sp.get("k");
  const delivery = sp.get("d");
  const token = sp.get("t") ?? "";
  const rawTarget = sp.get("u");
  const fallback = neutralFallback();

  // bound every value BEFORE HMAC / DB work
  const boundedOk =
    !paramsAmbiguous &&
    !!delivery &&
    UUID_RE.test(delivery) &&
    token.length > 0 &&
    token.length <= MAX_TOKEN_LEN &&
    (rawTarget === null || rawTarget.length <= MAX_TRACK_URL_LEN);

  // a missing / blank / too-short secret is a CONFIGURATION FAILURE: it is
  // treated as "tracking not configured" — nothing verifies, nothing records,
  // and responses stay neutral. The value itself is never logged or echoed.
  const rawSecret = Deno.env.get("MARKETING_TRACKING_SECRET");
  const secret = isUsableTrackingSecret(rawSecret) ? (rawSecret as string) : null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // ── OPEN ────────────────────────────────────────────────────────────────
  if (kind === "open") {
    if (boundedOk && secret) {
      const ok = await verifyOpenToken(secret, delivery!, token);
      if (ok && supabaseUrl && serviceKey) {
        try {
          const admin = createClient(supabaseUrl, serviceKey);
          await admin.rpc("marketing_track_record", {
            p_delivery: delivery,
            p_kind: "open",
            p_url: null,
          });
        } catch {
          // best-effort; recipient experience never depends on it
        }
      }
    }
    // opens ALWAYS return a valid pixel; invalid ones simply record nothing
    return pixelResponse();
  }

  // ── CLICK ───────────────────────────────────────────────────────────────
  if (kind === "click") {
    if (boundedOk && secret) {
      const { ok, canonical } = await verifyClickToken(secret, delivery!, rawTarget, token);
      if (ok && canonical) {
        if (supabaseUrl && serviceKey) {
          try {
            const admin = createClient(supabaseUrl, serviceKey);
            await admin.rpc("marketing_track_record", {
              p_delivery: delivery,
              p_kind: "click",
              p_url: canonical,
            });
          } catch {
            // best-effort
          }
        }
        // ONLY a fully-verified token redirects to the bound destination
        return redirect(canonical);
      }
    }
    // any failure: fixed neutral fallback, ZERO writes, never the supplied url
    return redirect(fallback);
  }

  // unknown kind: a neutral pixel, nothing recorded
  return pixelResponse();
});
