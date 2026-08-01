# Ads — Lead Capture, Attribution, Metrics & Source Health (Phase 8)

> Reality: BUILT + locally proven with SYNTHETIC fixtures only. No real
> provider has ever been contacted, no real lead ingested, no email sent, no
> model called. Authenticated/public HTTP and populated visual QA are NOT RUN
> (no served runtime). **Ads captures and attributes leads; it does not
> create, edit, optimise or publish advertisements.**

## What Ads does / does not do

DOES: versioned tenant Ad Source configuration → authenticated, replay-safe
signed-webhook events → append-only source evidence → ONE canonical inbound
Interaction per lead → canonical identity resolution → Person/relationship
through the existing governed authorities → append-only attribution
touchpoints (derived first/last touch) → honest source/lead/metric reporting →
live-derived health and attention.

DOES NOT: create/edit adverts, contact any ad provider, invent a marketing
subscription (a form submission is inbound-lead evidence, never bulk-consent —
eligibility stays `unknown` until a real preference exists), fabricate spend/
CPL/conversions/attribution, or build Phase-9 Business Graph/Card projections.

## Provider catalogue (truthful)

| Provider                          | Mode    | State                         | Why                                                                                                        |
| --------------------------------- | ------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Signed webhook (provider-neutral) | webhook | **Operational (local proof)** | The ONE implemented ingestion mode — honestly labelled; never masquerades as a direct provider integration |
| Meta / Facebook / Instagram       | api     | **Not connected**             | No adapter, no credentials, no provider-specific signature/challenge verification                          |
| Google Ads                        | api     | **Not connected**             | No adapter, no OAuth/developer-token flow                                                                  |
| LinkedIn                          | api     | **Not connected**             | No adapter, no OAuth flow                                                                                  |
| Authenticated Google Sheet        | sheet   | **Not connected**             | Only an AUTHENTICATED Workspace-connected adapter would qualify; public sheets are never used              |

No unimplemented provider offers manual sync, metrics or events; nothing is
fabricated. `marketing_ad_manual_sync` refuses with the stable `UNSUPPORTED`
classification for every v1 provider. No scheduler definition is registered
(nothing polls); cron is never installed.

## The signed webhook contract

```
POST /functions/v1/marketing-ad-webhook/{public_key}
x-serviceos-timestamp: <unix seconds>
x-serviceos-signature: hex( HMAC-SHA256(secret, timestamp + "." + raw_body) )
content-type: application/json   (body ≤ 65536 BYTES, UTF-8 measured)
```

- `public_key` is an OPAQUE 48-hex route key (24 random bytes) minted
  server-side at source creation. It never carries tenant/person/secret
  material; the source→tenant mapping is server-side only and the body is
  never trusted for tenant resolution.
- The signature covers the EXACT raw request bytes and the timestamp, and is
  verified BEFORE any JSON parsing; freshness window ±300 s; comparison is
  length-guarded XOR (constant-time shape).
- **Every** authentication failure — unknown key, disabled/unconfigured
  source, missing credential, malformed/stale/future timestamp, bad
  signature — returns ONE identical generic `401 {"ok":false}` and performs
  ZERO writes. The endpoint never reveals whether a source or tenant exists.
- Secrets and signatures are never logged.

### Signing secret creation and rotation

`webhook_setup` (owner/admin + `marketing.ads.manage`) generates 32 random
bytes server-side, stores them ONLY in the tenant Vault broker
(`provider_secret_store('ads-src-<source>', 'signing_key')`), records the
factual rotation as immutable version evidence
(`marketing_ad_source_credential_mark`) and returns the secret EXACTLY ONCE.

- **Idempotent.** The governed credential mark (request-id gated) runs BEFORE
  any Vault write, so replaying a `webhook_setup` request id NEVER rotates the
  secret a second time and NEVER re-reveals it — it converges on the stored,
  secret-less result. To obtain a new secret you must rotate again with a new
  request id.
