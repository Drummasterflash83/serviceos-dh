# Universal Decision Engine v1

**Status:** Implemented and verified (pure engine machine-proven; migrations
statically reviewed). Not deployed.

The Decision Engine is the single deterministic authority for one question:

> **Who or what owns the next decision, and why?**

Every routing choice across OpenFolk, ServiceOS, ProductOS and future domain packs
flows through it. There is exactly one engine; there is no second routing system.
This document explains what it is and the boundaries it must never cross. Read
[foundation/OPENFOLK_PHILOSOPHY.md](foundation/OPENFOLK_PHILOSOPHY.md) first — this
engine is the mechanical expression of that philosophy's routing principles.

---

## 1. Purpose and the AI-first model

The platform's default operating model is:

```
AI understands → policy permits → AI acts → outcome is measured → system learns
```

Human intervention is the exception. The Decision Engine exists to decide, for a
single intelligence object, which of these authoritative destinations owns the
next step — and to do so identically for every domain, from configuration alone:

`AUTOMATION_AUTHORISED` · `AUTOMATION_REQUIRES_APPROVAL` · `OPENFOLK_REVIEW` ·
`TENANT_SENIOR_REVIEW` · `CUSTOMER_APPROVAL` · `WAIT_FOR_EVENT` · `ESCALATE` ·
`REJECT` · `NO_ACTION`

It favours automation: when confidence, evidence, policy, risk, reversibility,
impact and authority all permit, it authorises the machine to act.

## 2. The pure-engine boundary

`evaluateDecision(input: DecisionInput): DecisionPackage`
([decision.ts](../supabase/functions/_shared/intelligence/decision.ts)) is a pure
function. It **decides only**. It does not — and the conformance gate enforces
this — write to the database, emit events, create Actions, execute automations,
send notifications, contact customers, mutate policy, update learning, infer the
tenant from client input, or contain any ServiceOS/ProductOS/industry branching.

Everything it needs is resolved **before** entry (profile, policies, ownership,
versions, thresholds). Persistence and execution are caller-owned:

- the pure engine **decides**;
- handlers **persist** (`decision_log`, objects, review tasks, intents);
- a separate Automation Engine **executes**;
- reviewers **correct**;
- learning **proposes** configuration changes.

This separation is what makes the engine testable, replayable and
simulation-compatible.

## 2a. Fail-safe on missing configuration

A decision authority must never let *absent* configuration become permission. The
engine distinguishes two cases:

- **Conservative defaults are allowed only where they cannot authorise additional
  external action** — e.g. reversibility thresholds (they only ever *restrict*),
  and a missing confidence threshold treated as maximally strict.
- **Missing configuration that affects authority, automation or business risk
  routes to `OPENFOLK_REVIEW`** with a stable reason code, and records exactly
  which keys were absent in `rationale.missingConfiguration` (structured, no raw
  content):
  - `incomplete_configuration` — a required confidence/ambiguity/evidence key.
  - `missing_authority_policy` — a financial authority request with no delegated
    limit configured.
  - `missing_automation_policy` — an automatable action whose policy never
    explicitly granted an automation permission.
  - `missing_risk_policy` — a risk-bearing object with no risk thresholds.

The platform seeds a complete baseline for these thresholds, so the fail-safe
fires only on a genuine omission (notably `authority.delegated_limit`, which is
deliberately left per-tenant — an unconfigured spend fails safe to review rather
than auto-approving).

## 3. The Decision Package

The engine returns one **immutable** (deep-frozen), serialisable, complete
Decision Package — the only downstream authority. Downstream systems consume it;
they never re-decide. Its shape is defined in
[types.ts](../supabase/functions/_shared/intelligence/types.ts) and persisted to
`decision_log`. Key parts:

- `decision` + `nextDecisionOwner` — the destination and who owns the next step.
- `rationale` — a summary, machine-readable `reasonCodes` (from a controlled
  registry), the policy rules that matched, and the alternatives rejected.
- the **five axes** — `confidence`, `authority`, `risk`, `reversibility`,
  `impact` (each independent; see §5).
- `ownership` — full RACI.
- `proposedAction` and `automationIntent` (emitted, never executed).
- `routing` — the review/approval/wait flags.
- `versions` — engine, profile, policy, learning, domain-pack versions.
- `evidence` — interaction/entity/object ids + an `evidenceHash` (no raw content).
- `outcomeContract` — how success will be measured (§8).
- `audit` — `inputHash`, `outputHash`, `evaluatedAt`, `correlationId`.

It carries **no raw email bodies, transcripts, tokens or secrets** — only
references and hashes — so it is safe to persist and expose selectively.

