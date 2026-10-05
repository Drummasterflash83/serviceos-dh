> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Interactions, Identity, Cards & Recommendations](../reference/INTERACTIONS_IDENTITY_CARDS.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# Identity Resolution Engine v1

An **evidence engine**, not CRM matching. Every new interaction asks: _who is this?
what company? what site? what job? what previous conversations? what next?_ — and
answers with **evidence, never fabricated certainty**.

## Principles

- Every signal increases confidence.
- Never silently merge weak matches.
- Everything stores evidence.
- Everything remains explainable.
- **Every decision is reversible.**

## Evidence model

The engine (`supabase/functions/_shared/identity.ts` → `resolveIdentity`) resolves
each interaction against the tenant's existing graph using **evidence only**:

| Evidence source                                                | Used in v1 | Notes                                          |
| -------------------------------------------------------------- | ---------- | ---------------------------------------------- |
| Phone number                                                   | ✅         | exact match vs `people.primary_phone`, history |
| Email address                                                  | ✅         | exact match vs `people.primary_email`, history |
| Email domain                                                   | ✅         | vs `companies.domain` (free-mail excluded)     |
| Company name                                                   | ⏳         | future (needs normalisation)                   |
| Person name                                                    | ✅ (weak)  | label only; never a match on its own           |
| Prior interactions                                             | ✅         | "known number, no record" → POSSIBLE           |
| Prior people/companies                                         | ✅         | the graph the engine matches against           |
| Site / job / invoice / asset / engineer / vehicle reg / serial | ⏳         | Commusoft-ready placeholders (below)           |
| AI semantic similarity                                         | ⏳         | not in v1 — deterministic only                 |

Every candidate stores `{ evidence[], confidence, explanation, recommended_action }`
in `interaction_match_suggestions`, so any decision can be inspected and undone.

## Confidence scoring

Levels: **UNKNOWN · POSSIBLE · LIKELY · CONFIRMED · REJECTED**. Deterministic in v1:

- exact email match → CONFIRMED (0.95)
- exact phone match → CONFIRMED (0.92)
- email domain → LIKELY (0.85) / POSSIBLE if no company record (0.40)
- prior history only → POSSIBLE (0.40)
- nothing → UNKNOWN (0)

**Weak matches are never auto-confirmed.** `confirmed` on a match suggestion means
strong exact evidence _or_ an explicit user action — never weak/AI inference.

## What the engine does (per interaction)

Runs as an observable, retryable **platform job** (`identity.resolve`):

1. Resolve identity (person + company candidates, evidence, actions).
2. Write explainable match suggestions for concrete matches.
3. Link, or **provisionally create** (reversible, `verified=false`,
   `created_source='interaction'`) the person/company — from **real** email/phone/
   domain evidence. Free-mail domains never create a company.
4. Upsert the customer card, **respecting `locked_fields`** (manually-confirmed data
   is never overwritten).
5. Recompute the card's **live priority score** from real inputs.
6. Generate **recommendations** (real, computed — e.g. repeat-contact-today,
   review-new-contact). Not auto-executed.
7. Link the interaction (`related_person_id/company_id`) and mark it `enriched`.

### Priority scoring (documented, not faked)

`base 20 · +5 per interaction (cap 30) · +severity-weighted open recs · +20 negative
sentiment · +15 contacted-again-today` → clamped 0–100 → bucket
critical/high/medium/low. Inputs are stored in `customer_cards.priority_inputs`.

### Recommendation engine

`recommendations` rows are computed and explainable. v1 rules that are computable
from current data: **repeat_contact_today**, **review_new_contact**. Future rules
(quote expiring, missed SLA, engineer overloaded, invoice chase, upsell, review
request) need job/SLA/quote data — they slot in once a job system is connected.

## Card ownership & cross-channel

Cards support `owner_id`, `assigned_team_id`, `watchers`, `followers`,
`helper_suggestions` — cards can move between users. Because the engine keys on the
canonical `interactions` timeline (phone + email today; Slack/Teams/WhatsApp/forms/
website chat later), **every channel builds one customer story** automatically.

## Commusoft readiness (do NOT build yet)

The engine is **provider-agnostic**. `customer_cards.context` (and the resolver's
`site/job/asset` candidates, UNKNOWN in v1) are the generic slots a job system fills
later: customer, site, job, asset, engineer, quote, invoice, service history,
documents, photos. Commusoft plugs in by populating these — no engine change, no
hardcoding.

## Platform jobs

Identity resolution, enrichment and recommendation generation run inside the
`identity.resolve` job (observable in the Operations Centre, retryable by re-running
`identity-resolve`). Finer-grained per-phase jobs (`identity.enrich`,
`identity.recommend`) are a future split. The scheduled `identity-scheduled-sync`
(secret `IDENTITY_SYNC_SECRET`) runs it automatically per tenant.

## Why explainability matters

This is the trust boundary of the whole platform. Staff will act on these answers
while a customer is on the line, and automations will later act on them unattended.
If a link can't be explained (which evidence, what confidence, why), it can't be
trusted, can't be safely automated, and can't be corrected. So **every match carries
its evidence and is reversible** — that is what lets ServiceOS grow from "assist the
human" to "safely automate" without ever silently corrupting a customer record.

## ProductOS / OpenFolk compatibility

The engine is a shared **platform capability**: generic evidence sources, generic
confidence levels, generic candidate/context model. ServiceOS resolves callers to
customers/jobs; ProductOS resolves the same signals to accounts/orders/tickets using
the identical engine — only the evidence tables differ. Any future OpenFolk product
reuses it unchanged.