- **Bounded overlap, then RETIREMENT.** Rotation moves current →
  `signing_key_previous` and stamps `credential_rotated_at`. The previous
  secret is honoured ONLY for a bounded overlap window
  (`ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS`, 24 h) after that instant, so
  in-flight deliveries survive rotation but a rotated-away secret is retired on
  a definite schedule — it is **never** valid indefinitely. A compromised
  secret is therefore fully retired by rotating and waiting out the overlap (or
  by rotating twice). Historical event evidence is never deleted.
- **Lost-response recovery.** If the response is lost after the Vault write,
  the shown-once secret is gone; retrying the same request id converges
  (no secret), so you simply rotate again — no orphan credential is created in
  the Vault, and the source keeps failing closed on the old/absent secret in
  the meantime.

### Payload (`ads-lead@1`, strict)

`schema_version, event_id, occurred_at, campaign_ref?, ad_ref?, form_ref?,
lead{first_name?, last_name?, full_name?, email?, phone?, company?},
meta{utm_source?, utm_medium?, utm_campaign?, utm_term?, utm_content?,
landing_url?}, external_ref?, consent{basis, text?, captured_at?}?` — unknown
keys at ANY level refuse; all string fields are length-bounded and
control-character-free; a lead needs at least an email, phone or name. The
ledger stores only the BOUNDED normalised envelope — never the raw provider
body, never signatures.

- **`event_id` is the STABLE PER-LEAD identifier — the dedup key.** The sender
  MUST supply the SAME `event_id` for every delivery/retry of the same factual
  lead (format `^[A-Za-z0-9._:-]{1,120}$`). It is not a per-delivery-attempt
  id: dedup, the canonical inbound Interaction and the identity idempotency key
  (`md5('ad-lead:'||event_id)`) all key on it. A sender that mints a fresh
  `event_id` per retry defeats dedup and can create duplicate evidence for a
  lead that carries no email/phone (a name-only lead is never silently merged).
- **`occurred_at` is a bounded, real-time instant.** It must be a valid ISO-8601
  timestamp within `received_at − 30 days … received_at + 1 day`; outside that
  window it is refused. This keeps an untrusted ancient or far-future value from
  stealing a Person's first/last attribution touch or skewing metric windows.

## Replay, dedup and conflicts

Events dedupe on `(source, provider_event_id)`. An identical replay converges
on the original event (`replay_count` increments; the idempotent processing
job is re-enqueued, recovering a lost enqueue). The same id with a DIFFERENT
body digest is a data-integrity conflict recorded as **digests only** (no
PII) and surfaced in health. Ledger identity/payload are immutable; the
processing state machine is forward-only; deletes are refused.

## Identity resolution (the canonical engine — nothing parallel)

Processing calls `marketing_create_contact` (the ONE identity authority) with
the event-derived idempotency key `md5('ad-lead:'||event_id)` — replay can
never mint a duplicate Person:

- exact normalised email/phone match on ONE Person → converge (no new
  Person; an existing ACTIVE classification is NEVER overwritten; if none is
  active, the version-pinned source defaults classify through
  `marketing_classify_contact`).
- ≥2 candidate People → the EXISTING `marketing_identity_conflicts` review
  path; the event parks as `review`, the Interaction and touchpoint evidence
  stay (`confidence='review'`, no fabricated person link). Name-only never
  silently merges (no identifiers → a new Person with honest provenance).
- New Person/contact points/relationship carry `source='ad_lead'` +
  `source_record_ref='ad_event:<id>'` (the vocabulary the relationship model
  reserved). Ad-lead contact points become protected evidence (non-manual
  source ⇒ value edits refuse).
- The authorising human is the admin who committed the PINNED source
  configuration version. Retired defaults are never silently substituted —
  the exact reason lands in evidence/health (`failed`/note) for review.

## Attribution semantics

One append-only touchpoint per FACTUAL provider event (unique per event ⇒
replay-safe), pinning source version, provider refs, event, Interaction,
Person (WRITE-ONCE — governed reconciliation may attach a later-resolved
Person, never rewrite one), confidence (`exact|review|unresolved` —
evidence-based) and correlation. First/last touch are DERIVED deterministically
over `(occurred_at, id)` — stable ties, never stored, never reordered. No
campaign contribution, job, quote, revenue or Objective outcome is ever
fabricated from a touchpoint.

