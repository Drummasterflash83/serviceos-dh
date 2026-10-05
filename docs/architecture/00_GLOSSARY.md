# Canonical Vocabulary

_This is the terminology authority for the entire repository. Every document,
comment, table name, and screen label should use these words with exactly these
meanings. Where the codebase currently uses a different word for one of these
concepts, that is a legacy alias to be migrated, and it is called out below so no
one mistakes it for a distinct idea._

Read [02_CORE_LOOP.md](02_CORE_LOOP.md) for how these terms connect into the one
lifecycle that defines the platform.

---

## Why this document exists

The platform was built in two waves. An earlier "v1" wave produced a deterministic
stack (interactions, identity, cards, recommendations, business graph). A later
wave produced the "intelligence" stack (observations, decisions, operational modes,
automation intents, objectives, outcomes). **The two waves describe the same loop
in two different vocabularies, and they were never reconciled in prose.** This
glossary performs that reconciliation. When an older document and the code disagree
on a word, this document is the tie-breaker.

The rule for the whole repository: **one concept, one word; one word, one concept.**

---

## The lifecycle terms (in order)

These ten nouns are the spine of the platform. Each means exactly one thing and
appears in exactly one stage of [the Core Loop](02_CORE_LOOP.md).

| Term | Canonical meaning | Stored in | Legacy aliases to retire |
|---|---|---|---|
| **Signal** | A single raw thing that happened in or to the business — a call, an email, a webhook, a job update, a document arriving. The unit of input. | Captured as an **Interaction** row (see below). | "operational signal"; the plain-English "signal" in older specs. **`SIGNAL_SYNC_SECRET` is a stranded alias** — it gates the *interactions* sync, not a distinct "Signal" object. |
| **Interaction** | The canonical, channel-neutral record of one Signal, after a connector normalises it. The system of record for "something happened." | `interactions` | — |
| **Observation** | What the intelligence layer concludes a set of interactions *means* — an eligible, scored, explainable unit of understanding. Produced by `intelligence.observe`. | `intelligence_objects` (as an `object_type`), via the `intelligence_ingestions` ledger | "ObservationDraft" is the pre-persistence shape; "match suggestion" / "candidate" are the v1 stack's weaker analogue. |
| **Intelligence Object** | The universal envelope for any unit of understanding the system holds — an Observation, a Recommendation, an Action, a Risk are all `object_type`s of one table. | `intelligence_objects` | — |
| **Recommendation** | An Intelligence Object that proposes a next action for a human or an agent, with evidence and confidence. **One `object_type`, not a separate engine.** | `recommendations` (and projected as an intelligence object) | Treating "Recommendation" as its own top-level system. It is a shape of Intelligence Object. |
| **Card** | A **projection** that gathers everything known about one subject into a single operational surface. Unqualified, "Card" means **Customer Card**. | `customer_cards` (`context.projection`) | — |
| **Decision** | The immutable, deterministic ruling on who or what owns the next move for one object, and why. Output of the Decision Engine. Also called a **Decision Package**. | `decision_log` | "routing", "confidence routing" (that is *one axis* inside a Decision, not a separate thing). |
| **Approval** | A human authorising a proposed action before it executes. | `automation_approvals` | "human review action", "sign-off". Distinct from *review* (which resolves machine uncertainty) — see the three human destinations in the Core Loop. |
| **Automation Intent** | A specific, already-authorised action queued for safe execution. | `automation_intent` / `automation_intent_states` | "controlled intent", "executable intent". |
| **Execution** | The Automation Engine actually performing an Automation Intent through a connector adapter. | `automation_execution_attempts` (append-only) | — |
| **Outcome** | The recorded result of an Execution, in three layers: execution result, operational outcome, business outcome. | `outcomes` (append-only) | The `observed\|reused\|rejected` field on the ingestion ledger is an *ingest* outcome, **not** a lifecycle Outcome. Do not conflate. |
| **Learning** | A captured correction or confirmed pattern that changes future behaviour — classified as universal, industry, or tenant. | `learning.ts` primitives, corrections, `objective_health` deltas | "improvement proposal". |
| **Knowledge** | The durable, queryable memory of the business that Learning accumulates into: the Business Graph plus the learned policies, patterns, and reconstructed workflows. | `graph_nodes` / `graph_edges` / `graph_events` + policy/config versions | "memory layer", "platform memory". The Business Graph **is** the relationship substrate of Knowledge. |

---

## The engines (each owns one question)

| Engine | The one question it answers | Canonical doc | Code |
|---|---|---|---|
| **Eligibility** | "Is this interaction worth understanding?" | [02_CORE_LOOP](02_CORE_LOOP.md) | `_shared/intelligence/eligibility.ts` |
| **Intelligence / Observation** | "What does this mean?" | [04_AI_ARCHITECTURE](04_AI_ARCHITECTURE.md), [reference/INTELLIGENCE_INGEST_BRIDGE](../reference/INTELLIGENCE_INGEST_BRIDGE.md) | `_shared/observation_ingest.ts` |
| **Decision Engine** | "Who or what owns the next move, and why?" | [reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md) | `_shared/intelligence/decision.ts` |
| **Operational Modes** | "How much is this business ready to let us act on its own?" | [reference/DECISION_ENGINE](../reference/DECISION_ENGINE.md) | `_shared/intelligence/modes.ts` |
| **Automation Engine** | "Is this authorised intent still safe to execute right now?" | [reference/AUTOMATION_ENGINE](../reference/AUTOMATION_ENGINE.md) | `_shared/intelligence/automation_guards.ts` |
| **Objectives & Outcomes** | "What is the business trying to achieve, and did we move it?" | [reference/OBJECTIVES_AND_OUTCOMES](../reference/OBJECTIVES_AND_OUTCOMES.md) | `_shared/intelligence/objectives.ts`, `objective_evaluation.ts` |
| **Identity** | "Who and what is this interaction about?" | [reference/INTERACTIONS_IDENTITY_CARDS](../reference/INTERACTIONS_IDENTITY_CARDS.md) | `_shared/identity.ts` |
| **Business Graph** | "How does everything connect?" | [03_BUSINESS_GRAPH](03_BUSINESS_GRAPH.md) | `business-graph-sync` |