## 4. Immutability and lineage

A persisted Decision Package is never edited in place. New developments create
new rows and link back:

```
decision A → reviewed by B → corrected by C → superseded by decision D
```

`decision_log.supersedes` records the chain; historical rationale is never
overwritten.

**Enforced in the database, not just in memory.** `deepFreeze()` protects the
in-memory package; the persisted record is protected by an **append-only
constraint** on `decision_log` — a `BEFORE UPDATE`/`BEFORE DELETE` trigger rejects
any mutation (even by the service role), and `UPDATE`/`DELETE` are revoked from
tenant roles. A decision's package, hashes, rationale, reason codes, versions,
destination, owner and timestamp cannot change after insert. Reviews, outcomes
and corrections live in **separate** tables (`review_tasks`,
`object_state_history`, `corrections`) and progress through their own lifecycles;
re-evaluation inserts a **new** decision linked by `supersedes`. Proven by
`supabase/tests/decision_log_immutable.test.sql`.

## 5. Five independent axes

The engine evaluates five dimensions separately and never collapses them into one
score:

| Axis | Question |
|---|---|
| **Confidence** | Can the system identify the correct interpretation and action? |
| **Authority** | Who legally or commercially owns the right to approve/execute? |
| **Risk** | What damage could occur if we are wrong? |
| **Reversibility** | Can the action be undone or compensated? |
| **Impact** | Which areas are affected (financial, customer, legal, safety, …)? |

High confidence does not imply sufficient authority. Low risk does not imply
reversibility. Thresholds are read from the effective profile; none are hard-coded
per domain.

**Authority is normalised before the engine runs.** The engine never infers
commercial authority from an arbitrary object attribute. A caller-side resolver
(`resolveAuthorityContext`, domain-neutral, no domain branching) maps a
domain-neutral authority block into an `AuthorityContext` with a typed
`authorityType` (financial, commercial, contractual, legal, compliance, safety,
operational, policy_exception), currency-tagged `requestedValue`/`delegatedLimit`,
and a `requiredAuthorityHolder`. The engine compares only these facts:

- **Unlike currencies are never compared** — a request in one currency against a
  limit in another routes to review (`authority_currency_mismatch`), never a
  false auto-approve.
- A purchase **within** the delegated limit may automate; the **same** purchase
  **over** it routes to the configured holder — `CUSTOMER_APPROVAL` or
  `TENANT_SENIOR_REVIEW`.
- **Non-financial** authority (e.g. a legal commitment) flows through the *same*
  model via `explicitCustomerApprovalRequired`.
- ServiceOS and ProductOS use the identical authority model; only the resolver's
  input (domain data → normalised block) differs.

## 6. Routing precedence

Routing is a single ordered, data-driven precedence (`PRECEDENCE` in
[decision.ts](../supabase/functions/_shared/intelligence/decision.ts)) — not
scattered conditionals. First match wins:

1. Conflicting evidence → `OPENFOLK_REVIEW`
2. Insufficient evidence → `OPENFOLK_REVIEW`
3. Missing policy → `OPENFOLK_REVIEW`
4. Confidence below threshold → `OPENFOLK_REVIEW`
5. Ambiguity too high → `OPENFOLK_REVIEW`
6. Customer authority required → `CUSTOMER_APPROVAL`
7. Tenant judgement required → `TENANT_SENIOR_REVIEW`
8. Risk beyond delegated policy → `OPENFOLK_REVIEW`
9. Irreversible action with non-trivial risk → `OPENFOLK_REVIEW`
10. Unmet dependency → `WAIT_FOR_EVENT`
11. Policy prohibits → `REJECT`
12. Otherwise, work exists and all gates pass → `AUTOMATION_AUTHORISED` /
    `AUTOMATION_REQUIRES_APPROVAL`
13. No work → `NO_ACTION`

> **Improvement over the initial sketch:** machine-uncertainty gates (1–5) run
> *before* authority/tenant/customer routing. The philosophy forbids showing
> customers raw AI uncertainty; if the AI is unsure *what* to do, OpenFolk
> resolves that first — the customer is only ever asked to exercise *authority*,
> never to adjudicate the machine's doubt.

This precedence structurally prevents the four forbidden bypasses: OpenFolk
cannot approve customer-owned authority (gate 6 is a distinct destination),
customers are never shown AI uncertainty (gates 1–5 precede any customer route),
high-confidence AI cannot bypass authority (gate 6 precedes gate 12), and low-risk
automation cannot bypass an explicit prohibition (gate 11 precedes gate 12).

