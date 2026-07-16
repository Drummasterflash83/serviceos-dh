# Live Call Card v1

The first real-time operational surface: when an inbound call rings on a VoIP
extension, ServiceOS surfaces a live card to **only** the logged-in user mapped to
that extension (Mary → ext 102). v1 is safe + evidence-only — no CRM merge, no fake
match.

## Data model (migration `20260709130000_live_call_card.sql`)

- **user_voice_endpoints** — user ↔ extension mapping (Mary → 102).
- **live_call_events** — every raw normalised webhook event (audit/replay).
- **live_call_sessions** — one row per live call, `assigned_user_id`, evidence-led
  `match_status`, and a provider-agnostic `context` model (below).

RLS is tenant-scoped SELECT; per-user visibility is applied by the frontend query
(`assigned_user_id = current user`). Writes are the secret-gated webhook +
service-role management functions only.

## Webhook (`simwood-call-webhook`)

Sipcentric's push payload shape isn't documented in-repo, so the receiver is
**flexible** — it accepts many field-name variants and normalises them. Auth is a
required secret header (`x-simwood-webhook-secret` == `SIMWOOD_WEBHOOK_SECRET`); no
user JWT; no unauthenticated writes. Tenant is resolved server-side from connector
config (payload `customer_id` → `connector_accounts`, else the single enabled
Simwood tenant. Missing, unknown, or ambiguous provider identity is quarantined; there is
no default tenant and tenant identity is never trusted from the body).

**Normalised fields (accepted key variants):**

| Field              | Accepted keys                                            |
| ------------------ | -------------------------------------------------------- |
| `provider_call_id` | `provider_call_id`, `call_id`, `callId`, `linkedId`, `id` |
| `event_type`       | `event_type`, `event`, `status`, `state`                 |
| `caller_number`    | `caller_number`, `from`, `caller`, `cli`, `source`       |
| `callee_number`    | `callee_number`, `to`, `callee`, `destination`, `did`    |
| `extension`        | `extension`, `ext`, `endpoint`, `agent`                  |
| `occurred_at`      | `occurred_at`, `timestamp`, `time`, `created`, `callStarted` |
| `customer_id`      | `customer_id`, `customerId`, `account`, `account_id`     |

`event_type` normalises to: `initiated | ringing | answered | completed | missed |
failed`.

### §12 Test — simulate an inbound call

```bash
curl -X POST "$SUPABASE_URL/functions/v1/simwood-call-webhook" \
  -H "x-simwood-webhook-secret: $SIMWOOD_WEBHOOK_SECRET" \
  -H "content-type: application/json" \
  -d '{"call_id":"test-123","event":"ringing","from":"+447700900123","to":"01892500000","extension":"102"}'
```

Then send `{"call_id":"test-123","event":"answered",...}` and `"completed"` to walk
the session through its lifecycle. With Mary mapped to ext 102, the card appears for
Mary only.

## §5 Matching (evidence-led; no silent merge)

Allowed now: exact caller-number history in `phone_calls` (from/to), exact match in
`interactions` (phone_from/phone_to), and exact `people.primary_phone` (may be empty
in v1). Levels:

- `likely` (70%) — exact phone match to a known **person** record.
- `possible` (40%) — known number (prior calls/interactions) but no person yet.
- `unmatched` (0%) — no history.
- `confirmed` / `rejected` — **only** set by an explicit user action on the card.

The `evidence` array records what was used (e.g. "3 previous calls from this
number"). No people/company/job is invented.

## Provider-agnostic context (Commusoft-ready — not built yet)

`live_call_sessions.context` holds the generic model future job systems fill:

```json
{ "related_jobs": [], "related_sites": [], "related_assets": [],
  "related_tasks": [], "related_notes": [], "related_documents": [],
  "related_financials": [] }
```

Commusoft will later populate open jobs, previous jobs, job number, assigned
engineer, site address, customer notes, parts/materials, job status, appointment
time, and invoice/quote status — **through this generic shape**, never hardcoded into
the card.

## §11 Interactions linkage (TODO)

When a live call completes, the canonical `interactions`/`phone_calls` row for the
same `provider_call_id` catches up on the next sync. TODO: link
`live_call_sessions.provider_call_id → phone_calls → interactions` (and set
`matched_*` when the enrichment/matcher phase lands).

## Required secrets / crons

- `SIMWOOD_WEBHOOK_SECRET` — set, and point the Sipcentric webhook at
  `…/functions/v1/simwood-call-webhook` with the header.

---

# Future: Workflow Intelligence / Process Mining (documented placeholder only)

**Not built now. No screen watching, no browser extension, no screenshots, no
sensitive-data capture in this phase.**

OpenFolk should eventually observe browser-based workflows across tools (Commusoft,
Google Drive, Perplexity, supplier portals, accounting tools, CRMs, internal
systems) to: identify repetitive manual processes, detect copy/paste workflows,
discover automation opportunities, reduce admin time, improve response speed, and
increase profit through process efficiency.

Future module name: **`workflow_intelligence`** (a.k.a. `process_mining`). This note
is the architectural placeholder only — no implementation, no data capture.
