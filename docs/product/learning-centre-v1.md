# Learning Centre V1 — OpenFolk operator specification

**Status:** product specification (V1). No implementation, no ingestion, no deploy in this
document. Architecture target: **[architecture/06_LEARNING_CENTRE.md](../architecture/06_LEARNING_CENTRE.md)**.
Master index: **[MASTER-SERVICEOS-SPEC.md](../MASTER-SERVICEOS-SPEC.md)**.

The Learning Centre is the OpenFolk **operator** view answering one question:

> **"What is happening across this company, what is moving, what is waiting, why is it waiting,
> who owns it, and where can OpenFolk create value?"**

**V1 leads with factual operational queues and drill-downs — not speculative Health scores.**
Every figure is clickable and traceable to the underlying evidence. Where evidence is missing or
uncertain, V1 shows an **honest unknown**, never a fabricated number.

---

## 1. What V1 must show

### A. Source & ingestion truth (honest, code-real)
- **Source connection status** per source — *Live · Foundation · Planned · Aspirational* (a source
  is "Live" only when a real pipeline is producing interactions; see the audit below).
- **Ingestion coverage & freshness** — latest record time per source, sync cadence, and whether
  scheduling is enabled or manual.
- **Records received / processed / failed** — raw counts, projected-to-interactions counts, and
  failures/unprocessed, per source and window.
- **Identity-mapping coverage** — % of endpoints (extensions/DDIs/mailboxes/Slack users) confirmed
  to a canonical team member; the unmapped remainder is a queue, not a hidden gap.

### B. Company-wide operational queues (the heart of V1)
Factual, evidence-backed queues over the canonical work (`intelligence_objects` Actions/Observations,
`recommendations`, and — once ingested — Commusoft jobs/quotes/invoices). Each queue row is
clickable to its evidence. Examples that V1 targets:

- jobs **waiting for parts**;
- quotes **waiting to be issued**;
- customers who have **chased repeatedly**;
- jobs **waiting for engineer paperwork** (completion evidence missing);
- **completed jobs not ready to invoice**;
- **overdue commitments**;
- **unowned work** (no accountable owner);
- **average elapsed time vs the tenant's target** per queue.

### C. Waiting, owners and blockers
- **Waiting relationships** — who/what each item is waiting on, in both directions.
- **Owners & blockers** — the accountable owner (or "unowned"), and the blocker where present.
- **Age vs target** — elapsed time against the tenant's configured target for that queue.

### D. Impact
- **Customer impact** — which customers are affected by a queue/bottleneck.
- **North Star impact** — how a queue relates to the tenant's Objectives (e.g. invoice-readiness →
  cash / ARR; repeated chases → retention/margin). Honest "not yet measurable" where unlinked.

### E. Drill-down
Every figure drills into the underlying **customer, site, job, quote, communication, or person**,
and from there to the **raw evidence** (the interaction/record) with provenance and confidence.

### F. Learning & opportunity
- **Patterns & repeated failure** — recurring stalls/exceptions (workflow reconstruction).
- **Automation & AI-agent opportunities** — recurring, well-understood, low-risk steps done by
  hand (candidates are *proposals*, governed; the highest optimisation may be *elimination*).

### G. Trust & control
- **Confidence, provenance, honest unknowns** on every figure and row.
- **Operator control** over what is later shared with customers and staff (nothing is shared by
  default; sharing is an explicit, governed operator decision).

**Non-goals (V1):** no customer/entity Health *scores*, no prioritisation/notification logic, no
intervention taxonomy — those await the Health V1 brief. No fabricated activity.

---

## 2. Source Truth Audit (read-only, 2026-07-25, prod `tgbnakbxwcqjeimygroz`)

The Learning Centre must reflect *code reality*. This audit establishes it. **Re-run before each
material milestone** (it is the input to the master spec §12 update).

