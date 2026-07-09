# ServiceOS — Recommendation Engine

**Status:** v1 landed — deterministic, rule-based. No AI, no automation.

**Last updated:** 2026-07-09

---

## What it is

The Recommendation Engine turns real **customer-card + interaction state** into
specific, explainable **next-actions**. It is the bridge in the platform flow:

```
Business Graph → Customer Cards → Recommendations → My Day → (future) Automations
```

A recommendation is not a generic alert. Each one answers:

- **What happened?** — `title`
- **Why does it matter?** — `detail` (explanation)
- **Who should act / what to do?** — `recommended_action`
- **What happens if ignored?** — `impact`
- **On what evidence?** — `evidence[]` (structured, no content)
- **How urgent / when?** — `severity` (priority) + `due_at`
- plus `type`, `confidence`, `status`, related `card_id` / `interaction_id`.

## Why no AI yet

v1 is **deterministic and rule-based** on purpose: rules are explainable,
testable, cheap, and predictable — you can always say exactly why a
recommendation exists. AI ranking/generation can layer on later _behind the same
table and API_, once the deterministic base and the surfaces that consume it are
proven. No model, no prompt, no fabrication.

## The rules (v1)

All rules run per customer card, reading its projection + a recent interaction
window. Rules are pure functions in
[`_shared/recommendations.ts`](../supabase/functions/_shared/recommendations.ts).

| Rule (`source_rule`)     | `type`                     | Fires when                                  | Priority                               |
| ------------------------ | -------------------------- | ------------------------------------------- | -------------------------------------- |
| `repeated_contact_today` | `repeat_contact_today`     | ≥2 interactions today                       | 2 → high, 3+ → critical                |
| `card_health`            | `customer_needs_attention` | projection health attention/critical        | attention → high, critical → critical  |
| `unanswered_inbound`     | `respond_to_customer`      | latest interaction is inbound               | <4h medium · <24h high · ≥24h critical |
| `new_customer_review`    | `review_new_contact`       | person is unverified (auto-created)         | medium                                 |
| `negative_sentiment`     | `check_unhappy_customer`   | projection sentiment negative               | confidence ≥0.7 critical, else high    |
| `stale_card`             | `card_needs_review`        | ≥14d since activity AND open actions remain | medium                                 |

No job / quote / invoice rules yet — those arrive when that data exists.

## Priority model

`priorityForRecommendation(rule, inputs)` maps rule + inputs → **critical / high /
medium** deterministically (stored in `severity`). My Day buckets by it:
**Critical · High · Waiting** (medium actionables) **· Review** (new-contact /
stale-card).

## Evidence model

`recommendationEvidence()` keeps evidence to **small structured hints** —
`{ source, detail }` such as `interaction: phone_call at 09:14` or
`card: projected health critical`. **No transcript/audio content and no secrets.**
Evidence is what makes a recommendation trustworthy and auditable.

## Idempotency & lifecycle

- The DB enforces **one OPEN recommendation of a `type` per card**
  (`recommendations_open_uk`). The engine inserts as `open`; on conflict it
  **enriches** the existing open row — so re-running never duplicates, and it
  naturally **merges** with the Identity Engine's rows of the same type.
- Each run **auto-closes** (`status='resolved'`) engine-owned recommendations
  whose rule no longer fires (only `created_by='system'` rows — never
  human-authored ones).
- The run is a `platform_jobs` row (`recommendation.sync`) — observable, and it
  returns `{ created, updated, closed, skipped, failed }`.

## How it feeds the surfaces

- **My Day** — a prominent Recommendations panel grouped Critical / High / Waiting
  / Review; each row shows title, customer, priority, explanation, next action,
  evidence count and age. Empty → "Nothing urgent right now."
- **Customer page** — the card dialog lists that card's open recommendations with
  explanation, next action and "if ignored" impact. **Read-only — no execution.**
- **Operations Centre** — a Recommendations health card (open / critical / high /
  overdue / generated today / closed today / latest) + a manual **Generate**
  override.

## How automations will later act (not built yet)

Recommendations are the **contract** a future Automation Engine consumes: it will
subscribe to open recommendations of specific `type`s, propose or (with explicit
human approval) take an action, and mark them `actioned`. Nothing in v1 sends a
message, email or executes anything — the engine only _recommends_.

## Security

- No service role in the frontend — surfaces read `recommendations` under RLS
  (tenant-scoped SELECT); all writes are the service-role sync function.
- Tenant-bound throughout; no cross-tenant reads.
- No secrets and no transcript/audio in `evidence` / `impact` / `detail`.
- No automatic customer messages and no destructive actions.

## Verification SQL

```sql
-- distribution by type / priority / status
select type, priority, status, count(*)
from (select type, severity as priority, status from recommendations) r
group by type, priority, status
order by type, priority, status;

-- newest recommendations with their explanation
select id, type, severity as priority, status, source_rule, detail as explanation, created_at
from recommendations
order by created_at desc
limit 20;

-- the engine's job runs
select job_type, status, records_processed, result, created_at
from platform_jobs where job_type = 'recommendation.sync'
order by created_at desc limit 20;
```
