# Learning Centre

_The always-learning company feed: what ServiceOS is continuously learning from every
enabled input, and how that learning becomes durable knowledge. This screen answers
one question: **"What is the company continuously learning?"** It is a first-class
[Intelligence surface](09_NAVIGATION.md), and it is where [the Core
Loop](02_CORE_LOOP.md) visibly closes: Outcomes become Learning, Learning becomes
durable memory, and that memory makes every future decision better._

> **Distinct from Communications.** [Communications](09_NAVIGATION.md) shows the
> **conversations** the business is having (calls, emails). The Learning Centre shows
> **what ServiceOS is learning** from all enabled inputs together, conversations plus
> jobs, documents, and every other signal. One is the raw dialogue; the other is the
> understanding the platform is accumulating from it. Keep them separate.

> **Status.** The memory substrate (the [Business Graph](03_BUSINESS_GRAPH.md)) and a
> learning primitive (`learning.ts`) exist; the Learning Centre *surface* is a Preview
> built on that foundation. This document defines the target so it is built to the
> architecture, not invented ad hoc.

---

## The four sections of the Learning Centre

The screen is organised into four sections, in this order. Together they answer "what
is the company learning, from what, how fresh is it, and what does it now know?"

| Section | Shows | Backed by | Reality |
|---|---|---|---|
| **Overview / Learning Health** | Is the system learning well? A single health read across the whole knowledge store: how much is current, corroborated, and confident versus stale, conflicting, or thin. | `graph_events` (`graph.conflict_detected`), objective/learning history, [system-health](../operations/OBSERVABILITY_HEALTH.md) | Foundation |
| **Sources** | Every enabled input the company learns from, and its live status. Only genuinely connected ingestion pipelines are "live"; the rest are labelled honestly. | connector registry + `tenant_connectors` | Foundation (see [Sources](#sources-what-we-learn-from)) |
| **Learning Timeline** | The live stream of understanding as it forms: new interactions understood, observations made, entities and relationships learned, outcomes recorded. | `platform_events`, `intelligence_objects`, `graph_events` | Foundation |
| **Knowledge / Business Graph** | What the company now knows: the durable [Business Graph](03_BUSINESS_GRAPH.md) of entities and relationships, plus learned policies and patterns. | `graph_nodes` / `graph_edges` | Live (graph) |

The rest of this document defines the concepts these sections surface.

---

## The two layers: capture and learning

Learning has a **capture layer** (how understanding enters) and a **learning layer**
(how understanding improves), and they must never be confused.

**The capture layer** is everything the platform comes to know by observing the
business: interactions, resolved [entities and relationships](03_BUSINESS_GRAPH.md),
Observations, and Outcomes. It is largely automatic, a by-product of the loop
running. Its home is the Business Graph plus the intelligence history. This is what
the **Learning Timeline** section streams.

**The learning layer** is how the platform gets *better* at understanding and
acting: corrections captured, patterns detected, policies improved, workflows
reconstructed. It is the deliberate distillation of many captured facts into fewer,
reusable lessons. Its home is the learned policies, patterns, and configuration
versions, plus the `objective_health` record of what actually moved. This is what the
**Overview / Learning Health** section measures.

Capture answers "what do we know?"; learning answers "what have we figured out?" A
platform that only captures is a database; a platform that learns is an operating
system.

---

## <a id="sources-what-we-learn-from"></a>Sources: what we learn from

The **Sources** section is where honesty about connector status matters most. A
source is only shown as **live** when a real ingestion pipeline is actively producing
interactions. The rest are labelled by their true state, never dressed up:

| State | Meaning | Examples today |
|---|---|---|
| **Live** | An active ingestion pipeline exists and is producing interactions | **Simwood phone**, **Gmail / Google Workspace email** |
| **Foundation** | Schema and some plumbing exist; not yet an active pipeline | (per-connector, verify against code before claiming) |
| **Planned** | Catalogued with intent to build; adapter not built | Commusoft, Microsoft 365 |
| **Catalogue / Aspirational** | Listed in the registry as a future possibility only | Slack, documents/RAG, and other catalogue entries |

The registry may list ~24 connectors; that is the catalogue, not the live footprint.
The Sources section must reflect the **code reality** (only Simwood phone and Gmail/
Workspace email are confirmed live), and show everything else as Planned, Catalogue,
or Aspirational. A source that shows "connected" when nothing is ingesting is exactly
the fabricated-data failure the [frontend principles](10_FRONTEND_PRINCIPLES.md)
forbid.

---

## The four kinds of knowledge

The platform is aiming to hold four distinct kinds of company knowledge. Naming them
keeps the Learning Centre from becoming a junk drawer.

| Kind | What it is | Where it lives | Reality |
|---|---|---|---|
| **Business knowledge** | How this company is structured and connected: its people, customers, suppliers, org, services | [Business Graph](03_BUSINESS_GRAPH.md) | Live |
| **Customer knowledge** | What is true about each customer relationship: history, value, sentiment, risk, preferences | `customer_cards` + interactions + graph | Live |
| **Operational knowledge** | How work actually flows: the real processes, their bottlenecks, their exceptions | reconstructed from interactions and events | Target |
| **Compliance knowledge** | Obligations, certifications, deadlines, evidence, and their state | configuration + documents | Target (surfaced in [Operations](09_NAVIGATION.md)/Protocol) |

Each kind is a different question the loop can answer, and each accumulates from the
same captured signals.

---

## Knowledge: memory (the fourth section)

**Knowledge is the durable, queryable form of what the company has learned**, and it
is the Learning Centre's fourth section. Its substrate is the [Business
Graph](03_BUSINESS_GRAPH.md): a tenant-scoped store of entities and relationships that
any capability can read rather than re-deriving. Memory is what lets today's
Observation be informed by everything learned before it, so the system does not start
from zero on every interaction. When a document, RAG, or embeddings capability is
added, it extends this same memory layer; it does not create a second one. There is
one memory, and the graph is its spine.

"Knowledge" is therefore both a [Core Loop stage](02_CORE_LOOP.md) (the durable memory
the loop writes) and a section of this screen (where a human explores it). It is not a
separate top-level screen; it lives here, inside the Learning Centre.

---

## Workflow reconstruction

The platform does not ask a business to document its processes; it **reconstructs
them from what actually happened**. By reading the ordered stream of interactions and
[events](../reference/EVENT_ARCHITECTURE.md) against the graph, it infers the real
workflow, the one that is executed rather than the one on the org chart, including
the steps, the hand-offs, and the points where work stalls or exceptions cluster.
This is operational knowledge, and it is the input to two things: telling the
business where its bottlenecks really are, and discovering what is worth automating.

(This is the capability formerly sketched as "Workflow Intelligence / Process
Mining" beside the [Live Call Card](../reference/LIVE_CALL_CARD.md); it belongs here,
in the Learning Centre, not on a real-time call surface.)

---

## Automation-candidate discovery

Reconstructed workflows are how the platform finds **automation candidates**: a step
that recurs, is well-understood, is low-risk, and is currently done by hand is a
candidate to be automated or, better, eliminated. This is where learning feeds the
[slow loop](02_CORE_LOOP.md#two-loops-two-altitudes): the platform proposes not just
"do this task" but "this whole class of task should stop needing a human". Crucially,
the highest form of optimisation is often **elimination, not automation** ([Continuous
Optimisation](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md)); a discovery layer
that only ever proposes automation will automate waste. Candidates are proposals,
routed and approved like any other action; the Learning Centre suggests, the loop
governs.

---

## Learning is layered (a boundary of trust)

Every lesson the learning layer captures is classified into exactly one of three
layers, and **the layers never blur**:

- **Universal learning** is true for everyone. The engine gets smarter for all
  tenants.
- **Industry learning** is true for a trade or sector. It is shared within it.
- **Tenant learning** is true for one business. It is theirs alone.

This is not architectural tidiness; it is a **safety boundary**. A single tenant's
private pattern leaking into universal learning is a breach of confidence, not a bug.
The boundaries between the layers are treated exactly like the boundary around a
customer's data, because that is what they are. This layering is what lets every
customer improve the platform for the next without any customer's private reality
travelling: universal lessons move, private ones stay home.
([Constitution, discovery #7.](../foundation/OPENFOLK_PHILOSOPHY.md))

---

## Knowledge health, decay & confidence

Knowledge is not automatically trustworthy just because it was once learned. Three
properties keep it honest, and together they drive the **Overview / Learning Health**
section:

**Knowledge confidence.** Every learned fact and inferred relationship carries a
confidence, exactly as [graph edges](03_BUSINESS_GRAPH.md) do. The platform never
presents an inference as a certainty, and confidence is an input to every decision
that reads it.

**Knowledge decay.** Knowledge ages. A customer preference from three years ago, a
process that has since changed, a contact who has left, all become less reliable over
time. The platform models decay so stale knowledge loses confidence rather than
silently misleading a decision. Fresh evidence refreshes it; absence of evidence
erodes it.

**Knowledge health.** Across the whole store, health is the measure of how much of
what the platform "knows" is current, corroborated, and confident, versus stale,
conflicting (`graph.conflict_detected`), or thin. Knowledge health is a first-class
signal to OpenFolk: a tenant whose knowledge health is falling is one the platform is
quietly getting wrong, and that is a reason to act before any individual decision
fails.

---

## Why the Learning Centre is its own surface

Understanding, decisions, and actions are all worthless if the system cannot
remember, cannot improve, or cannot tell fresh knowledge from stale. The Learning
Centre is the surface that makes the always-learning company visible: what it is
learning, from which inputs, how fresh that knowledge is, and what it now knows. It is
the layer that turns a sequence of individual loop runs into a business that gets
measurably better every month, without leaking any one customer's reality into
another's. It is, in the end, the entire thesis of the company made legible: every
customer improves the intelligence, the intelligence improves the platform, and the
platform improves every future customer.