| Source | Connection state | Latest evidence | Coverage | Identity mapping | Processing capability | Known gaps | Action required |
|---|---|---|---|---|---|---|---|
| **Telephony** (Simwood / Sipcentric) | **Live in prod** (code ships dormant; operator-enabled). Connection `sipcentric` status=manual, verified | latest call **24 Jul 16:17**; 850 calls; 6,240 sync runs | inbound **447** + outbound **403**; 575 recordings + 575 transcripts (all completed) + 575 AI insights | **0 confirmed** ext/DDI → member links; 0 phone `communication_endpoints` in prod (discovery not deployed) | transcribe+analyse auto on new recording; `call_directions` extension/transfer/pickup fields **all empty** | no per-person telephony mapping; transfers/pickups not captured in `call_directions` (labels only) | deploy telephony discovery; operator-confirm extensions |
| **Email** (Gmail / Google Workspace) | **Live & fresh in prod** (queue-driven) | latest received **today 07:08**; 3,812 messages; 13,236 sync runs | inbound **556** + outbound **444**; 2,884 threads; 40 mailboxes (30 active, 10 pending) | **1 confirmed** (Heidi); Mary's mailbox discovered, unconfirmed | projected to interactions; **attachments = 0**, **email AI insights = 0** | attachments not captured; no email classification; identity coverage thin | confirm mailbox→member links; capture attachments (later) |
| **Commusoft** | **Importer built, never run** | 0 data_imports; jobs = 0 | seeded profiles: "Commusoft Customers / Jobs / Staff"; manual preview→apply importer (`data-import`) | n/a (not ingested) | preview never writes canonical; apply (owner/admin) writes `people`/`companies`/`jobs` + provenance | never executed; no bounded/scheduled path | approve the bounded MVP import (below) |
| **Slack** | **Not connected** | none | none | none | pure adapter + review resolver + design only; **no `discover.slack`, no OAuth, no worker** | not built beyond design | approve Workspace-Discovery OAuth (separate brief) |

Canonical pipeline (shared): **4,674 interactions → 3,156 intelligence_objects** (Observations/
Actions, 968/1000 with deadlines, object-level ownership on 3,154) **→ 11,480 graph nodes, 1,176
customer_cards, 516 companies; 4,106 recommendations.** `waiting_on_ref` populated on **0** rows;
`responsibility_handoffs` = **0**. Health tables = 0 (inert).

**Reading:** the loop's spine already exists and is populated. V1 can render real queues from
existing evidence today; the honest gaps are *waiting/handoff derivation*, *identity coverage*,
*Commusoft operational entities*, and the operator view itself.

---

## 3. Unified provider-neutral evidence model

The Learning Centre reads one **evidence projection** — a provider-neutral view over the canonical
tables (not a new source of truth; a read model assembled from `interactions`,
`intelligence_objects`, `graph_*`, `customer_cards`, ownership, and — once ingested — Commusoft
entities). Every operational evidence record must support:

| Field | Source of truth today | Notes |
|---|---|---|
| `tenant_id` | all canonical tables | tenant-scoped, RLS |
| `provider` / `source` | `interactions.source_connector_id` / `source_type` | phone / email / (chat) / import |
| `source_record_id` | `interactions.source_id` / `source_external_id` | idempotency key |
| `evidence_type` | `intelligence_objects.object_type` (+ interaction_type) | Observation, Action, Call, Email, Job, Quote, … |
| `occurred_at` | `interactions.occurred_at` | when it happened |
| `ingested_at` | `interactions.created_at` | when we recorded it (freshness) |
| `canonical_people[]` | `graph` / `related_person_id` / participants | confirmed vs candidate distinguished |
| `customer` | `related_company_id` / `customer_cards` | may be unresolved |
| `contact` | `people` / participants | |
| `site` | **gap** (Commusoft `Properties` not ingested) | resolved once Commusoft imported |
| `job` | **gap** (Commusoft `Jobs`) / job-number references | inference vs confirmed truth distinguished |
| `quote` | **gap** (Commusoft `Estimates`) | |
| `invoice` (where relevant) | **gap** (Commusoft `CustomerInvoices`) | |
| `current_owner` | `ownership_assignments` / `endpoint_ownership_assignments` | or "unowned" |
| `waiting_relationship` | **gap** (`waiting_on_ref` unpopulated) | V1 derivation stage |
| `provenance` | `evidence` jsonb / `source_*` / adapter | where it came from |
| `confidence` | `confidence` / `ambiguity` columns | numeric or high/med/low/unknown |
| `processing_state` | `interactions.processing_status`, `intelligence_ingestions.status` | received / processed / failed |
| `raw_source_reference` | `source_table` + `source_id` | link back to the raw record |
| `deletion_state` | soft-delete flags; Commusoft `Deleted` tombstone | never hard-lose evidence |

**Principle:** the model distinguishes **communication-derived inference** from **confirmed
operational truth** (Commusoft), and **confirmed** identities from **candidates**. Unconfirmed
evidence is shown as such, never silently promoted.

---