## Metrics and CPL truth

`marketing_ad_metric_facts` is append-only, service-role-only (browsers can
never insert), with supersession for corrections (history preserved, current
projection excludes superseded facts). Spend structurally requires a
currency. CPL derives ONLY when genuine spend exists in ONE currency with a
factual denominator > 0 — otherwise `null` + the exact reason
(`no_spend_facts | mixed_currencies | zero_leads`). Three counts stay
distinct and labelled: provider-reported leads, ServiceOS received events,
resolved People. **No spend/CPL exists until a genuinely connected adapter
reports facts — today that is: none.**

## Processing runtime

`platform_jobs` job `marketing.ad_lead_process` (registered in
`WORKER_HANDLERS`), enqueued by the webhook on accept AND replay (job key
de-dups; the claim RPC + expired-lease reclaim make a crashed worker
recoverable); bounded batches via `marketing_ad_claim_events` (FOR UPDATE
SKIP LOCKED + lease); ONE governed RPC transaction per event
(`marketing_ad_lead_process`); continuation only while pending work remains.
Governed retry (`event_retry`, owner/admin + ads.manage, request-id
idempotent, attempts-bounded) re-pends `failed`/`review` events.

## Permissions

Reads (`overview/source_list/source_detail/lead_feed/lead_detail/attribution/
metrics/health/catalogue`): `marketing.view`. Management (`source_create/
revise/status/webhook_setup/manual_sync/event_retry`): owner/admin structural
ceiling + `marketing.ads.manage` — enforced at the Edge AND inside every RPC
(`marketing_require_ads_actor`), so hostile grants to ops/viewers stay inert
and explicit denies remain effective. The public webhook authenticates by
source signature only and can never reach management operations; the
authenticated API can never bypass webhook signing. Browsers cannot insert
provider events, touchpoints or metric facts.

## Verification runbook (local)

```
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_ads.test.sql
node --test scripts/marketing-ads-pure.test.mjs
node scripts/marketing-ads.test.mjs            # needs the local stack + service key
node scripts/marketing-ads-http.test.mjs       # exit 3 NOT-RUN without a served runtime
bash scripts/intelligence-conformance.sh
node scripts/check-migration-order.mjs
```

## Deployment steps (when going live)

1. Apply `supabase/migrations/20260905120000_marketing_ads.sql`.
2. Deploy `marketing-ads`, `marketing-ad-webhook` AND redeploy the shared
   `platform-worker` bundle (new job type).
3. Owner/admin creates a webhook source, generates the signing secret (shown
   once) and configures the sending system to sign requests.
4. Run the authenticated HTTP + signed-webhook battery on the served runtime
   and populated visual QA before any Live claim.

## What stays honestly unproven / provider gaps

- Authenticated management HTTP and the public signed-webhook HTTP paths:
  **NOT RUN — exit 3** locally (no served runtime; ambiguous gateway
  responses are never classified as served).
- Populated visual QA: **NOT RUN**.
- Meta / Google Ads / LinkedIn / authenticated-Sheet adapters do not exist:
  no provider-specific signature/challenge verification, no lead-detail
  fetch, no metric sync, no cursor management — each requires a reviewed
  adapter + tenant Vault credentials + provider-specific verification before
  leaving Not connected.
- No scheduled sync exists (nothing polls); `marketing-ads-scheduled-sync`
  is deliberately NOT created until a polling adapter exists.
- Identity-conflict resolution remains the platform's existing review
  surface; a dedicated resolution UI is future work. The health remediation
  "Identity review required" names that human step; it is guidance, not a
  one-click action.
- "Attention" is **live-derived health**, surfaced on the Ads health/overview
  reads (a pull, computed per request from the factual ledgers). It is NOT a
  push notification and Phase 8 registers no `system_health_components` sensor,
  so it does not yet appear in the Command Centre — consistent with the prior
  marketing phases. The per-source `notify_attention` flag only gates whether a
  source contributes to that derived attention. A real notification channel is
  future work.
