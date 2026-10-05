# Sequence setup & operations (Marketing Phase 6)

What has to be TRUE in an environment before a governed Sequence can run —
and what is honestly NOT proven until it is. Locally, Phase 6 is proven with
the real SQL engine RPCs and STUBBED provider results: **no email of any kind
has ever been sent by this code.**

## The pipeline (one campaign identity, one transport, one authority)

```
draft → review → approve (owner/admin + marketing.campaigns.launch)
  → activation preflight (one-use digest-only challenge bound to the
    immutable revision) → ACTIVE
  → enrolment preflight (IMMUTABLE batch; every candidate recorded with an
    exact verdict) → confirmed enrolment (Person-based, revision-pinned,
    endpoint-pinned)
  → marketing.sequence_advance worker (bounded SKIP LOCKED leases; waits
    resolved in SQL; quiet-hour deferral; live eligibility recheck)
  → per step:
      send_email      → Action + Decision Package + approval-required intent
                        + append-only tenant_senior approval + frozen envelope
                        → the UNTOUCHED Automation Engine → the ONE Gmail
                        adapter (canonical send-authority recheck immediately
                        before the single provider call)
      wait_*          → a scheduling FACT persisted once; never worker work
      tag/lifecycle/
      owner/follow-up → the registered internal marketing.contact_action
                        capability → the marketing_actions adapter → the
                        EXISTING governed RPCs (no second write path)
  → canonical evidence → advance, hold, skip or exit
```

"Submitted" means Gmail accepted the request — never "delivered". Unknown
provider results freeze the step for review, block completion, and are never
retried blindly.

## Required deployment steps (in order)

1. **Database**: apply `supabase/migrations/20260903120000_marketing_sequences.sql`
   (after the committed Phase 0–5 chain). Run-once; additive.
2. **Functions**: deploy `marketing-sequences` and
   `marketing-sequence-scheduled-sync`, and REDEPLOY the shared worker bundle
   (`platform-worker` and every function embedding `_shared/worker_handlers`)
   so `marketing.sequence_advance`, the extended Gmail adapter and the new
   `marketing_actions` adapter exist at runtime.
3. **Public unsubscribe base URL**: `MARKETING_PUBLIC_BASE_URL` — the same
   secret Broadcasts uses. A sequence containing an email step **cannot be
   activated without it** (`CONFIG_REQUIRED` / MK428). No link is ever
   fabricated.
4. **Scheduler**: set `MARKETING_SEQUENCE_SECRET`, then re-run
   `select serviceos_schedule_all();` as an operator. Adding the schedule
   definition in the migration installs NOTHING by itself. The cron invokes
   `marketing-sequence-scheduled-sync` every minute with `x-schedule-secret`;
   it only discovers due work and enqueues platform jobs — it never sends.
5. **Sender authorisation**: unchanged Phase-4 requirements
   ([SENDER_SETUP.md](SENDER_SETUP.md)) — a verified, enabled sender with the
   `gmail.send` scope. A sequence with **no** email steps does not need one.
6. **Operational mode**: a profile permitting irreversible external work
   (`trusted` / `optimisation`). In lower modes intents park mode-blocked with
   the real reason — correct behaviour, not a bug.
7. **Explicit authorisation**: the first live activation and the first live
   enrolment are user decisions. Nothing here performs one implicitly.

## Step types

| Step                       | What it does                                                                                                                                                                                                   | Governed by                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `send_email`               | One governed email using the Phase-5 authored content model, allowlisted personalisation, explicit fallbacks and the same renderer (including its link-injection protection)                                   | `send_marketing_sequence_email` on `email.send_marketing`, approval-required                                                 |
| `wait_duration`            | Waits a bounded amount from the factual completion of the previous step                                                                                                                                        | Resolved in SQL, persisted once, immutable                                                                                   |
| `wait_until_window`        | Waits for the next tenant-local weekday/hour window                                                                                                                                                            | Same DST authority as Broadcasts: gaps move forward, folds (30/45/60/90/120 min) resolve by the revision's **stored** policy |
| `apply_tag` / `remove_tag` | Assigns/removes a canonical tag                                                                                                                                                                                | `marketing_tag_mutate` via `marketing.contact_action`                                                                        |
| `change_lifecycle`         | Moves the Person's lifecycle stage                                                                                                                                                                             | `marketing_classify_contact` via `marketing.contact_action`                                                                  |
| `assign_owner`             | Sets the relationship owner                                                                                                                                                                                    | `marketing_classify_contact` via `marketing.contact_action`                                                                  |
| `create_follow_up`         | Creates a real work item on the platform work spine. **Configuration required on this platform** — see below; the builder withholds it and the server refuses it until the platform can progress a core Action | `marketing_sequence_create_follow_up` via `marketing.contact_action`                                                         |

The first step may not be a wait: an enrolment must do something real.

## Enrolment

- **Person-based**, never an email string. A journey that sends email pins the
  Person's contact point at enrolment time, so a later change to their primary
  endpoint never silently moves a live enrolment to another address — and a
  sequence containing an email step cannot enrol a Person who has no usable
  email endpoint.
