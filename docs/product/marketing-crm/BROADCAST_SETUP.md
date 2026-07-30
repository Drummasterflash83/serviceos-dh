# Broadcast setup & deployment (Marketing Phase 5)

What has to be TRUE in an environment before a real broadcast can be sent —
and what is honestly NOT proven until it is. Locally, Phase 5 is proven with
the real SQL engine RPCs and STUBBED provider results: **no email of any kind
has ever been sent by this code.**

## The pipeline (one transport, one authority)

```
draft → review → approve (owner/admin + marketing.campaigns.launch)
  → preflight (IMMUTABLE audience snapshot; every candidate recorded with
    exact inclusion/exclusion evidence; one-use launch challenge)
  → launch now | schedule (tenant IANA timezone; DST gaps rejected,
    ambiguous times need an explicit fold)
  → marketing.broadcast_dispatch worker (bounded SKIP LOCKED leases,
    quiet-hours deferral, eligibility recheck)
  → per recipient: Action + Decision Package + approval-required intent +
    append-only tenant_senior approval + frozen envelope
  → the UNTOUCHED Automation Engine → the ONE Gmail Marketing adapter
    (canonical send-authority recheck immediately before the single
    provider call; multipart MIME with one-click unsubscribe)
  → marketing.delivery_sync reconciler → canonical email_messages +
    Interaction (structural campaign/person linkage) → factual reporting
```

"Submitted" means Gmail accepted the request — never "delivered". Unknown
provider results freeze the recipient for review, block campaign completion,
and are never retried blindly.

## Required deployment steps (in order)

1. **Database**: apply `supabase/migrations/20260902120000_marketing_broadcasts.sql`
   (after the committed Phase 0–4 chain). Run-once; additive.
2. **Functions**: deploy `marketing-campaigns`, `marketing-unsubscribe`,
   `marketing-broadcast-scheduled-sync`, and REDEPLOY the shared worker
   bundle (`platform-worker` and every function embedding
   `_shared/worker_handlers`) so `marketing.broadcast_dispatch` and the
   extended adapter/reconciler exist at runtime.
3. **Public unsubscribe base URL**: set the Edge secret
   `MARKETING_PUBLIC_BASE_URL` to the public origin+path that serves the
   functions, e.g. `https://<project-ref>.supabase.co/functions/v1`.
   The unsubscribe link is `<base>/marketing-unsubscribe?t=<token>`.
   Preflight/launch fail honestly (`CONFIG_REQUIRED` / MK428) without it —
   no fabricated links, ever.
4. **Scheduler**: set `MARKETING_BROADCAST_SECRET`, then re-run
   `select serviceos_schedule_all();` as an operator. Adding the schedule
   definition in the migration installs NOTHING by itself. The cron invokes
   `marketing-broadcast-scheduled-sync` every minute with
   `x-schedule-secret`; it only discovers due campaigns and enqueues
   platform jobs — it never sends email.
5. **Sender authorisation**: unchanged Phase-4 requirements
   ([SENDER_SETUP.md](SENDER_SETUP.md)) — Gmail `gmail.send` re-consent or
   the Workspace DWD grant, a verified + enabled sender.
6. **Operational mode**: an operating profile permitting irreversible
   external work (`trusted` / `optimisation`). In lower modes intents park
   mode-blocked with the real reason — correct behaviour, not a bug.
7. **Explicit authorisation**: the first live test send and the first live
   broadcast are user decisions, made per send. Nothing in this repo
   performs one implicitly.

## Guardrails you may want to tune per tenant

- `marketing_settings.max_bulk_recipients` (default 500, hard ceiling
  10000): preflight refuses larger audiences outright, before building
  anything. Preflight is a single set-based transaction: measured locally at
  ~0.04s for 500 candidates and ~0.8s at the 10000 ceiling.
- `marketing_settings.quiet_hours_start/end` + `timezone`: dispatch
  preparation defers inside the window; the scheduler resumes it after.

## Pause, resume and cancel semantics

- **Pause** stops new preparation immediately and the canonical send
  authority refuses the campaign pre-provider. A provider call already in
  flight may still finish — there is no recall.
- **Resume** of a campaign paused *before* its scheduled instant returns it
  to `scheduled`, so the schedule is never brought forward; the scheduler
  activates it at its own time. A campaign paused after activation resumes
  into active dispatch and never re-sends a submitted or unknown recipient.
- **Cancel** ends pending dispatches outright and cancels only still-pending
  intents through the engine's legal transition. A recipient leased by a
  worker at cancellation time is recorded `cancelled`, never left reported
  as pending work that can no longer happen.

## Recovery you should know about

The dispatch worker owns a bounded recovery sweep for the one crash window
the claim query cannot see: a recipient whose governed lineage committed but
whose execution job was lost. The scheduler's tenant scan therefore covers
`pending` **and** `queued` dispatches on active campaigns. Recovery is
re-enqueue only — idempotent at the job key and at the engine's claim RPC,
so it can never produce a second send.

## What stays honestly unproven until a served environment exists

- Authenticated Edge HTTP contracts (`scripts/marketing-broadcasts-http.test.mjs`
  exits 3 NOT-RUN locally).
- The worker/scheduler runtime loop and the public unsubscribe endpoint.
- Populated visual QA of the Broadcasts UI.
- Any real provider behaviour. Click tracking is NOT implemented at all —
  reporting shows clicks as unavailable, never zero, and no URL is rewritten.
