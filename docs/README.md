# ServiceOS Documentation

_The single source of truth for the ServiceOS platform. This is one coherent
engineering manual: read it top to bottom to understand the platform from first
principles through to implementation. Every future feature should have a clear home
in one of these documents; if it does not, the gap is architectural, not just
documentary._

Terminology is governed by one authority — [architecture/00_GLOSSARY](architecture/00_GLOSSARY.md).
One concept, one word, one owning document.

---

## Reading order

Read in this order the first time. Each layer assumes the one above it.

### 0 · Constitution — why we exist (read first, changes rarely)
The enduring beliefs. When a ticket and the constitution conflict, the constitution
wins.
- [foundation/OPENFOLK_PHILOSOPHY](foundation/OPENFOLK_PHILOSOPHY.md) — who we are and how we think.
- [foundation/OPENFOLK_CONTINUOUS_OPTIMISATION](foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md) — how we create value; the maturity model.
- [foundation/OPENFOLK_WEBSITE_BUSINESS_CASE](foundation/OPENFOLK_WEBSITE_BUSINESS_CASE.md) — the go-to-market and commercial case.

### 1 · Architecture — the operating manual (the numbered spine)
What we are building and why it works this way. Read in order.
- [00_GLOSSARY](architecture/00_GLOSSARY.md) — the canonical vocabulary. **The tie-breaker.**
- [01_PLATFORM](architecture/01_PLATFORM.md) — what ServiceOS is and is not; the layers; the twelve design principles.
- [02_CORE_LOOP](architecture/02_CORE_LOOP.md) — the one idea: Signal → … → Knowledge. **The heart.**
- [03_BUSINESS_GRAPH](architecture/03_BUSINESS_GRAPH.md) — entities, relationships, identity, and the database principles.
- [04_AI_ARCHITECTURE](architecture/04_AI_ARCHITECTURE.md) — how the system thinks and acts; confidence, safety, trust, override.
- [05_AGENTS](architecture/05_AGENTS.md) — the AI workforce; what an Agent may and may never do.
- [06_LEARNING_CENTRE](architecture/06_LEARNING_CENTRE.md) — the always-learning company feed (Overview/Health, Sources, Timeline, Knowledge/Graph); capture and learning; layered learning.
- [07_PROTOCOL](architecture/07_PROTOCOL.md) — the governed rule set; policies, SLAs, thresholds, versioning.
- [08_BACKEND_PRINCIPLES](architecture/08_BACKEND_PRINCIPLES.md) — the nine non-negotiable backend properties; security and the trust layer.
- [09_NAVIGATION](architecture/09_NAVIGATION.md) — the eight screens, one question each.
- [10_FRONTEND_PRINCIPLES](architecture/10_FRONTEND_PRINCIPLES.md) — the rules that keep the surface honest.

### 2 · Reference — the engine specs (build against these)
Precise, code-accurate contracts for each engine. Consult when implementing.
- [reference/EVENT_ARCHITECTURE](reference/EVENT_ARCHITECTURE.md) — the `interaction.ready` event bus and subscribers.
- [reference/BACKEND_RUNTIME](reference/BACKEND_RUNTIME.md) — the async queue and the 16 shared handlers.
- [reference/INTERACTIONS_IDENTITY_CARDS](reference/INTERACTIONS_IDENTITY_CARDS.md) — the deterministic Signal → Card → Recommendation stack.
- [reference/INTELLIGENCE_INGEST_BRIDGE](reference/INTELLIGENCE_INGEST_BRIDGE.md) — the Observation-stage seam.
- [reference/DECISION_ENGINE](reference/DECISION_ENGINE.md) — the Decision Engine and Operational Modes.
- [reference/AUTOMATION_ENGINE](reference/AUTOMATION_ENGINE.md) — safe execution of authorised intents.
- [reference/OBJECTIVES_AND_OUTCOMES](reference/OBJECTIVES_AND_OUTCOMES.md) — objectives, outcomes, and the evaluation worker.
- [reference/LIVE_CALL_CARD](reference/LIVE_CALL_CARD.md) — the real-time inbound-call surface.

### 3 · Operations — living runbooks
How the platform is run, verified, and monitored.
- [operations/SCHEDULER_OPERATIONS](operations/SCHEDULER_OPERATIONS.md) — every scheduled function, its secret, cadence, and cron deployment.
- [operations/OBSERVABILITY_HEALTH](operations/OBSERVABILITY_HEALTH.md) — the one health/freshness model; the authoritative cadence registry.
- [operations/VERIFICATION_AND_ACCEPTANCE](operations/VERIFICATION_AND_ACCEPTANCE.md) — input-reliability acceptance for phone and email.
- [operations/REMOTE_VERIFICATION_HARNESS](operations/REMOTE_VERIFICATION_HARNESS.md) — the safe remote verify CLI and the golden-loop suite.

### 4 · Roadmap — where it is going (living)
- [roadmap/IMPLEMENTATION_ROADMAP](roadmap/IMPLEMENTATION_ROADMAP.md) — the phased construction plan against the eight screens.

### Review
- [ARCHITECTURE_REVIEW_SUMMARY](ARCHITECTURE_REVIEW_SUMMARY.md) — how this documentation set was consolidated: what was reviewed, merged, removed, and rewritten; gaps, risks, and the next phase.

---

## How the documents relate

```
  Constitution (why)
        │
        ▼
  01 Platform ──▶ 02 Core Loop ──────────────┐  the whole system is this loop
        │              │                      │
        │      ┌───────┼──────────┐           │
        ▼      ▼       ▼          ▼            ▼
  03 Business  04 AI   05 Agents  06 Knowledge 07 Protocol   (the layers)
     Graph     Arch                              │
        │      │                                 │  each layer has an
        │      └──▶ reference/ engine specs ◀─────┘  engine spec in reference/
        ▼
  08 Backend Principles ──▶ operations/ runbooks   (how it runs, is verified, monitored)
        │
        ▼
  09 Navigation ──▶ 10 Frontend Principles ──▶ roadmap/   (what the user sees, and the build order)
```

---

## Conventions

- **Terminology** is fixed by [00_GLOSSARY](architecture/00_GLOSSARY.md). If a term
  is not there, or is used two ways, that is a bug to fix, not a choice to make.
- **Reality tags** — where a document describes a surface, it marks it **Live**
  (wired), **Foundation** (backend exists, surface partial), or **Preview** (not
  built; honest placeholder). Never document a Preview as if it were Live.
- **Archive** — [archive/](archive/) holds superseded and historical documents, each
  with a banner pointing to its replacement. Nothing there is maintained; it exists to
  preserve architectural history. Do not cite it as current.
- **Code is ground truth.** Where a document and the code disagree about a table or
  function name, the code wins and the document is wrong; fix it.

---

## Note on the two branches

The root [CLAUDE.md](../CLAUDE.md) describes the `main` branch, where ServiceOS is a
front-end demo with no backend. **This documentation describes the
`serviceos-backend-foundation` branch, which has a real Supabase Intelligence →
Automation backend** (54 migrations, ~45 edge functions). When reading CLAUDE.md's
"there is no backend" note, understand it applies to `main`, not to the platform this
manual documents.
