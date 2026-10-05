# AI Architecture

_How ServiceOS thinks and acts. This is the intelligence layer of
[the platform](01_PLATFORM.md): the engines that turn an interaction into
understanding, a decision, a safe action, and a lesson. It is the reasoning half of
[the Core Loop](02_CORE_LOOP.md); the engine reference specs in
[`reference/`](../README.md) are the precise contracts underneath it._

---

## The shape of the mind

ServiceOS does not have "an AI feature". It has a **pipeline of narrow, explainable
engines**, each answering one question, each auditable, composed into one loop. No
engine is a black box; every one records why it concluded what it did. This is a
deliberate rejection of the "one big model decides everything" design, because a
business will only hand its operations to intelligence it can inspect, correct, and
roll back.

```
  Discovery ─▶ Reasoning ─▶ Planning ─▶ Approval ─▶ Execution ─▶ Reflection
      │            │            │           │           │            │
   eligibility  observation  decision +   routing to  automation  outcomes +
   what's       what does    modes:       the right   engine:     objective
   worth        this mean?   who acts,    human, or   is it still  health:
   seeing?                   and how?     automate    safe now?    did it work?
                                                                        │
                     Memory ◀── Learning ◀── Knowledge extraction ◀─────┘
```

Each phase maps to a real engine and a real reference spec. This document explains
the phases and the cross-cutting properties (confidence, escalation, audit, safety,
trust, human override) that hold across all of them.

---

## The phases

### Discovery — "what is worth understanding?"
The system observes everything but reasons about only what matters. The
**Eligibility** engine (`eligibility.ts`) reads each enriched interaction and
decides whether it deserves an Observation: empty, automated, or pleasantry traffic
is filtered out; risk, sales, and operational value is let through, carrying the
signals that fired for explainability. Discovery is cheap filtering that protects
every expensive stage downstream. It is also the whole of a customer's earliest
[Operational Mode](../reference/DECISION_ENGINE.md): in Discovery mode the system
*only* observes and learns, and acts on nothing.

### Reasoning — "what does this mean?"
Eligible interactions become **Observations**: channel-neutral, scored, explainable
units of understanding, produced by `intelligence.observe` and recorded in
`intelligence_objects`. An Observation carries confidence, ambiguity, risk, and
reversibility, plus its `source_entities` (resolved [graph nodes](03_BUSINESS_GRAPH.md)).
This is where raw events become understanding. Spec:
[reference/INTELLIGENCE_INGEST_BRIDGE](../reference/INTELLIGENCE_INGEST_BRIDGE.md).

### Planning — "who or what should act, and how?"
The **Decision Engine** (`decision.ts`) is one pure, deterministic function that
takes an object and rules on the next move across five axes — confidence, authority,
risk, reversibility, impact — producing an immutable **Decision Package** naming one
of nine destinations. It is gated by the current **Operational Mode**, which is how
much autonomy this tenant has earned (the five maturity stages). Planning never
executes; it decides. Spec:
[reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md).

