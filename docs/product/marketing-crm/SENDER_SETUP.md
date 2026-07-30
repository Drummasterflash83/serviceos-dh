# Marketing Senders — Gmail / Workspace send setup (Phase 4)

_Reality: **Preview / Local Only.** The code paths below are built and locally
proven with stubbed provider results. No real Google credential has been
exercised for sending, no live test send has been performed, and nothing is
deployed. This document records exactly what must be true externally before a
real send can happen._

## What sending requires

A Marketing test send transmits through **one governed path only**:

```
marketing-senders (Edge, authenticated)
  → marketing_test_send_request (SQL: Action + honest AUTOMATION_AUTHORISED
    DecisionPackage + pending send_marketing_test_email intent + delivery
    projection — an EXPLICIT DELEGATED test action under the actor's
    marketing.campaigns.test; NO approval row exists or is fabricated)
  → platform_jobs automation.execute → the UNTOUCHED Automation Engine
  → connectors/marketing_email.ts (the ONE registered external adapter;
    frozen-envelope-only content + execution-time actor/readiness rechecks)
  → Gmail users/me/messages.send
  → automation_finalize_execution → marketing.delivery_sync reconciler
  → email_messages (outbound, converging with ingestion)
  → the STANDARD interactions.sync job (enqueued deterministically on
    confirmed submission) → the canonical Interaction projector
```

Broadcast deployment (Phase 5) builds on everything here — see
[BROADCAST_SETUP.md](BROADCAST_SETUP.md) for the scheduler secret, the public
unsubscribe base URL and the launch-authority model.

Authority note: a test send is delegated authority, not review — Phase 5
broadcasts must register their own bulk-send intent type and/or an explicit
approval-requiring Decision Package; the engine's approval guard is untouched
and still enforces approval wherever a package or intent type demands it.

No browser and no Marketing Edge function ever calls Gmail's send API.

## Scopes

- **Gmail OAuth accounts** — `GMAIL_SCOPES` now includes
  `https://www.googleapis.com/auth/gmail.send` (the ONLY write scope; read-only
  sync scopes unchanged). Accounts connected **before** Phase 4 hold grants
  without it: the Senders UI reports **Re-authorisation required** from the
  STORED grant (`email_oauth_tokens.scope`) — never inferred from account
  status. Re-run the normal Gmail connect flow (it uses `prompt=consent` +
  `include_granted_scopes=true`) to extend the grant.
- **Workspace domain-wide delegation** — sending mints the SMALLEST practical
  token: `gmail.send` only, impersonating exactly the selected mailbox
  (`getDelegatedGmailSendToken`). The Workspace admin must add
  `https://www.googleapis.com/auth/gmail.send` to the service account's DWD
  grant (Admin console → Security → API controls → Domain-wide delegation),
  alongside the existing read scopes. `authorised_scopes` on the connection
  records what was REQUESTED, not what was granted — the only honest proof is
  the **Verify send authorisation** action, which performs a real send-scope
  token mint (no email is sent) and records the evidence.

## Per-tenant enablement (never seeded)

`email.send_marketing` is registered globally (capability + contract + intent
type) but enabled for a tenant ONLY while that tenant holds at least one
**enabled sender whose send scope is verified** —
`marketing_sender_capability_sync` flips `tenant_connector_capabilities`
(`google-gmail` / `email.send_marketing`) on and off with sender state. This
truth is **self-refreshing**: narrowly scoped triggers on the authoritative
source tables (Gmail account status/auth-state/address, OAuth token
insert/update/delete, Workspace mailbox and connection state, and the FK
set-null a sender suffers when its source is deleted) re-run the sync in the
same transaction as the change, and the overview re-syncs before reading —
capability state never depends on someone remembering to call the sync RPC.
Tenants with no Marketing sender profile are never touched by these triggers.
No migration enables any tenant.

## Operational mode truth

The Automation Engine's Operational Mode re-check applies unchanged. A
marketing email is honestly recorded as **irreversible**, so execution proceeds
only in a mode whose behaviour permits irreversible external work (currently
`trusted` / `optimisation`; the platform default is `discovery` and the
assisted-mode behaviour requires reversibility). In lower modes a test send is
accepted, queued and then **withheld by the engine as mode-blocked with its
real reason** — that is correct behaviour, not a bug. Raising a tenant's mode
is an explicit operator decision (tenant-scoped
`operating_profile_entries` override), separate from sender setup.

## External configuration still required (before any real send)

1. Deploy migration `20260901120000_marketing_sender_delivery.sql` and the
   `marketing-senders` function; deploy the updated shared modules + worker
   (adapter + `marketing.delivery_sync` handler ride the shared bundle).
2. Google Cloud: the existing OAuth client is unchanged, but every OAuth
   sender account must re-consent to pick up `gmail.send`.
3. Workspace admin: extend the DWD grant with `gmail.send` for the existing
   service account (`GOOGLE_WORKSPACE_CLIENT_EMAIL` / `GOOGLE_WORKSPACE_PRIVATE_KEY`
   secrets are reused; no new secret).
4. Tenant operational mode must permit irreversible external execution.
5. An owner/admin authorises + verifies + enables a sender in
   Marketing Settings → Senders & Workspace, then an explicitly authorised
   REAL test send (a human decision, to a tenant-user recipient) completes the
   proof. Until then every capability entry stays **Preview**.

## Honest provider semantics

- Gmail `messages.send` has **no idempotency key**. Exactly-once is enforced on
  OUR side (deterministic intent idempotency + single-success unique index +
  unknown-freeze). A lost response or uncertain 5xx parks the intent as
  `unknown`, routes to human review, and is **never blindly resent** — a
  deterministic `Message-ID` (`<mkt-{delivery}@{sender-domain}>`) is stamped on
  the MIME for future manual reconciliation, but "not found in the mailbox" is
  NOT treated as proof of non-submission.
- "Submitted" means Gmail accepted the request. Nothing in Phase 4 claims
  delivery, opens or clicks.
- Gmail exposes no usable per-account sending quota through these APIs; the UI
  says **Not reported by provider** instead of inventing capacity.

## Verification runbook (local)

```bash
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_senders.test.sql
node --test scripts/marketing-senders-pure.test.mjs
node scripts/marketing-senders.test.mjs          # needs local stack + service key
node scripts/marketing-senders-http.test.mjs     # NOT-RUN/exit 3 without an edge runtime
bash scripts/intelligence-conformance.sh         # gates incl. (d)/(j) adapter contract
```
