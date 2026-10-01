# Service OS delivery journey

Chris's direction, 1 October 2026. This is the current delivery order. Older
roadmap Live labels are historical claims, not fresh acceptance evidence.

## Product rule

Help the company grow and improve sustainable net profit. Each module must show
evidence, a useful action, an accountable owner and a measured outcome. Quality,
safety and customer commitments constrain growth and profit; they are not things
to sacrifice for a higher score.

Reuse the existing identity, interactions, business graph, cards, objectives,
measurements, outcomes, recommendations, approvals and automation engines. One
person identity can have engineer and office roles. Contractor companies and their
individual operatives remain separate. No second platform or parallel queue.

## Journey and acceptance gates

| Stage | What we deliver | What proves it works |
|---|---|---|
| 0. Reliable information | Phone/email ingestion, source health, recovery and freshness | Fresh events traced from source to evidence to authorised cards. Failed recordings cannot monopolise processing. Backlog cleared or visibly classified. Normal-flow latency observed over a working day. |
| 1. Connected business | Commusoft, QuickBooks, approved Slack channels and New Dawn sheets | Read-only imports first. Stable IDs, reconciliation totals, correction/deletion handling, replay and tenant-isolation tests. Unsupported data explicitly identified. |
| 2. Cash and cost control | Invoice/customer cards, commercial sign-offs, approved chasing and overhead review | One invoice and payment reconcile across sources. Paid/disputed invoices cannot be chased. Actions are approved, deduplicated and outcomes verified. No autonomous payments or cancellations. |
| 3. Work and capacity | Job/engineer/team cards, six-week capacity, accepted-unscheduled work and blockers | Real jobs, visits and assignments reconcile. Leave, skills, parts, travel and dependencies explain gaps. Resolving a blocker updates the card. Reuse the quote tracker and 48-hour clock. |
| 4. Job profitability | Cost completeness, contribution, margin exceptions and WIP | Estimated versus actual costs are visible. Finance agrees labour, overhead and WIP definitions. Field GP is not mixed with accounts net profit. |
| 5. Renewals and growth | PPM contracts, servicing, renewals and commercial opportunities | A real renewal progresses through owned follow-up to a recorded result. Opt-out, approval and deduplication work; value is not counted twice. |
| 6. Personal command centre | My actions, dependencies, progress and corrections | Role-appropriate access; evidence behind each measure; blocked work explains dependencies instead of blaming its assignee. No fabricated aggregate scores. |
| 7. Repeatable product | Tenant setup, configuration, acceptance pack and managed care | Second test tenant works without client-specific code. Cross-tenant access fails. Restore and rollback proven. Costs and operator workload measured. |

The MD overview grows with each stage. Product OS shares the core later; it is not
a second application to build concurrently. No promised dates until dependencies
and actual connector coverage have been checked.

## Scorecard contract

Every measure carries: tenant, subject, objective, owner, unit, formula, numerator
and denominator where relevant, target, direction, period, source IDs, freshness,
coverage, exclusions, definition version, evidence, dependencies, next action,
outcome and correction history. Extend existing objectives/measurements before
adding competing score tables.

- Separate business performance, data confidence and system health.
- Missing/stale data is unassessed, not zero and not green.
- 90% means a named measure, not a universal judgement of a person.
- Show raw measures before weighted totals; AI cannot invent weights.
- Compare like roles and work mix. Account for leave, training, shared work,
  difficult jobs, equipment and dependencies outside the person's control.
- Balance output with quality, safe working, rework and customer outcomes.
- People can inspect and challenge evidence. No public shame leaderboard, inferred
  personality/emotion scoring or automatic employment decision.
- No automatic pay changes in the first release. A later bonus model needs agreed
  measures, appropriate review and staff agreement before activation.
- Cash collection is not new revenue or necessarily new profit. Keep those distinct.

The personal view has four sections: **Your next actions**, **What you are waiting
for**, **Your progress**, **What OpenFolk handled**. Nudges need a reason, recipient,
cooldown and history. Uncertain ownership goes to review, not automatic blame.

## Data and autonomy boundaries

Ingest authorised business sources, not indiscriminately all personal messages.
Require tenant-specific mailbox/channel allowlists, notices, permissions, retention
and deletion handling. Meetings need an agreed purpose and appropriate participant
notice. No blanket Slack DM/private-channel or HR-mailbox capture. Source content
is evidence, never authority to run tools or change policy.

Observe → recommend → approved action → verified provider read-back → measured
outcome → narrowly delegated automation. Safe reversible repairs can operate within
policy. Spending, customer messages, staffing, pay and contracts have separate
approval boundaries. Every external write is audited and has a recovery plan.

## Reuse and gaps found

- GitHub: Drummasterflash83/serviceos-dh. Main deploys frontend through Vercel;
  Supabase functions and migrations deploy separately.
- Earlier work preserved: identity, graph, interactions, objectives/outcomes,
  queue, decision/automation engines and card designs. Some engineer/card screens
  still contain demo content; do not call these live scorecards.
- No named Commusoft/QuickBooks Edge adapter found in current function inventory.
  Universal-import foundations and mapping docs exist. Provider access and live
  coverage remain to be verified. Slack notification delivery is not Slack ingestion.
- New Dawn evidence from 22 September contains targets/owners, mixed GP bases,
  missing quote values and a labour allocation issue. Revalidate before scoring.
- 1 October production check: four recordings each failed transcription 70 times
  in 24 hours. The live oldest-first selector ignores per-recording failure history.
  Old docs claiming permanent failures are excluded do not match that implementation.

## Engineering and release workflow

Isolated branch → focused tests → typecheck/build where affected → PR → preview →
narrow backend deployment → production read-back → acceptance evidence. Do not
blindly apply pending migrations. Reconcile source, deployed functions and migration
history. GitHub backs up code, not database/storage; check backup retention and a
restore test separately. Keep secrets and customer payloads out of Git.

The separate **Ai Emma Launch** chat owns launch, main-number routing and assistant
configuration. This branch owns core reliability and product foundations. Avoid
those launch files and provider settings here.

## First build increment

1. Classify transcription errors safely, without logging provider prose or secrets.
2. Bound per-recording retries; preserve failed recordings visibly for review;
   protect fresh flow while retaining a bounded historical lane.
3. Prove new call/email progression and identify actual missing mailbox coverage.
4. Clear historical data in measured batches within an agreed spend ceiling.
5. Verify Commusoft/QuickBooks read access and New Dawn definitions; start the
   invoice/customer data slice before building more reporting screens.

Pending decisions: backfill spend ceiling, scorecard-first versus bonus modelling,
and confirmation that the existing New Dawn targets remain authoritative. Defaults:
no bulk paid backfill, no pay changes, targets treated as draft until revalidated.
Existing OpenFolk API key reuse approved on 1 October.
