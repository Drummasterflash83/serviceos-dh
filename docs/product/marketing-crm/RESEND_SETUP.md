# Resend transport — setup, limits and what is actually proven

_Last updated: 2026-08-03 (Resend sandbox activation closure)._

This document is the honest state of the Resend email transport. It is written
so that nothing here has to be discovered later: what works, what has never been
run, and exactly what the operator must do before a real email can leave the
platform.

---

## 0 · Status at a glance

| Claim                                                | State                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Code path implemented (transport, adapter, tracking) | **Yes** — built and unit/SQL/HTTP proven                      |
| Real provider submission to Resend                   | **NOT RUN** — no request has ever reached `api.resend.com`    |
| Inbox delivery observed                              | **NOT RUN** — nothing has been received anywhere              |
| Campaign / sequence handshake over Resend            | **NOT RUN** — and structurally refused for the sandbox sender |
| Earlier "fixture" success evidence                   | **RETRACTED** — see §1                                        |
| `RESEND_API_KEY` installed on staging                | **No** — deliberately absent; sending fails closed            |
| Verified sending domain                              | **No** — only the `resend.dev` sandbox identity exists        |

### FIXTURE PROOF EXPLICITLY RETRACTED

The original activation run (`a48f11b` / `c77dcb6`) recorded a staging
"successful send" while `RESEND_API_KEY` was set to the literal string
`fixture`. The transport treated that magic value as a success and **fabricated
a synthetic message id without contacting Resend**. That evidence proved
nothing about Resend and is withdrawn in full. Every downstream claim that
rested on it — provider acceptance, message ids, delivery, tracking round-trips
against a real message — is likewise withdrawn.

The fixture branch no longer exists in the deployed path. The transport now
takes an injected `fetch` for tests only; a missing, blank, malformed or
non-`re_` key fails closed with `resend_key_invalid`, makes **no network call**
and can never produce a success or a provider id.

### CRITICAL OPEN-REDIRECT CORRECTION

The first tracking implementation redirected a click to whatever `u=` the
request supplied, as long as _any_ token was present. That was an **open
redirect**: a recipient (or anyone who saw a tracking link) could swap the
destination for a phishing page while keeping a first-party ServiceOS URL in
front of it.

Corrected in `20260908120300` + `marketing-track`:

- tokens are **v2** and cryptographically bind `delivery id + event kind + the
exact canonical destination` — changing any byte invalidates the token;
- an open token is not a click token and cannot be replayed as one;
- **any** failure (missing / malformed / forged / wrong-kind / wrong-delivery /
  altered-destination / unsafe scheme / duplicate params / oversize) redirects
  only to a **fixed neutral first-party fallback**, never to the supplied URL,
  and performs **zero database writes**;
- destinations are HTTPS-only, no credentials-in-URL, no control characters, no
  self-wrapping of the tracker, and length-bounded before any HMAC work.

---

## 1 · What the sandbox sender is (and is not)

The only permitted Resend from-address today is **`onboarding@resend.dev`**, the
provider's sandbox identity on the platform key.

It is **not** a verified sender. Specifically:

- **Sandbox test-ready** — usable only for a governed _test_ send.
- **Test-to-self only** — the recipient must be the requesting actor's own
  current profile. This is proven server-side at the final pre-provider boundary
  (`evaluateSandboxSelfSend`): purpose `test`, `recipient_profile_id ===
actor_profile_id`, recipient in the same tenant, the recipient's current email
  still equal to the frozen envelope address, and the actor's own current
  profile email present, valid and that same address. Any mismatch is a
  permanent refusal **before** the provider call, so a refused send makes zero
  network requests. We do not rely on Resend rejecting the recipient for us.
- **Campaigns and sequences blocked** — a sandbox envelope with purpose
  `broadcast` or `sequence` is refused (`policy_sandbox_sender_no_campaign`).
- **Real provider submission not yet verified** — see §0.
- **Missing key fails closed** — without a valid `re_…` key the send returns
  `resend_not_configured` and nothing is sent.

Any other Resend from-address is **unavailable** and **never production-ready**:
the create RPC refuses it, readiness derives `unavailable`, and migration
`20260908120400` disables any that a previous build left behind (history
preserved, change audited).

### Sender classes the UI must keep distinct

| Class                        | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `gmail_verified`             | Gmail OAuth mailbox with a live `gmail.send` grant      |
| `workspace_verified`         | Workspace DWD mailbox on an active connection           |
| `resend_sandbox_test_ready`  | `onboarding@resend.dev` — test-to-self only             |
| `resend_production_verified` | a verified Resend domain (**does not exist yet**)       |
| `unavailable`                | misconfigured, disconnected, or a legacy Resend address |

`gmail.send` scope language belongs to the Google rows only and is never shown
on a Resend row. Provider acceptance is described as **"submitted to Resend"**,
never "delivered" and never "submitted to Gmail".

---

## 2 · User-owned key setup (what the operator does)

The key is **yours**, not the platform's. Nothing in this repository contains or
should ever contain a Resend key.

1. Create an account at <https://resend.com> and open **API Keys**.
2. Create a key with **sending** permission. It looks like `re_…`.
3. Install it as a Supabase Edge secret on the target project — and only that
   project:

   ```bash
   supabase secrets set RESEND_API_KEY=re_your_key_here --project-ref <ref>
   ```

4. Redeploy nothing: the functions read the secret at request time.

Until step 3 is done, the sandbox sender is visible in the UI but every send
fails closed with a missing-key error. That is intended.

### Verified-domain requirements (before anything real)

The sandbox address can only deliver to **your own Resend account address**. To
send to anyone else you must verify a domain:

1. In Resend, **Domains → Add domain** for a domain you control
   (e.g. `drummondheating.co.uk`).
2. Publish the DNS records Resend issues: **SPF** (TXT), **DKIM** (CNAME/TXT),
   and a **Return-Path/MX** record if Resend asks for one. **DMARC** is strongly
   recommended before any bulk sending.
3. Wait for Resend to report the domain **verified**.
4. Only then may a production sender identity on that domain be introduced —
   which needs a code change, because `marketing_sender_create_resend` currently
   accepts the sandbox address and nothing else. That restriction is deliberate:
   a tenant admin must not be able to self-assert an arbitrary sending identity
   on a shared key.

An unverified domain is rejected by Resend with 400/422, which the transport
classifies as **permanent** (`resend_validation_rejected`) — no blind retry.

---

## 3 · Open/click tracking — what it is and what it is not

Tracking is basic **delivery evidence**, not analytics.

### What is recorded

- **first open**, once, with a truthful timestamp;
- **first click**, once, with a truthful timestamp and the destination it was
  bound to (`first_click_url`);
- nothing else. There is **no per-request ledger** and **no recipient
  behavioural profile**.

### Bounded public writes (the amplification fix)

A tracking token is public by nature — it travels inside an email. Previously a
valid-but-leaked token could drive one `UPDATE` per request, for ever.
Saturating the counters prevented integer overflow but not unbounded public
database work.

`20260908120400` makes the recorder **write-once per event kind**:

- the row is probed by `SELECT` first, so a repeat event does not even attempt a
  speculative insert;
- a duplicate open or click performs **zero writes**;
- the lifetime write budget for any delivery is at most **1 INSERT + 1 open
  UPDATE + 1 click UPDATE**;
- a `CHECK` constraint (`open_count`/`click_count` between 0 and 1) makes
  over-counting structurally unrepresentable;
- concurrent duplicates converge: the loser re-evaluates `first_*_at is null`
  after the winner commits and matches zero rows.

`last_click_url` is frozen (never written again) and superseded by
`first_click_url`. Raw total-event counts are **not collected** and are no
longer reported; `marketing_campaign_tracking_summary` returns unique-delivery
evidence plus `total_event_analytics: "not_collected"`.

### Token lifetime — the explicit decision

Tracking tokens carry **no expiry** and remain valid for the life of the
delivery. A sent email lives in a mailbox indefinitely, so an expiring token
would silently discard legitimate later evidence and add a clock-skew failure
mode. The property an expiry would have bought — that a leaked token cannot be
replayed into unbounded database work — is instead provided **structurally** by
the write-once bound above, and is proven under concurrency and under a
valid-token request flood (`scripts/marketing-tracking-sql.test.mjs`).

### Honest limitations (bots and prefetchers)

Opens and clicks are **indicative email events, not verified human behaviour**:

- image proxies (Gmail, Outlook) and privacy scanners (Apple Mail Privacy
  Protection) fetch the pixel automatically — an "open" may be a machine;
- corporate link scanners and browser/mail prefetchers follow links before any
  human does — a "click" may be a machine;
- conversely, a recipient with images disabled who reads and acts on the email
  records **no** open at all;
- because evidence is unique-per-delivery, a genuine second read is invisible by
  design.

Therefore: **never** treat these numbers as engagement, and never derive a
health, objective or revenue claim from them. The summary RPC carries this
caveat in its own `metric_note`.

### Tracking secret

`MARKETING_TRACKING_SECRET` is **required** and must be at least 32 characters.
Both sides apply the same bar — the adapter refuses to _sign_ with a weak secret
and the public endpoint refuses to _verify_ with one — so a misconfigured
deployment fails closed (no signing, no recording, neutral responses) instead of
pretending tracking works. The secret is never logged, echoed, or returned.

Generate one with:

```bash
openssl rand -hex 32
```

---

## 4 · Deployment steps (in order)

1. **Database** — apply, in order:
   `20260908120000_marketing_resend_transport.sql`,
   `20260908120100_marketing_email_tracking.sql`,
   `20260908120200_marketing_resend_capability_sync.sql`,
   `20260908120300_marketing_resend_hardening.sql`,
   `20260908120400_marketing_resend_sandbox_closure.sql`.
   The first four are already applied on staging and are **immutable**; the
   closure migration is additive and idempotent.
2. **Secrets** — `MARKETING_TRACKING_SECRET` (≥32 chars) and
   `MARKETING_PUBLIC_BASE_URL`. `RESEND_API_KEY` is installed by the operator
   when they are ready to send (§2).
3. **Functions** — deploy `marketing-senders`, `marketing-track`, and the worker
   that hosts the connector (`platform-worker`).
4. **Config** — `marketing-track` runs with `verify_jwt = false`; it is public
   by design and non-enumerating.

---

## 5 · Verification runbook (local)

```bash
node --test scripts/marketing-resend-pure.test.mjs
```

```bash
node scripts/marketing-tracking-sql.test.mjs
```

```bash
node scripts/marketing-track-http.test.mjs
```

```bash
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_senders.test.sql
```

---

## 6 · What is still NOT RUN

- **Real provider submission** — `NOT RUN`.
- **Inbox delivery** — `NOT RUN`.
- **Campaign handshake over Resend** — `NOT RUN` (and refused for the sandbox).
- **Open/click round-trip against a genuinely delivered message** — `NOT RUN`;
  the tracking proofs use synthetic deliveries.
- **Staging tracking-secret strength** — the secret's value is not readable from
  outside (the management API exposes a digest only), so the ≥32-character bar
  is asserted by configuration on staging, not observed there. It is observed in
  the local suites.

Until the operator installs a real key and a genuine test-to-self send is
observed, every "email sending works" claim is premature.