### Approval — "does a human need to decide this?"
When the Decision routes to a human, it routes to the **correct** human: OpenFolk
review for the machine's uncertainty, tenant senior review for business judgement,
customer approval for the customer's own authority. Most well-understood, low-risk
work in a mature tenant does not reach this phase at all, which is the point. The
three-destination rule is in [the Core Loop](02_CORE_LOOP.md#6-decision--approval)
and the [constitution](../foundation/OPENFOLK_PHILOSOPHY.md).

### Execution — "is this still safe to do right now?"
An authorised action becomes an **Automation Intent** and is run by the **Automation
Engine** (`automation_guards.ts`), which re-validates at execution time that this
exact intent is still safe and valid (validate → claim → execute → record → report),
through a connector adapter, idempotently. Authorisation and execution are separate
on purpose: the world can change between deciding and doing. Spec:
[reference/AUTOMATION_ENGINE](../reference/AUTOMATION_ENGINE.md).

### Reflection — "did it work?"
Every execution produces an **Outcome** in three layers (execution result,
operational outcome, business outcome), and the **Objectives & Outcomes** engine
turns measurements into immutable objective-health snapshots, assessing whether the
action moved what the business is trying to achieve. Reflection is what closes the
loop from "we did something" to "it mattered / it did not". Spec:
[reference/OBJECTIVES_AND_OUTCOMES](../reference/OBJECTIVES_AND_OUTCOMES.md).

### Learning, Knowledge extraction & Memory — "what do we now know?"
Corrections and outcomes become **Learning**, classified by layer (universal /
industry / tenant), captured so the same correction is never needed twice.
Knowledge extraction folds those lessons into durable **Memory**: the
[Business Graph](03_BUSINESS_GRAPH.md) of relationships plus learned policies,
patterns, and reconstructed workflows. Memory is what the next Discovery, Reasoning,
and Planning read, so tomorrow's loop starts smarter than today's. Full treatment:
[06_LEARNING_CENTRE](06_LEARNING_CENTRE.md).

---

## The properties that hold across every phase

These are not phases; they are guarantees the whole pipeline must satisfy.

**Confidence.** Every engine outputs a calibrated confidence, and confidence is one
of the five axes the Decision Engine weighs. Low confidence does not fail silently;
it *routes*, to review rather than to action. The canonical confidence scale is
`unknown · possible · likely · confirmed · rejected`
([glossary](00_GLOSSARY.md#terms-that-collide-resolved-here-once)).

**Escalation.** When confidence is insufficient, evidence conflicts, no policy
covers the situation, risk is too high, the action is irreversible, or the authority
belongs to the customer, the Decision Engine escalates to the right human
destination *before* anything reaches the customer. Escalation is a designed edge of
the loop, never an error path.

**Audit.** Every observation, decision, execution attempt, and outcome is an
append-only, immutable record carrying its inputs and reason codes. "Why did the
system do that?" is always answerable from stored artefacts, not reconstructed after
the fact. This is the [append-only history](03_BUSINESS_GRAPH.md#database-principles)
principle applied to intelligence.

**Safety.** External-effect capabilities stay disabled until explicitly enabled;
execution guards re-check safety at run time; idempotency prevents double-action; and
the [Protocol](07_PROTOCOL.md) risk thresholds bound what any engine may attempt.
The default posture is that the system may understand freely and act only within
proven, permitted limits.

**Trust.** Trust is *manufactured*, not assumed, and it is the whole purpose of the
[Operational Modes](../reference/DECISION_ENGINE.md). A tenant moves from Discovery
(observe only) to Continuous Optimisation (act, then improve) exactly as fast as the
evidence earns, and no faster. AI assists before AI acts, every time.

**Human override.** A human can always intervene, correct, or reverse. Because
Decisions are immutable and reversible and every action is recorded, an override is
a first-class, captured event that becomes [Learning](06_LEARNING_CENTRE.md), not a hack
around the system. Humans provide judgement; AI performs work; the two roles are kept
distinct on purpose.

---

## Why it is built this way

A single opaque model that "just decides" would be faster to build and impossible to
trust, correct, or sell to a business that is accountable for the outcome. By
decomposing intelligence into narrow, explainable engines connected by an
[event bus](../reference/EVENT_ARCHITECTURE.md) and closed by
[measurement](../reference/OBJECTIVES_AND_OUTCOMES.md), ServiceOS gets an intelligence
that is inspectable at every step, improvable at every correction, and safe to grant
autonomy one earned stage at a time. That is the only kind of intelligence a business
can actually run on.

---

## Where each phase is specified

| Phase | Engine | Spec |
|---|---|---|
| Discovery | Eligibility | [02_CORE_LOOP](02_CORE_LOOP.md), `eligibility.ts` |
| Reasoning | Observation | [reference/INTELLIGENCE_INGEST_BRIDGE](../reference/INTELLIGENCE_INGEST_BRIDGE.md) |
| Planning | Decision + Modes | [reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md) |
| Approval | Decision routing | [02_CORE_LOOP](02_CORE_LOOP.md#6-decision--approval) |
| Execution | Automation | [reference/AUTOMATION_ENGINE](../reference/AUTOMATION_ENGINE.md) |
| Reflection | Objectives & Outcomes | [reference/OBJECTIVES_AND_OUTCOMES](../reference/OBJECTIVES_AND_OUTCOMES.md) |
| Learning / Memory | Knowledge | [06_LEARNING_CENTRE](06_LEARNING_CENTRE.md), [03_BUSINESS_GRAPH](03_BUSINESS_GRAPH.md) |
| Who runs the work | Agents | [05_AGENTS](05_AGENTS.md) |
| The rules over it | Protocol | [07_PROTOCOL](07_PROTOCOL.md) |
