// ServiceOS — Marketing Ads PUBLIC signed-webhook receiver (Phase 8).
//
// POST /marketing-ad-webhook/{public_key}
//
// The provider-neutral ServiceOS lead-capture contract — honestly a SIGNED
// WEBHOOK, never a fake direct Meta/Google/LinkedIn integration. The opaque
// public key routes to a tenant SERVER-SIDE; no tenant id, person id, email
// or secret ever appears in the URL, and the body is NEVER trusted for
// tenant resolution.
//
// AUTHENTICATION IS THE RAW-BYTE SIGNATURE:
//   x-serviceos-signature = hex(HMAC-SHA256(secret, timestamp + "." + raw_body))
// with the per-source secret read from the tenant Vault broker only (current
// + previous during rotation), a ±300s freshness window and constant-time
// comparison. EVERY authentication failure — unknown key, disabled source,
// missing credential, bad timestamp, bad signature — returns the IDENTICAL
// generic 401 and performs ZERO writes: the endpoint never reveals whether a
// source or tenant exists. Secrets and signatures are never logged.
//
// Accepted events dedupe by (source, provider event id): an identical replay
// converges on the original event; the same id with a DIFFERENT body is a
// data-integrity conflict recorded as digests only. Accepted/replayed events
// (re-)enqueue the idempotent marketing.ad_lead_process job — a lost enqueue
// is recovered by the next replay.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ADS_WEBHOOK_MAX_BODY_BYTES,
  ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS,
  adsWebhookBodyByteLength,
  buildAdsEventEnvelope,
  isValidPublicKey,
  parseAdsLeadPayload,
  sha256Hex,
  verifyAdsWebhookSignature,
} from "../_shared/marketing_ad_webhook.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";

const headers = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};
// ONE generic unauthorised response for every authentication-path failure —
// indistinguishable across unknown key / disabled source / bad signature
const unauthorized = () => new Response(JSON.stringify({ ok: false }), { status: 401, headers });
const badRequest = (code: string, message: string) =>
  new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 400,
    headers,
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  const publicKey = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!isValidPublicKey(publicKey)) return unauthorized();

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (contentType !== "application/json") {
    return badRequest("unsupported_content_type", "content-type must be application/json");
  }
  // Reject an oversized DECLARED length before buffering, and a malformed one.
  // A missing/false content-length is allowed through to the authoritative
  // byte check below (it can be spoofed smaller, so it is never trusted alone).
  const clHeader = req.headers.get("content-length");
  if (clHeader !== null) {
    if (!/^[0-9]{1,15}$/.test(clHeader.trim())) {
      return badRequest("invalid_content_length", "content-length must be a non-negative integer");
    }
    if (Number(clHeader) > ADS_WEBHOOK_MAX_BODY_BYTES) {
      return badRequest("invalid_body_size", "body must be 1..65536 bytes");
    }
  }
  // EXACT raw bytes — read before any parsing; the signature covers these. The
  // limit is measured in BYTES (UTF-8), not UTF-16 code units, so a multibyte
  // body cannot smuggle up to ~3x the ceiling past a code-unit length check.
  const rawBody = await req.text();
  const bodyBytes = adsWebhookBodyByteLength(rawBody);
  if (bodyBytes === 0 || bodyBytes > ADS_WEBHOOK_MAX_BODY_BYTES) {
    return badRequest("invalid_body_size", "body must be 1..65536 bytes");
  }

  // opaque server-side source→tenant mapping (never from the body)
  const src = await admin
    .from("marketing_ad_sources")
    .select("id, tenant_id, status, mode, credential_state, credential_rotated_at")
    .eq("public_key", publicKey)
    .maybeSingle();
  if (
    src.error ||
    !src.data ||
    src.data.mode !== "webhook" ||
    src.data.status !== "active" ||
    src.data.credential_state !== "configured"
  ) {
    return unauthorized();
  }
  const tenantId = src.data.tenant_id as string;
  const sourceId = src.data.id as string;

  // per-source secret from the tenant Vault broker ONLY (never env, never DB)
  const cur = await admin.rpc("provider_secret_read", {
    p_tenant: tenantId,
    p_provider: `ads-src-${sourceId}`,
    p_field: "signing_key",
  });
  if (cur.error || typeof cur.data !== "string" || cur.data.length === 0) {
    return unauthorized();
  }
  const prev = await admin.rpc("provider_secret_read", {
    p_tenant: tenantId,
    p_provider: `ads-src-${sourceId}`,
    p_field: "signing_key_previous",
  });

  // The previous secret is honoured only inside the bounded rotation overlap
  // after credential_rotated_at — never indefinitely.
  const rotatedAt = src.data.credential_rotated_at
    ? Date.parse(src.data.credential_rotated_at as string)
    : NaN;
  const previousValidUntilMs = Number.isNaN(rotatedAt)
    ? null
    : rotatedAt + ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS * 1000;

  const verdict = await verifyAdsWebhookSignature({
    secrets: {
      current: cur.data,
      previous: typeof prev.data === "string" ? prev.data : null,
      previousValidUntilMs,
    },
    timestampHeader: req.headers.get("x-serviceos-timestamp"),
    signatureHeader: req.headers.get("x-serviceos-signature"),
    rawBody,
    nowMs: Date.now(),
  });
  if (!verdict.ok) return unauthorized();

  // ── authenticated from here: validation detail is safe for the sender ──
  const parsed = parseAdsLeadPayload(rawBody);
  if (!parsed.ok) return badRequest(parsed.code, parsed.message);
  // Bound the client-supplied occurrence time (defence in depth — the SQL
  // ingest re-checks authoritatively). A real-time lead-capture webhook cannot
  // legitimately report a lead that occurred in the far future or long past;
  // rejecting keeps an untrusted timestamp from stealing first/last attribution
  // touch or skewing metric windows.
  const occurredMs = Date.parse(parsed.payload.occurred_at);
  const nowMs = Date.now();
  if (occurredMs > nowMs + 86400_000 || occurredMs < nowMs - 30 * 86400_000) {
    return badRequest("invalid_occurred_at", "occurred_at is outside the acceptable window");
  }
  const digest = await sha256Hex(rawBody);

  const ingest = await admin.rpc("marketing_ad_event_ingest", {
    p_tenant: tenantId,
    p_source: sourceId,
    p_args: {
      provider_event_id: parsed.payload.event_id,
      occurred_at: parsed.payload.occurred_at,
      body_digest: digest,
      schema_version: parsed.payload.schema_version,
      envelope: buildAdsEventEnvelope(parsed.payload),
    },
  });
  if (ingest.error) {
    // the source stopped accepting between lookup and commit-time re-check —
    // still the same generic response, still zero disclosure
    return unauthorized();
  }
  const data = (ingest.data ?? {}) as { event_id?: string; outcome?: string };
  if (data.outcome === "conflicted") {
    return new Response(JSON.stringify({ ok: false, error: { code: "EVENT_CONFLICT" } }), {
      status: 409,
      headers,
    });
  }
  // enqueue on ACCEPT and on REPLAY: the job key de-dups one active job per
  // tenant and a replay recovers a lost enqueue
  if (data.event_id) {
    await enqueueJob(admin, {
      tenantId,
      jobType: "marketing.ad_lead_process",
      jobKey: `marketing.ad_lead_process:${tenantId}`,
      connectorId: "marketing-ads",
      moduleId: "marketing.ads",
    });
  }
  return new Response(
    JSON.stringify({ ok: true, event_id: data.event_id, outcome: data.outcome }),
    { status: 200, headers },
  );
});