## 7. Three distinct human destinations

Human routing is never treated as one thing:

- **OpenFolk review** — the machine's problems: uncertainty, conflicting
  evidence, missing policy, unfamiliar patterns. Resolved professionally so the
  customer never sees them. OpenFolk is an exception and optimisation layer, not
  permanent middleware; every review should answer why the AI could not act and
  what configuration change would remove the exception next time.
- **Tenant senior review** — understood situations needing internal business
  judgement that belongs to a tenant manager/role.
- **Customer approval** — genuine business authority: high-value spend, refunds,
  discounts, contract or legal commitments, policy exceptions. This is the
  customer's decision and it stays theirs. OpenFolk can never approve it.

## 8. Automation boundary and outcome contract

The engine authorises but never executes. The two automation decisions mean:

- **`AUTOMATION_AUTHORISED`** — execution is *authorised under current policy*. It still
  **produces (and requires) a persisted `automation_intent`**; the Automation
  Engine alone claims and runs it. `AUTOMATION_AUTHORISED` is **never** a licence for
  downstream code to bypass the automation-intent lifecycle. (When the proposed
  action is human work with no automation, `AUTOMATION_AUTHORISED` simply authorises
  materialising and assigning it — no intent is involved.)
- **`AUTOMATION_REQUIRES_APPROVAL`** — an intent that requires a later approval gate
  (`requiresApproval: true`) before the Automation Engine may execute.

Either way the Automation Engine still claims and runs the intent through its
data-driven lifecycle (`automation_intent_states`). Execution-time guards (intent
not expired, policy version not revoked, authority still valid, idempotency key
unconsumed, dependency satisfied) are *safety checks, not business re-decisions* —
the Decision Package already carries everything needed to execute without
re-evaluating policy.

> **Naming (applied):** these two destinations were renamed from the earlier
> `AUTOMATION_AUTHORISED` / `AUTOMATION_REQUIRES_APPROVAL`, which read as if the first executes
> and the second only prepares — understating that *both* merely authorise and
> neither executes. The names are now `AUTOMATION_AUTHORISED` and
> `AUTOMATION_REQUIRES_APPROVAL` consistently across the type union, the
> destination registry, routing, tests and this document. No aliases were kept
> (nothing had been deployed), so the old names survive only in this historical
> note.

Every actionable decision returns an `outcomeContract` (expected outcome type,
measurable signals, timeout) so the platform can later tell whether the decision
succeeded. The engine defines the contract; it does not measure the outcome.

## 9. Replay, simulation and versioning

Because evaluation is pure and the package records its input snapshot, input hash
and all contributing versions (engine, profile, policy, learning, domain pack), a
decision is **replayable**: re-evaluating the same input with the same versions
produces the same package, except for runtime metadata (ids/timestamps) which the
caller supplies for deterministic replay. This is the substrate for the
simulation engine ("if this rule had existed for the last 30 days…").

## 10. Learning boundary

The engine *consumes* prior approved learning (via `learningVersionIds`); it
never updates learning. After an outcome or correction, the loop records what
happened, compares expected vs actual, classifies the lesson (universal /
industry / tenant — never mixed), and proposes a **draft** configuration change
that requires appropriate publication authority. A single tenant event never
auto-publishes a universal or industry change.

## 11. One engine, two domains — proof

The engine contains no domain literals; domain packs and policies supply the
vocabulary, thresholds, authority types, impact categories, action types and
allowed automation. The same `evaluateDecision` produces:

- **ServiceOS** — Observation "customer requested an engineer visit" →
  `AUTOMATION_AUTHORISED` proposing `schedule_visit` (service coordination owner); no
  customer approval unless commercial terms change.
- **ProductOS** — Observation "stock below committed demand" →
  `AUTOMATION_AUTHORISED` proposing `raise_purchase_order` *within* the delegated
  purchasing limit; over the limit the same object routes to `CUSTOMER_APPROVAL`.

The engine code is identical; only configuration differs. This is proven by
[decision.verify.ts](../supabase/functions/_shared/intelligence/decision.verify.ts).

## 12. Future extension model

- **New destination or owner kind** → add a row to the controlled registry
  (`decision_destinations` / `decision_owner_kinds`) and a case in the pure
  mapping. No parallel engine.
- **New reason code** → add to the `reason_codes` registry and the controlled TS
  list (a reviewed change; the gate rejects unknown codes).
- **New axis input** (e.g. a richer impact model) → extend the axis functions;
  they remain pure and profile-driven.
- **New domain pack** → contributes policies and vocabulary only; the engine is
  untouched.
