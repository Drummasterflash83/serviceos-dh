> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Interactions, Identity, Cards & Recommendations](../reference/INTERACTIONS_IDENTITY_CARDS.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# Signal Processing & Customer Cards — Foundation v1

Status: **foundation only** — data model + readers + scheduler + docs. No CRM
logic, no AI matching, no fake data. This document is the plan the later
enrichment/AI phases implement against.

## 1. Core concept

The platform no longer just *syncs records* — it turns every new record into an
**operational signal** that, over time, builds cleaner customer / company / job /
task cards. A signal may be a phone call, email, Slack/Teams message, website
form, WhatsApp message, Commusoft/job note, invoice/payment event, or product/
order event. (Only phone + email exist today; the model is source-agnostic.)

## 2. Signal = canonical interaction

A signal **is** a row in `interactions` (Canonical Interactions v1). Each signal:

1. exists in `interactions` (idempotent upsert from the source table),
2. names its `source_connector_id` + `interaction_type`,
3. carries extractable structured facts (subject/summary/body_preview/addresses…),
4. tracks `processing_status` (`pending` → `analysed`),
5. is produced under a `platform_jobs` run (`interactions.sync`),
6. is exposed as backlog (unprocessed = `processing_status = 'pending'`).

Future sources (Slack/forms/WhatsApp) add a projector into `interactions`; nothing
downstream changes.

## 3. Data model (this migration)

`20260709120000_customer_cards_foundation.sql` adds (additive, RLS SELECT-only,
service-role writes):

- **companies** — organisations (name, domain, phone, address).
- **people** — individuals (name, primary_email, primary_phone, company_id, address).
- **customer_cards** — the daily "what needs attention" card.
- **interaction_match_suggestions** — evidence-led link proposals.

`interactions` already carries the link columns (`related_person_id`,
`related_company_id`, `related_job_id`, `related_task_id`) and `priority` — this
migration provides their targets. **Nothing is populated yet.**

## 4. Matching discipline (evidence-led)

Matching links signals into one customer/company/job/card journey **only with
enough evidence**, and **never silently merges** on weak AI evidence.

**Allowed evidence:** exact email, exact phone, explicit external id, explicit
user link, shared address, shared job number, shared invoice/quote number, shared
product/part reference, repeated names, company name, conversation context,
timing/proximity, similar issue description, same location, AI semantic similarity.

**Levels:** `confirmed` | `likely` | `possible` | `rejected`.

**Rules:**
- `confirmed` → may auto-link **only** when evidence is strong.
- `likely` → suggested to the user.
- `possible` → suggestion only.
- `rejected` → never re-suggested unless **new** evidence appears.

Every AI/heuristic match written to `interaction_match_suggestions` must include a
**confidence score**, the **evidence used**, an **explanation**, the **source
interaction(s)**, and a **recommended action**.

## 5. Cards architecture

`customer_cards` is the future daily work surface. Columns support: `status`
(traffic-light `grey|green|amber|red`), `priority` (queue), `owner_id`, `due_at`,
`latest_activity_at`, `recommended_action`, `context`, `completed_at`. Later card
types (jobs, engineers, team members, tasks, opportunities, risks, bottlenecks)
reuse the same shape or sibling tables.

## 6. Priority queue model (documented; scoring is future work)

`priority`: `critical` | `high` | `medium` | `low` | `waiting` | `done`.

The eventual "what do I deal with first?" score is derived from: urgency, customer
risk, time since last response, missed calls, unresolved emails, job deadlines,
financial value, SLA, and AI confidence. **Not scored yet** — the enum + column
exist so the queue can be computed later without a migration.

## 7. Processing cadence (automatic by default)

Phone/email should feel near real-time. Scheduled functions + expected intervals:

| Function                                   | Expected cadence | Trigger                     |
| ------------------------------------------ | ---------------- | --------------------------- |
| `phone-scheduled-sync`                     | ~5 min           | `PHONE_SCHEDULE_SECRET`     |
| `phone-processing-scheduled-sync`          | ~10 min          | `PHONE_PROCESSING_SECRET`   |
| `email-scheduled-sync`                     | ~5 min           | `EMAIL_SCHEDULE_SECRET`     |
| `email-workspace-scheduled-sync`           | ~5 min           | `EMAIL_WORKSPACE_SCHEDULE_SECRET` |
| `email-workspace-backfill-scheduled-sync`  | ~15 min          | `EMAIL_WORKSPACE_BACKFILL_SECRET` |
| `interactions-scheduled-sync` (signals)    | ~10 min          | `SIGNAL_SYNC_SECRET`        |

Each is secret-gated, service-role, tenant-aware, and continues past failures. To
make processing automatic, configure the secret + a cron for each. **Scheduler
health** (last run + freshness per function) is visible in the Operations Centre —
`never` there means the cron isn't configured yet.

Manual buttons (**Process pending now**, **Build timeline**, **Sync now**) are
**recovery/overrides only** — normal operation is scheduled/automatic.

## 8/9. Phone & email as signal implementations

Phone (calls → recordings → download → transcribe → analyse → interactions) and
email (sync → interactions → future extraction) are the first two signal
implementations, not a phone-only or email-only system. Email AI extraction and
person/company linking are prepared (columns + suggestion table) but not built.

## TODO (next phases)

- Signal enrichment worker: extract structured facts, set `processing_status`.
- Evidence matcher: write `interaction_match_suggestions` (with the §4 contract).
- Auto-linker: apply `confirmed` strong-evidence matches to `related_*` columns.
- Card builder: create/update `customer_cards` from linked signals.
- Priority scorer: compute the queue from the §6 inputs.
- Card UI: the daily work surface (priority queue, traffic lights, actions).