**Operational Modes and the customer-maturity stages are the same five stages.**
The [Continuous Optimisation constitution](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md)
calls them Discovery → Recommendation → Assisted Automation → Trusted Automation →
Continuous Optimisation; the code calls them `discovery`, `recommendation`,
`assisted`, `trusted`, `optimisation`. They are one concept.

---

## Terms that collide (resolved here, once)

- **Agent vs Worker.** An **Agent** is a *product* concept: a configured AI worker
  with a name, an owner, permissions, confidence thresholds, and a health score,
  that a business can supervise (see [05_AGENTS](05_AGENTS.md)). A **Worker** is a
  *runtime* concept: the single `platform-worker` process that claims jobs off the
  queue and runs handlers (see [reference/BACKEND_RUNTIME](../reference/BACKEND_RUNTIME.md)).
  **They are never the same thing.** An Agent's work may be *carried out by* the
  Worker, but a Worker is not an Agent and no Agent is a Worker.

- **Automation.** As a proper noun, the **Automation Engine** is the execution
  layer. As a principle, "no silent automation" is a *guardrail stance*. Both are
  fine; never let "automation" drift to mean "any background job" — that is the
  **Worker/queue**, not Automation.

- **Card.** Two data models share the word. **Customer Card** = a projection row
  in `customer_cards`. **Live Call Card** = a real-time UI object backed by
  `live_call_sessions`. Always qualify "Live Call Card"; unqualified "Card" means
  Customer Card. See [reference/LIVE_CALL_CARD](../reference/LIVE_CALL_CARD.md).

- **Event.** Three tables, three meanings — always qualify:
  - **Platform event** (`platform_events`) — the domain event bus, e.g.
    `interaction.ready`. This is *the* event backbone.
    See [reference/EVENT_ARCHITECTURE](../reference/EVENT_ARCHITECTURE.md).
  - **Graph event** (`graph_events`) — a mutation of the Business Graph.
  - **Call event** (`live_call_events`) — a raw VoIP webhook event.

- **Entity vs Node.** The concept is an **Entity** (a person, company, job, asset).
  Its row in the Business Graph is a **node** (`graph_nodes`). The ingest bridge's
  `source_entities` are resolved graph nodes — same thing, prefer "entity/node".

- **Interaction status.** Canonical lifecycle is `pending → ready → enriched`.
  **`analysed` is a retired synonym for `ready`** — do not introduce it in new work.

- **Confidence enum.** Canonical, lowercase, five levels:
  `unknown · possible · likely · confirmed · rejected`. The uppercase variants and
  `unmatched` found in older docs are the same enum — normalise to this.

---

## Configuration & tenancy terms

| Term | Meaning |
|---|---|
| **Tenant** | One business running on ServiceOS. Everything is `tenant_id`-scoped. |
| **Tenant Operating Profile** | The layered configuration that makes the universal engine behave the way one tenant needs — objectives, policies, ownership, thresholds — resolved into an `effective_profiles` snapshot. |
| **Policy** | A declarative rule that governs behaviour (see [07_PROTOCOL](07_PROTOCOL.md)). Stored in `policies`, versioned. |
| **Protocol** | The tenant-facing name for the whole governed rule set: policies, response windows, SLAs, escalation, risk thresholds. |
| **Domain Pack** | A bundle of configuration that specialises the universal engine for an industry (field service, wholesale, …) without forking code. |
| **Config version** | Any governed configuration change. Canonical lifecycle: `draft → review → published → superseded → archived`. (An earlier brief proposed an extra `simulation` state; the implemented engines do not use it — simulation is a *capability*, not a lifecycle state.) |
| **OpenFolk** | The managed-intelligence control plane and the people who run it — the quality gate for uncertain intelligence and the continuous-improvement layer. In code, `openfolk-core` / `is_openfolk()` is the decision-authority layer, **not** a multi-tenant admin console (which does not exist yet). |

---

## Product surfaces (the eight screens)

Each screen answers exactly one question. This is the whole of the product IA;
anything else is a supporting panel or lives in Preview/Labs. See
[09_NAVIGATION](09_NAVIGATION.md).

| Screen | The one question |
|---|---|
| **Command Centre** | "What needs my attention?" |
| **Communications** | "What conversations are happening?" |
| **Customers** | "What do we know about this customer?" |
| **Operations** | "What work is flowing?" |
| **Learning Centre** | "What is the company continuously learning?" (Knowledge / Business Graph is a section within it) |
| **Agents** | "What AI workers exist?" |
| **Protocol** | "What rules govern behaviour?" |
| **Settings** | "How is ServiceOS configured?" |
