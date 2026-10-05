# The Platform

_What ServiceOS is, what it is not, and the shape of the whole thing. Start here
after the [constitution](../foundation/OPENFOLK_PHILOSOPHY.md); read
[02_CORE_LOOP](02_CORE_LOOP.md) next._

---

## What ServiceOS is

ServiceOS is an **AI operating system for service businesses**. It ingests
everything that happens inside a business — calls, emails, jobs, engineers,
invoices, suppliers, customers, documents, conversations, calendars — turns each of
those into understanding, decides what should happen next, does the safe part
itself, and asks a human about the rest. Then it measures the result and gets
better at the next one.

It is not an app the business opens now and then. It is the layer the business runs
*through*. The test, from the [Philosophy](../foundation/OPENFOLK_PHILOSOPHY.md), is
strict: if removing ServiceOS would not change how the business operates, we have
built a tool, not an operating system. The goal is that the business operates
*through* it.

Three names, one platform:

- **ServiceOS** — the operating system for service businesses (this repository).
- **ProductOS** — the same platform expressed for product/commerce businesses.
- **OpenFolk** — the managed intelligence and the people who make both better every
  month.

ServiceOS and ProductOS are **two domain expressions of one universal engine**,
never two engines. The difference between a plumber and a wholesaler lives in
[configuration](#configuration-not-forks), not in forked code.

---

## What ServiceOS is not, and why it is different

The category matters because it changes what "good" means.

| Category | What it does | Why ServiceOS is not that |
|---|---|---|
| **CRM** | A database of customers and deals that people update. | ServiceOS is not a system of record people maintain. It *derives* what it knows from what actually happened (interactions), and it acts. A CRM waits to be filled in; ServiceOS fills itself in and tells you what to do. |
| **PSA / service management (FSM)** | Schedules jobs, tracks engineers, raises invoices. | ServiceOS treats all of that as **input**, not as the product. Jobs and engineers are signals it understands and optimises around; running them is table stakes, understanding and improving them is the point. |
| **Automation platform** (Zapier, workflow builders) | Executes rules a human wired up. | ServiceOS decides *whether and how* to act using confidence, authority, risk, reversibility and objective impact — and it learns. An automation platform does exactly what it was told, forever; ServiceOS proposes, checks, acts, measures, and changes its own behaviour. |
| **"AI features" bolted onto software** | A chatbot or summary beside the real app. | ServiceOS's intelligence *is* the app. Understanding → decision → action → learning is the spine, not a sidebar. |

The one-sentence difference: **other systems store or execute; ServiceOS
understands, decides, acts, and improves.** Everything in this manual exists to make
that sentence literally true and continuously safe.

---

## The layered platform

ServiceOS is built as horizontal layers. Every layer is universal; tenants and
industries specialise on top through configuration.

```
  ┌─────────────────────────────────────────────────────────────────┐
  │  SURFACES        The eight screens — one question each            │  09, 10
  │                  Command Centre · Communications · Customers ·     │
  │                  Operations · Learning Centre · Agents ·           │
  │                  Protocol · Settings                               │
  ├─────────────────────────────────────────────────────────────────┤
  │  INTELLIGENCE    Understand → Decide → Act → Measure → Learn       │  04
  │                  Eligibility · Observation · Decision + Modes ·    │  reference/*
  │                  Automation · Objectives + Outcomes · Learning     │
  ├─────────────────────────────────────────────────────────────────┤
  │  KNOWLEDGE       The Business Graph + learned policies & patterns  │  03, 06
  │                  (the durable memory the loop reads and writes)    │
  ├─────────────────────────────────────────────────────────────────┤
  │  RUNTIME         Event bus · async worker queue · handlers ·       │  08
  │                  schedulers  (event-driven, replayable, audited)   │  reference/*
  ├─────────────────────────────────────────────────────────────────┤
  │  INPUTS          Connectors turn the outside world into            │  reference/*
  │                  Interactions  (phone, email, and — by config —    │
  │                  jobs, calendars, documents, finance, …)           │
  └─────────────────────────────────────────────────────────────────┘
         governed throughout by  PROTOCOL (07)  ·  operated by  OPENFOLK
```

A signal enters at the bottom, becomes an interaction, rises through knowledge and
intelligence as understanding, and — where policy permits — comes back down as an
action, whose outcome feeds learning. That round trip is [the Core
Loop](02_CORE_LOOP.md), and it is the reason every layer exists.

---

## <a id="configuration-not-forks"></a>Configuration, not forks

There is no `if tenant == …` anywhere in the design. A tenant's behaviour lives in
data — its [Tenant Operating Profile](00_GLOSSARY.md#configuration--tenancy-terms):
objectives, policies, ownership rules, review thresholds, and domain packs. The
engine stays one engine; the behaviour becomes tenant-specific through configuration
that is comprehensible, versioned, and owned by an accountable human. This is what
lets one platform serve a heating company and a wholesaler without becoming two
platforms.

---

## The twelve design principles

These are the working rules every feature is measured against. They are the
engineering consequences of the [Philosophy](../foundation/OPENFOLK_PHILOSOPHY.md)
and [Continuous Optimisation](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md)
constitution; where a principle here and the constitution ever conflict, the
constitution wins.

1. **Simple over clever.** The operating system a business depends on is judged by
   reliability, not novelty. Prefer the boring, legible mechanism.
2. **AI assists before AI acts.** Every capability earns autonomy by first proving
   itself as a recommendation. Trust is manufactured in [Operational
   Modes](../reference/DECISION_ENGINE.md), never assumed.
3. **Humans remain accountable.** AI performs work; humans provide judgement. The
   customer's own authority (spend, refunds, legal commitments) always stays with
   the customer.
4. **No black boxes.** Every observation, decision, and action carries its evidence
   and its reason codes. If the system cannot explain why, it may not act.
5. **Explain every decision.** A Decision is an immutable, replayable record — the
   inputs, the axes, the destination, and why. Explanation is a stored artefact, not
   a courtesy.
6. **Trust is more important than automation.** The day low-confidence output
   reaches a customer unreviewed, or a customer's authority is exercised without
   them, we have spent the trust the company is built on. Guard that gate in both
   directions.
7. **Architecture before features.** A feature with no architectural home is a
   liability. Everything lands in a layer of this manual or it does not land.
8. **Platform before modules.** Model what all businesses share first; let
   industries and tenants specialise on top. Never the reverse.
9. **One source of truth.** One concept, one word, one owning document, one table.
   Duplication of intelligence, actions, ownership, or vocabulary is a defect.
   ([00_GLOSSARY](00_GLOSSARY.md) enforces this.)
10. **Composable systems.** The event bus lets any capability react, learn, or be
    replayed without the producer knowing the consumer exists. New capability is
    "subscribe and read", not "re-wire".
11. **Small surfaces, deep capability.** Each screen answers one question; the depth
    lives behind it. Feature accumulation on a surface is how an operating system
    decays back into an app.
12. **Everything measurable, auditable, versioned.** If we cannot measure its effect
    on an objective, prove why it happened, and roll it back, we do not trust it.
    This is the non-negotiable floor under [Backend
    Principles](08_BACKEND_PRINCIPLES.md).

The single question every feature must pass, from the Philosophy: **does this
improve how the business operates?** And its sharper form, from Continuous
Optimisation: **which of the business's objectives does this move, and by how
much?** A feature that cannot draw that line is waiting to be justified.

---

## How to read the rest of this manual

- **Why we exist** → the [constitution](../foundation/OPENFOLK_PHILOSOPHY.md) and
  [Continuous Optimisation](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md).
- **The one idea** → [02_CORE_LOOP](02_CORE_LOOP.md).
- **What the system knows** → [03_BUSINESS_GRAPH](03_BUSINESS_GRAPH.md),
  [06_LEARNING_CENTRE](06_LEARNING_CENTRE.md).
- **How it thinks and acts** → [04_AI_ARCHITECTURE](04_AI_ARCHITECTURE.md) and the
  engine specs in [`reference/`](../README.md).
- **The AI workforce and its rules** → [05_AGENTS](05_AGENTS.md),
  [07_PROTOCOL](07_PROTOCOL.md).
- **How it runs** → [08_BACKEND_PRINCIPLES](08_BACKEND_PRINCIPLES.md).
- **What the user sees** → [09_NAVIGATION](09_NAVIGATION.md),
  [10_FRONTEND_PRINCIPLES](10_FRONTEND_PRINCIPLES.md).
- **Where it is going** → [roadmap/IMPLEMENTATION_ROADMAP](../roadmap/IMPLEMENTATION_ROADMAP.md).