## 4. Four-stage local implementation plan

1. **Source truth & freshness** — a read-only projection + operator panel of the audit above
   (connection state, freshness, received/processed/failed, identity coverage), computed live from
   the canonical tables. Repeatable (re-runs the audit). *No writes.*
2. **Unified evidence projection** — the provider-neutral read model (§3) as a pure projection over
   existing canonical data, with the **waiting-relationship derivation** added (from transfers,
   email threads, and `intelligence_objects`), filling the biggest gap. Tested against fixtures +
   a bounded read-only slice of real data.
3. **Learning Centre overview & drill-down** — the operator UI: company-wide factual queues
   (§1.B), owners/blockers/age-vs-target, impact, and full drill-down to evidence. Reuses
   `openfolk-ui` primitives; honest empty/unknown states.
4. **Real Drummonds bounded proof** — point the Learning Centre at a bounded real-data window and
   demonstrate genuine queues (e.g. overdue commitments, unowned work, quotes awaiting issue) that
   trace to real evidence — masked, read-only, no production writes.

Each stage is local-first, tested, and paused before any deploy or production write.

---

## 5. Commusoft minimum bounded import (proposal — do not run without approval)

The manual importer (`data-import`, preview→apply) already exists. The minimum set for the first
Learning Centre (operational spine behind the queues):

`Properties` (customers + sites) · `Contacts` (+ emails/phones) · `Users` (**strict allowlist** —
never passwords/salts/security-Q&A/NI/ID-card/rates) · `Jobs` · `Diaries` (appointments) ·
`Estimates` + `EstimateOptions` · `ServiceReminderInstances` · `CustomerInvoices` +
`CustomerPayments`.

**Idempotent path:** upsert by **`UUID`** (stable source key), detect change via
**`LastModifiedDateTime`** (watermark), honour **`Deleted`** (tombstone). FK-safe order and PII
handling per **[architecture/canonical-entity-and-health-map.md](../architecture/canonical-entity-and-health-map.md)**
§11. Batch from the weekly Google-Drive ZIP; the REST API is only needed for intra-day freshness
later. **Not to be ingested without explicit approval.**

---

## 6. Directory ownership & capability extension (data + UI requirements)

To let an operator fully define an actor, the Directory / Person Intelligence Hub must capture,
per canonical actor:

| Attribute | Data home (existing vs gap) |
|---|---|
| primary & secondary roles | `team_members.formal_role` (single) → **gap:** secondary roles / role list |
| responsibilities | `responsibility_assignments` (RACI kinds) — **exists**, not surfaced in the Hub |
| processes owned | **gap** — no "process/workflow ownership" model (relates to workflow reconstruction) |
| email identities | `member_integration_identities` (google_workspace) — **exists** |
| extensions & DDIs | `member_integration_identities` (ext) + `communication_endpoints` — **exists** (discovery not deployed) |
| Slack identity | `member_integration_identities` (slack) — **model exists**, not connected |
| Commusoft identity | `member_integration_identities` (commusoft enum) — **exists as enum**, no import link |
| capabilities / skills | **gap** — no capability/skill model (Commusoft `Skills` maps here later) |
| approvals (authority) | `authority_grants` / `authority_permissions` — **exists**, not surfaced per-actor |
| cover responsibilities | `endpoint_ownership_assignments` (assignment_role=cover) + `responsibility_assignments.cover_for` — **exists** |
| escalation paths | `endpoint_ownership_assignments` (assignment_role=escalation) — **exists** |
| historical ownership | `endpoint_ownership_assignments` effective-dated history — **exists** (shown in Hub timeline) |

**UI requirement:** the Person Intelligence Hub gains an operator-editable "Roles &
responsibilities" section surfacing/authoring the above, with confidence + provenance + effective
dates, governed writes, and audit — reusing the confirm/reject pattern. **Semantic gaps to close
later:** secondary-role list, process/workflow ownership, and a capability/skill model. *Do not
build yet — this section defines the requirement and the existing-vs-gap map.*

---

## 7. Traceability & honesty (non-negotiable)

Every number in the Learning Centre answers "where did this come from?" and links to its evidence.
A queue that cannot be traced to evidence is not shown. A source that is not genuinely ingesting is
never shown as "connected". Confidence and provenance accompany every figure; unknowns are shown as
unknown. This is the [frontend principle](../architecture/10_FRONTEND_PRINCIPLES.md) that the
Learning Centre exists to honour at company scale.
