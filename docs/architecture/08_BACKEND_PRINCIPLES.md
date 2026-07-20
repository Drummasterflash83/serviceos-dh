# Backend Principles

_The non-negotiable properties every backend capability must have. These are not
aspirations; they are the floor. A capability that violates one of them is not
"lower quality", it is not shippable. The mechanisms that deliver them are specified
in [reference/EVENT_ARCHITECTURE](../reference/EVENT_ARCHITECTURE.md) and
[reference/BACKEND_RUNTIME](../reference/BACKEND_RUNTIME.md); this document says why
they are mandatory._

---

## The nine properties

Everything the backend does must be **event-driven, observable, explainable,
auditable, recoverable, measurable, replayable, permissioned, and attributable.**
Each earns its place because the platform is the layer a business *runs on*, and a
foundation you cannot see into, prove, or undo is not a foundation.

### Everything is event-driven
A capability's only obligation to the rest of the system is to **narrate what it
did** on the [event bus](../reference/EVENT_ARCHITECTURE.md) (`platform_events`,
e.g. `interaction.ready`). It does not call the next stage; it announces, and
whoever cares subscribes. This is what makes the platform composable: new capability
is "subscribe and read", not "re-wire the producer". A connector's entire job is to
produce a canonical interaction and publish that it is ready; it knows nothing about
identity, cards, or intelligence downstream.

### Everything is observable
Every unit of work is a durable row you can query, not a log line that scrolls away.
The [queue](../reference/BACKEND_RUNTIME.md) is a table (`platform_jobs`); sync runs,
health, and cadence are tables and views ([observability](../operations/OBSERVABILITY_HEALTH.md)).
"What is the system doing right now, and is it healthy?" is answerable by SELECT, at
any time, by an operator.

### Everything is explainable
No capability may take a consequential step it cannot justify. Observations carry the
signals that fired; [Decisions](../reference/DECISION_ENGINE.md) carry their axes and
reason codes; edges and identities carry their evidence and confidence. "Why did the
system conclude / decide / do that?" is always answerable from stored artefacts. A
black box may not act ([design principle 4](01_PLATFORM.md)).

### Everything is auditable
Every consequential action is an **append-only, immutable record**: `decision_log`,
`automation_execution_attempts`, `outcomes`, `audit_logs`, the several
[histories](03_BUSINESS_GRAPH.md#database-principles). History is never updated in
place, only appended and superseded, so the record of what happened cannot be
quietly rewritten.

### Everything is recoverable
Failure is expected and designed for, not hoped against. The queue leases work,
retries with backoff, and dead-letters what will not succeed; projections rebuild
from source; external effects are idempotent so a retry cannot double-act. A stalled
or failed stage degrades honestly and can be resumed or replayed, never leaving the
system in a state no one can reason about.

### Everything is measurable
If a capability's effect on an [objective](../reference/OBJECTIVES_AND_OUTCOMES.md)
cannot be measured, the platform does not trust it. Outcomes are first-class and
recorded in three layers; objective health is evaluated from real measurements. This
is the backend expression of the company rule: we measure objectives moved, not tasks
done.

### Everything is replayable
Because inputs are captured as immutable events and Decisions are pure, deterministic
functions of their inputs, the system can be **replayed**: a past sequence can be
re-run, and a proposed change ("if this policy had been in force last month…") can be
simulated against history before it is published. Replayability is what makes the
platform safe to change.

### Everything is permissioned
Writes happen only through service-role Edge Functions with validation; the browser
never mutates tables. Reads are tenant-scoped under RLS. Every table carries
`tenant_id`, and tenant isolation is a database invariant, not an application
courtesy. Capabilities with external effects stay disabled until explicitly enabled.
(See [Security & Trust](#security--trust) below.)

### Everything is attributable
Every action traces to an actor and an authority: which [Agent](05_AGENTS.md) or
engine did it, under which [Decision](../reference/DECISION_ENGINE.md), permitted by
which [Protocol](07_PROTOCOL.md), on behalf of which tenant. There is no anonymous
action. Attribution is what makes accountability real rather than rhetorical.

---

## Why these are the floor, not the ceiling

A business hands its operations to ServiceOS only if it can trust the machine, and
trust is not a feature you add later. It is the sum of these nine properties: you can
see what the system did (observable), understand why (explainable), prove it later
(auditable), measure whether it helped (measurable), undo it (recoverable,
replayable), and know exactly who was allowed to do it (permissioned, attributable),
all because capabilities communicate by narrating events rather than reaching into
each other (event-driven). Weaken any one and the whole proposition — an operating
system a business runs *through* — weakens with it. That is why these are enforced at
the foundation and not left to the discretion of individual features.

---

## <a id="security--trust"></a>Security & the Trust Layer

Security in ServiceOS is not a separate module; it is the permissioned + attributable
+ auditable properties above, made concrete:

- **Tenant isolation by RLS.** Every table is `tenant_id`-scoped; tenant-scoped
  `SELECT` policies gate all reads; both ends of a [graph edge](03_BUSINESS_GRAPH.md)
  are written under one tenant, so cross-tenant links cannot exist.
- **Writes only through the server.** No service role in the browser; all mutations
  go through validated Edge Functions (`_shared/authz.ts`, `webhook_tenant`
  guards). This is enforced across the migration set, not aspirational.
- **No secrets or raw PII in derived data.** Evidence stores the source and a short
  detail, never transcript, audio, or credentials.
- **External effects gated.** Capabilities that touch the outside world stay disabled
  until deliberately enabled; the [Automation Engine](../reference/AUTOMATION_ENGINE.md)
  re-checks safety at execution time.

The **Trust Layer** is the union of this security posture and the
[AI architecture's](04_AI_ARCHITECTURE.md) confidence, escalation, and human-override
guarantees. Trust is not a claim the product makes; it is a set of properties the
backend can demonstrate on demand. The
[verification harness](../operations/REMOTE_VERIFICATION_HARNESS.md) and the
[golden-loop suite](../operations/VERIFICATION_AND_ACCEPTANCE.md) exist to prove these
properties hold on the live system, not just in intent.