- **A journey that never sends email is not governed by email.** An internal-only
  sequence (tags, lifecycle, owner) enrols a Person with no email address at
  all, pins no endpoint, and is never excluded, skipped or exited for a sender,
  suppression or unsubscribe reason it could never encounter. Email
  preconditions apply to email steps, not to enrolments.
- **Revision-pinned.** Editing a sequence creates a NEW immutable revision;
  People already enrolled keep running the revision they entered on. There is
  no automatic migration, and the UI says so.
- **Preflight is the truth.** Every candidate is recorded once with an exact
  verdict; counts equal persisted rows; the batch is immutable and bound to a
  one-use confirmation.
- `marketing_settings.max_sequence_enrolments` (default 500, ceiling 10000)
  refuses a larger batch outright, before building anything.
- **Event-triggered enrolment is NOT installed.** No second event engine and no
  hidden poller exist. The surface labels it Preview.

## Editing a live sequence

An ACTIVE sequence refuses an in-place edit. Pause it first: that stops new
steps, leaves every enrolment pinned to its own revision, and makes the change
explicit. Revising then creates a new revision and returns the sequence to
draft for re-approval.

## Exits — evidence only

| Exit                                  | Evidence required                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsubscribed` / `hard_suppression`   | Canonical `marketing_endpoint_eligibility`. Always on; not configurable                                                                                                                                                                                                                                                   |
| `replied`                             | A canonical INBOUND `email_messages` row on the **provider thread** this enrolment actually sent, **received after that send** and **from the endpoint this enrolment addressed**. Never subject-text matching; an older message already on the thread, or a message from someone else on a reused thread, is not a reply |
| `lifecycle_outcome`                   | The Person's CURRENT active relationship reached the configured stage                                                                                                                                                                                                                                                     |
| `manual_removal`                      | An owner/admin action, recorded with actor and note                                                                                                                                                                                                                                                                       |
| `campaign_cancelled`                  | Cancelling the sequence exits every live enrolment                                                                                                                                                                                                                                                                        |
| `policy_blocked` / `endpoint_invalid` | The approved `policy_block_action` decides exit vs skip                                                                                                                                                                                                                                                                   |
| `hard_bounce`                         | **Never inferred.** This pipeline receives no provider bounce evidence, so bounce exits stay unproven rather than invented                                                                                                                                                                                                |

## Completion truth

A reusable sequence does **not** complete because its cohort emptied. There are
three distinct states:

- **open/active** — accepting enrolment;
- **closed** — an explicit operator act; no new enrolment, live work finishes;
- **completed** — derived only once the sequence is closed AND no enrolment or
  execution is still live.

## Operational health

`marketing_sequence_health` reports: due-now count, oldest due age, active and
expired leases, held enrolments, unknown executions, execution totals, recent
failure classes, and whether the internal capability and scheduler secret are
configured. Held enrolments and unknown executions are surfaced loudly in the
UI — they need a person, not a retry.

## What stays honestly unproven until a served environment exists

- Authenticated Edge HTTP contracts
  (`scripts/marketing-sequences-http.test.mjs` exits 3 NOT-RUN locally).
- The worker/scheduler runtime loop.
- Populated visual QA of the Sequences UI.
- Any real provider behaviour. Click tracking is NOT implemented; delivered,
  opened, clicked and bounced are reported as unavailable, never as zero.

## Follow-up steps: configuration required on this platform

A `create_follow_up` step creates a genuine canonical work item
(`intelligence_objects`, `object_class = 'action'`) plus its append-only
`object_state_history` seed — the same rows the Command Centre work projection
reads, so it really appears on the work list.

But the platform seeds `state_definitions` / `state_transitions` for
`('serviceos'|'productos','Action')` and **not** for `('core','Action')`, so
`work-transition` can derive no legal move for a core Action. Work created that
way could be seen but never started, completed or dismissed — permanent
undismissable clutter on a real person's list.

Rather than ship a control that manufactures unusable work, the step is gated on
that real configuration:

- `marketing_sequence_follow_up_available()` reads the platform's own
  `state_definitions` / `state_transitions` — it is never a hardcoded answer;
- `marketing_sequence_create` refuses a follow-up step with `CONFIG_REQUIRED`
  (MK428) and a message naming the exact blocker;
- the canonical work-item RPC — the layer that actually mints the Action —
  refuses too, and writes nothing while refusing, so no future caller inside or
  outside Marketing can reach the seam and create unprogressable work;
- the adapter treats that refusal as **permanent**: a configuration fact is
  never retried and never reported as a transient failure;
- the Sequences builder does not offer the step type, and the surface explains
  why in plain language.

The moment the platform registers transitions for `('core','Action')`, the gate
opens and the step becomes available **with no Marketing change**. No
Marketing-specific transition engine was introduced, and the existing core
Actions that Phase 4 and Phase 5 already create are unaffected by this gate.
