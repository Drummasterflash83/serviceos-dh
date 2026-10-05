# The Core Loop

_The one idea the whole platform is built to run. If you understand this document
and the [glossary](00_GLOSSARY.md), you understand ServiceOS; everything else is
detail underneath it._

---

## The loop

Everything that happens in a business becomes a signal. Signals become
understanding. Understanding becomes a decision. Decisions become action. Action
becomes outcome. Outcome becomes learning. Learning becomes knowledge. Knowledge
improves every future decision.

```
   Signal ─▶ Observation ─▶ Card ─▶ Recommendation ─▶ Decision ─▶ Approval*
                                                                      │
                                                                      ▼
   Knowledge ◀─ Learning ◀─ Outcome ◀─ Execution ◀───────────────────┘
      │
      └────────────────────────▶ improves every future Observation, Decision & Recommendation
```

\* Approval is conditional — most of the loop's value is in the actions that are
safe enough **not** to need it. A human enters only at a deliberate boundary (see
[stage 6](#6-decision--approval)).

This is not a metaphor. Each arrow is a real transition between real tables, owned
by a specific engine, observable on the [event bus](../reference/EVENT_ARCHITECTURE.md),
and replayable. The rest of this document walks each stage: **what it is, who owns
it, where it is stored, what it connects to, and why it exists.**

---

## Why the loop is the architecture

Three consequences fall out of taking the loop literally, and they justify most of
the decisions in this manual:

1. **Nothing is a dead end.** Because every stage produces a durable, observable
   artefact, any later capability can read it, react to it, or replay it without the
   earlier stage knowing it exists. Capability grows by subscribing, not rewiring.
2. **The system gets better on its own.** The loop closes: Outcome → Learning →
   Knowledge → better next Decision. A platform whose loop does not close is a
   collection of features; a platform whose loop closes is [continuously
   optimising](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md).
3. **Every action is accountable.** Because a Decision is immutable and carries its
   evidence, and an Outcome is recorded against it, you can always answer "why did
   the system do that, and did it work?" — the precondition for ever trusting it to
   act.

---

## One loop, two vocabularies (the reconciliation)

The platform was built in two waves that each named this loop differently. **They
are the same loop.** This is the single most important thing to internalise, and it
is why the [glossary](00_GLOSSARY.md) exists.

| Core Loop stage | The "v1" deterministic stack calls it | The "intelligence" stack calls it | Canonical home |
|---|---|---|---|
| Signal | interaction row | interaction row | `interactions` |
| Observation | *(no true equivalent — "match suggestion")* | Observation / ObservationDraft | `intelligence_objects` |
| Card | Customer Card | *(reads the same cards)* | `customer_cards` |
| Recommendation | Recommendation (own "engine") | Intelligence Object of type recommendation | `recommendations` |
| Decision | *(implicit in rules)* | Decision Package | `decision_log` |
| Approval | "explicit human approval" → `actioned` | approval API | `automation_approvals` |
| Execution | future "Automation Engine" | Automation Intent → execute | `automation_intent`, `automation_execution_attempts` |
| Outcome | *(absent)* | Outcome | `outcomes` |
| Learning | "every decision is reversible" | correction / improvement | `learning.ts`, corrections |
| Knowledge | Business Graph ("memory layer") | source_entities / graph | `graph_nodes/edges/events` |

The v1 stack gave us Signal, Card, Recommendation, and Knowledge but **had no
Observation and no Outcome/Learning stage**. The intelligence stack gave us
Observation, Decision, Approval, Execution, and Outcome but under rival names. This
manual adopts **one name per stage** (the left column) and points each at its **one
canonical table** (the right column). Where two engines still write the same table
(e.g. Identity and the Recommendation rules both write `recommendations`), that
ownership is resolved in [reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md),
not left ambiguous.

---

## The stages

### 1. Signal → Interaction

- **What.** A single raw thing that happened — an inbound call, an email, a webhook,
  a job update, a document. A **connector** normalises it into one canonical
  **Interaction**: channel-neutral, deduplicated, tenant-scoped.
- **Owner.** The source connector (phone, email, and by configuration jobs,
  calendars, finance, documents). Every connector's *only* obligation is: produce a
  canonical interaction, mark it `ready`, and publish `interaction.ready`. It knows
  nothing about what happens next.
- **Storage.** `interactions` (lifecycle `pending → ready → enriched`), with the raw
  source rows preserved in per-source tables (`phone_calls`, `email_messages`, …).
- **Connects to.** Emits the `interaction.ready` [platform
  event](../reference/EVENT_ARCHITECTURE.md); resolved against the [Business
  Graph](03_BUSINESS_GRAPH.md) by [Identity](../reference/INTERACTIONS_IDENTITY_CARDS.md).
- **Why.** One canonical input shape means every downstream capability is written
  once, not once per channel. Adding a connector enriches the whole system for free.

### 2. Interaction → Observation

- **What.** The intelligence layer reads an enriched interaction, decides whether it
  is **eligible** to be understood (empty/automated/pleasantry → no; risk, sales, or
  operational value → yes), and if so produces an **Observation**: an eligible,
  scored, explainable unit of understanding carrying confidence, ambiguity, risk,
  reversibility, and the evidence that fired.
- **Owner.** The Eligibility engine (`eligibility.ts`) then the Observation ingest
  (`observation_ingest.ts`, job `intelligence.observe`), tracked by the
  `intelligence_ingestions` ledger.
- **Storage.** `intelligence_objects` (as an Observation `object_type`); the ledger
  gives each interaction exactly one idempotent observe attempt.
- **Connects to.** Its `source_entities` are resolved [graph
  nodes](03_BUSINESS_GRAPH.md); it is the input to the Decision Engine.
- **Why.** This is the stage the v1 stack lacked. Separating "what happened"
  (Interaction) from "what it means" (Observation) is what lets the system reason and
  explain instead of merely matching. See
  [reference/INTELLIGENCE_INGEST_BRIDGE](../reference/INTELLIGENCE_INGEST_BRIDGE.md).

### 3. Observation → Card

- **What.** Everything known about a subject (a customer, and later an engineer,
  site, supplier) is **projected** into one operational surface — the **Card** — with
  a calculated health, activity, priority, and the interactions and recommendations
  that concern it.
- **Owner.** The Customer Card projection (`customer-card-sync`). A Card is a
  **projection, never a system of record** — it can be rebuilt from the graph and
  interactions at any time.
- **Storage.** `customer_cards` (`context.projection`), with `locked_fields` for any
  human-verified overrides.
- **Connects to.** Reads the [Business Graph](03_BUSINESS_GRAPH.md) and interactions;
  surfaced in [Customers](09_NAVIGATION.md) and the [Command Centre](09_NAVIGATION.md).
- **Why.** New capability becomes "read the card" instead of "re-join five tables and
  hope." (The real-time [Live Call Card](../reference/LIVE_CALL_CARD.md) is a distinct
  surface — see the glossary's Card collision note.)

### 4. Card → Recommendation

- **What.** From card + interaction + observation state, deterministic, explainable
  rules produce **Recommendations**: proposed next actions, each with a title,
  detail, evidence, severity, confidence, and a `source_rule`.
- **Owner.** The recommendation rules (`recommendations.ts`). A Recommendation is an
  **Intelligence Object of type recommendation, not a separate engine** — this is why
  the old "Recommendation Engine" and "Identity Engine" both appeared to own it; the
  reconciliation (single rule-id set, single owner) is in
  [reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md).
- **Storage.** `recommendations` (one open row per subject+rule).
- **Connects to.** It is the **contract the Decision Engine consumes** — a proposed
  action awaiting a ruling on whether, how, and by whom it should happen.
- **Why.** Read-only proposal is the safe default: the system always *proposes*
  before anything *acts*.

### 5. Recommendation → Decision

- **What.** The **Decision Engine** — one pure, deterministic function — takes the
  object and its context and rules on **who or what owns the next move, and why**,
  across five axes: confidence, authority, risk, reversibility, and impact. The
  output is an immutable **Decision Package** naming one of nine destinations
  (authorise automation, require approval, route to OpenFolk review, route to tenant
  senior review, require customer approval, wait, escalate, reject, or no action).
- **Owner.** The Decision Engine (`decision.ts`), gated by the current [Operational
  Mode](../reference/DECISION_ENGINE.md) (the five maturity stages).
- **Storage.** `decision_log` (immutable, with `supersedes` for revisions).
- **Connects to.** Consumes objectives context (does this move an objective?); emits
  the destination that the next stage obeys.
- **Why.** Concentrating "should we act, and who decides?" into one explainable,
  replayable function is what makes autonomy safe and auditable. Full spec:
  [reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md).

### 6. Decision → Approval

- **What.** When the Decision routes to a human, it routes to the **right** human.
  Three destinations, never confused:
  - **OpenFolk review** — the *machine's* problems: low confidence, conflicting
    evidence, missing policy. OpenFolk resolves these so the customer never sees them.
  - **Tenant senior review** — judgement only someone inside that business should make.
  - **Customer approval** — genuine business *authority*: high-value spend, refunds,
    discounts, legal commitments. This is the customer's decision and stays theirs.
- **Owner.** The routing is the Decision's; the resolution is the assigned human's,
  recorded via the approval/review path.
- **Storage.** `automation_approvals`; the human-review queue (`review_tasks`).
- **Why.** "AI acts by default; humans intervene by exception" only works if the
  exception reaches the *correct* owner. Never route the machine's uncertainty to the
  customer; never route the customer's authority to OpenFolk. (Constitution,
  discovery #5.)

### 7. Approval / Decision → Execution

- **What.** An authorised action becomes an **Automation Intent** and is executed by
  the **Automation Engine**, which re-checks at execution time that this exact,
  previously-authorised intent is *still* safe and valid to run right now
  (validate → claim → execute → record → report), through a connector adapter, with
  idempotency and leasing.
- **Owner.** The Automation Engine (`automation_guards.ts`, `automation.execute`).
- **Storage.** `automation_intent` / `automation_intent_states`;
  `automation_execution_attempts` (append-only).
- **Why.** Authorisation and execution are deliberately separate: a decision made a
  minute ago must not execute blindly if the world changed. Full spec:
  [reference/AUTOMATION_ENGINE](../reference/AUTOMATION_ENGINE.md).

### 8. Execution → Outcome

- **What.** Every execution records an **Outcome** in three layers: the execution
  result (did the action complete?), the operational outcome (did the thing we wanted
  happen?), and the business outcome (did it move an objective?), each with a
  verification state (`system_observed`, `externally_verified`, `human_verified`,
  `inferred_unverified`, `rejected`).
- **Owner.** The Automation Engine writes execution results; the [Objectives &
  Outcomes](../reference/OBJECTIVES_AND_OUTCOMES.md) engine assesses operational and
  business outcomes.
- **Storage.** `outcomes` (append-only).
- **Why.** Without a first-class Outcome, "did it work?" is unanswerable and the loop
  cannot close. This is the stage both older stacks were missing.

### 9. Outcome → Learning

- **What.** Outcomes and human corrections become **Learning**: a captured lesson
  that changes future behaviour. Every avoidable human intervention is treated as a
  defect whose fix is a configuration or policy change, so the same correction is
  never needed twice. Each lesson is classified by layer — **universal** (everyone),
  **industry** (a trade), or **tenant** (one business) — and the layers never blur.
- **Owner.** The learning primitives (`learning.ts`), objective health evaluation,
  and OpenFolk.
- **Storage.** Corrections, `objective_health` deltas, and proposed policy/config
  versions.
- **Why.** "Every intervention reduces the next" is the mechanism that turns a
  service cost into a compounding asset. The layer classification is a **boundary of
  trust**, not bookkeeping: a tenant's private pattern leaking into universal learning
  is a breach, not a bug. (Constitution, discovery #7.)

### 10. Learning → Knowledge → the next decision

- **What.** Learning accumulates into **Knowledge**: the durable, queryable memory of
  the business — the [Business Graph](03_BUSINESS_GRAPH.md) of who and what connects,
  plus the learned policies, patterns, and reconstructed workflows. Knowledge is what
  every future Observation, Decision, and Recommendation reads.
- **Owner.** The Business Graph projection and the [Knowledge](06_LEARNING_CENTRE.md) layer.
- **Storage.** `graph_nodes/edges/events` plus versioned policy/config.
- **Why.** This is where the loop closes and compounds. The tenth customer benefits
  from nine businesses' worth of universal learning; the thousandth from a thousand —
  without any customer's private reality leaking, because [learning is
  layered](06_LEARNING_CENTRE.md).

---

## Two loops, two altitudes

The stages above are the **fast loop**: it runs on individual work, all day —
observe, decide, act, measure, learn. Above it runs the **slow loop**, the one the
company is named for: it does not act on a single email, it acts on *how the business
operates* — noticing that a class of exceptions keeps arriving and changing the
policy that produces them, noticing an objective that will not move and asking
whether the objective, the process, or the priorities are wrong. The slow loop turns
thousands of fast-loop outcomes into one structural improvement. It is documented in
[Continuous Optimisation](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md); this
manual builds the fast loop that feeds it.

---

## Where each stage is documented

| Stage | Primary spec |
|---|---|
| Signal / Interaction, the event bus | [reference/EVENT_ARCHITECTURE](../reference/EVENT_ARCHITECTURE.md), [reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md) |
| Observation | [reference/INTELLIGENCE_INGEST_BRIDGE](../reference/INTELLIGENCE_INGEST_BRIDGE.md), [04_AI_ARCHITECTURE](04_AI_ARCHITECTURE.md) |
| Card, Recommendation, Identity | [reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md) |
| Decision, Operational Modes, Approval routing | [reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md) |
| Execution | [reference/AUTOMATION_ENGINE](../reference/AUTOMATION_ENGINE.md) |
| Outcome, Objectives, Learning-by-measurement | [reference/OBJECTIVES_AND_OUTCOMES](../reference/OBJECTIVES_AND_OUTCOMES.md) |
| Knowledge, learning layers | [03_BUSINESS_GRAPH](03_BUSINESS_GRAPH.md), [06_LEARNING_CENTRE](06_LEARNING_CENTRE.md) |
| The rules over all of it | [07_PROTOCOL](07_PROTOCOL.md) |
