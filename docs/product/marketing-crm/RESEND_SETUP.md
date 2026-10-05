# Resend transport — setup, limits and what is actually proven

_Last updated: 2026-08-03 (governed verified-domain senders)._

This document is the honest state of the Resend email transport. It is written
so that nothing here has to be discovered later: what works, what has never been
run, and exactly what the operator must do before a real email can leave the
platform.

Three claim strengths are kept distinct throughout: **code-complete** (built and
locally proven), **staging-proven** (observed against the real staging project)
and **production-live** (running for real customers — nothing here is that yet).

---

## 0 · Status at a glance

| Claim                                                | State                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Code path implemented (transport, adapter, tracking) | **Code-complete** — unit/SQL/HTTP proven                                                  |
| Real provider submission to Resend                   | **PROVEN (staging, sandbox sender)** — provider id `c587b2fe-861d-4194-aff8-7b0041d8b263` |
| Inbox delivery observed                              | **CONFIRMED by Chris** for that sandbox submission                                        |
| Governed verified-domain (production) senders        | **Code-complete**; staging activation for `hello@drummonds.co` — see §7                   |
| Campaign / sequence handshake over Resend            | **NOT RUN** — permitted only for a production-verified sender; none has been launched     |
| Earlier "fixture" success evidence                   | **RETRACTED** — see below                                                                 |
| `RESEND_API_KEY` installed on staging                | **Yes** (operator-owned; never in this repository)                                        |
| Verified sending domain                              | **`drummonds.co` verified in Resend** (SPF, DKIM, return-path MX, DMARC via GoDaddy)      |
| Production Supabase / production frontend            | **UNTOUCHED** — no production deployment has occurred                                     |

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

One of the two governed Resend classes is the **sandbox** identity
**`onboarding@resend.dev`** on the platform key. (The other is a
production-verified identity backed by a platform sender authority — see §7.)

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
- **Real provider submission PROVEN** — one governed test-to-self send was
  accepted by Resend (provider id `c587b2fe-861d-4194-aff8-7b0041d8b263`) and
  Chris confirmed inbox receipt. See §0.
- **Missing key fails closed** — without a valid `re_…` key the send returns
  `resend_not_configured` and nothing is sent.

Any other Resend from-address is **unavailable by default**: the create RPC
refuses it (`42501`) and readiness derives `unavailable`, unless an OpenFolk
operator holds an ACTIVE platform sender authority for that exact tenant and
address (§7). Migration `20260908120400` disabled any legacy arbitrary address a
previous build left behind (history preserved, change audited).

### Sender classes the UI must keep distinct

| Class                        | Meaning                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `gmail_verified`             | Gmail OAuth mailbox with a live `gmail.send` grant       |
| `workspace_verified`         | Workspace DWD mailbox on an active connection            |
| `resend_sandbox_test_ready`  | `onboarding@resend.dev` — test-to-self only              |
| `resend_production_verified` | an ACTIVE platform sender authority on a verified domain |
| `resend_revoked`             | the platform sender authority was revoked — unusable     |
| `unavailable`                | misconfigured, disconnected, or no sender authority      |

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

## 6 · What is proven, and what is still NOT RUN

**Proven (staging):**

- **Real provider submission** — a governed test-to-self send from the sandbox
  sender reached `api.resend.com` and was accepted with provider id
  `c587b2fe-861d-4194-aff8-7b0041d8b263` (delivery
  `062dd998-3b5d-4be6-9168-10ad1dfb9cb3`, 2026-08-03T11:52:01Z). Exactly one
  provider request; the fixture branch does not exist in the deployed path.
- **Inbox delivery** — Chris confirmed receipt of that message.
- **Governed verified-domain senders** — the platform sender-authority model
  (§7) is code-complete and proven by SQL, service-boundary and concurrency
  suites.

**Still NOT RUN:**

- **Campaign or sequence over Resend** — permitted only for a
  production-verified sender, and none has been launched. No broadcast or
  sequence has ever been sent from this platform.
- **Open/click round-trip against a genuinely delivered message** — the tracking
  proofs use synthetic deliveries.
- **Production** — no production Supabase migration, function deploy or frontend
  deployment has occurred. Production holds no Marketing schema at all.
- **Staging tracking-secret strength** — the management API exposes a digest
  only, so the >=32-character bar is asserted by configuration on staging, not
  observed there (it is observed in the local suites).

---

## 7 · Governed verified-domain (production) senders

The sandbox restriction was never lifted. Instead there is exactly one governed
way past it: a **platform sender authority**.

### The security model

- A tenant admin **cannot** self-assert a sending identity on the shared
  Openfolk Resend key. Creation of any non-sandbox Resend sender is refused
  (`42501`) unless an authority already exists.
- An authority names the **exact tenant, exact normalised address, its own
  domain and the transport**. There is no tenant-wide, domain-wide or wildcard
  form, and matching is exact string equality — `hello@mail.drummonds.co`,
  `hello@drummonds.co.uk` and `hello@drummonds.co.evil.com` are simply different
  strings that match nothing.
- Granting and revoking are **service-role only** _and_ require the acting
  profile to hold an ACTIVE `platform.controlplane.admin` grant in the existing
  effective-dated `platform_authority_grants` ledger. No tenant role, marketing
  permission or access grant can satisfy it.
- The grant RPC takes an **exact argument allowlist**. There is no `verified`,
  `ready`, `state` or provider flag a caller could assert; `verified_at` is
  server time.
- Addresses are **normalised to printable ASCII** before storage and before
  every lookup, so case, whitespace, control-character, zero-width and Unicode
  homoglyph variants can never reach a row other than the one they appear to
  name. Untrustworthy input is refused outright rather than coerced.
- **Revocation is immediate**: readiness derives from the authority and
  capability truth is re-synchronised in the same transaction. A revoked
  authority can never be reinstated — its history is preserved and a new
  authority must be granted after re-verifying the domain.
- Identity is **immutable** on both sides: an authority cannot be re-pointed or
  moved between tenants, and a sender's mailbox address cannot change — so an
  existing frozen envelope can never silently switch sending identity.
- The Resend API key is never stored, logged, returned or referenced by any of
  this.

### The four honest Resend readiness states

| State           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `sandbox_ready` | `onboarding@resend.dev` — test-to-self only, campaigns/sequences blocked |
| `ready`         | production verified — an ACTIVE authority exists; bulk permitted         |
| `revoked`       | the authority was revoked — unusable, history preserved                  |
| `unavailable`   | no authority exists for this exact tenant + address                      |

### Granting an authority (OpenFolk operator only)

```sql
select marketing_sender_authority_grant(
  '<operator profile id>',
  jsonb_build_object(
    'tenant_id','<tenant uuid>',
    'sender_address','hello@drummonds.co',
    'domain','drummonds.co',
    'from_name','ServiceOS by Drummonds',
    'reply_to','chris@openfolk.ai',
    'reason','domain verified in Resend',
    'request_id','<8-64 char idempotency key>'));
```

Revoke with `marketing_sender_authority_revoke(actor, {tenant_id, sender_address, reason})`.

`drummonds.co` is verified in Resend with SPF, DKIM, return-path MX, DMARC and
tracking-link records configured through GoDaddy. Google Workspace for the
domain is still awaiting release case `74004687`, which does **not** affect
outbound Resend sending: `hello@drummonds.co` needs no mailbox to send. Reply-To
is temporarily `chris@openfolk.ai` and can move to `hello@drummonds.co` once
Workspace is available.
