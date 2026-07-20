# Agents

_The AI workforce: what an Agent is, what it may and may never do, and how it is
supervised. This screen answers one question: **"What AI workers exist?"** Agents are
the product-level abstraction over the [AI architecture](04_AI_ARCHITECTURE.md);
they are governed by [Protocol](07_PROTOCOL.md) and run their actions through the
[Automation Engine](../reference/AUTOMATION_ENGINE.md)._

> **Status.** The Agents *concept* is fully defined by the engines that already
> exist (eligibility, decision, modes, automation, objectives). The Agents *screen*
> is currently a Preview surface; it becomes real by naming and configuring these
> engines as supervised workers, not by building a new engine. See
> [09_NAVIGATION](09_NAVIGATION.md).

---

## What an Agent is

An **Agent** is a named, owned, permissioned AI worker that performs a defined kind
of work within a business, under supervision. It is a *configuration* of the
universal intelligence pipeline pointed at one job (for example: triage inbound
complaints, chase overdue further-works quotes, keep customer records resolved),
given a name, an accountable owner, a set of permissions, confidence thresholds, an
approval mode, and a health score.

An Agent is **not** a background job runner. The runtime thing that claims jobs and
executes handlers is the **Worker** (`platform-worker`), a wholly different concept
([glossary](00_GLOSSARY.md#terms-that-collide-resolved-here-once)). An Agent's work
may be *carried out by* the Worker, but the Agent is the supervised, business-facing
actor; the Worker is anonymous plumbing. Keep them distinct in code, docs, and UI.

An Agent is also not a chatbot. It is a participant in [the Core
Loop](02_CORE_LOOP.md): it observes, it is granted (by the [Decision
Engine](../reference/DECISION_ENGINE.md)) the right to propose or act, it executes
within limits, and its outcomes are measured and learned from.

---

## What an Agent owns

An Agent owns a **slice of the loop for a defined domain of work**:

- the Observations in its domain (what it is allowed to look at),
- the Recommendations it may raise,
- the Automation Intents it is permitted to execute,
- the Outcomes attributed to it, and therefore its own health.

Ownership is scoped and explicit. Two Agents never own the same action; if a piece
of work could belong to either, the [Protocol](07_PROTOCOL.md) assigns it, so there
is a single accountable actor for every action ([one source of truth](01_PLATFORM.md)).

---

## What an Agent can never do

These are hard limits, enforced by the engines, not by the Agent's own judgement:

1. **Exceed its permissions.** An Agent may only act on the capabilities explicitly
   granted to it. Ungranted capabilities are not "discouraged", they are unreachable.
2. **Exercise the customer's authority.** High-value spend, refunds, discounts, and
   legal or contractual commitments are the customer's decision. An Agent may prepare
   them; it may never make them. ([Constitution, discovery #5.](../foundation/OPENFOLK_PHILOSOPHY.md))
3. **Act below its confidence threshold.** If confidence is insufficient, the
   Decision Engine routes to review; the Agent does not get to act on a hunch.
4. **Act outside policy.** Behaviour outside the [Protocol](07_PROTOCOL.md) (response
   windows, risk thresholds, escalation rules) is blocked or escalated, never
   improvised.
5. **Take an irreversible or out-of-limit action without approval.** Reversibility
   and impact are Decision axes; beyond delegated limits, a human approves first.
6. **Act invisibly.** Every Agent action is an audited, attributable record. An Agent
   that could act without leaving a trace is a design failure.

The first limit an Agent hits does not fail silently; it produces an escalation to
the correct human ([Approval](02_CORE_LOOP.md#6-decision--approval)).

---

## Approval modes

An Agent's **approval mode** is the ceiling on its autonomy, and it is the same idea
as the tenant's [Operational Mode](../reference/DECISION_ENGINE.md) applied to one
worker:

| Mode | The Agent may… | A human… |
|---|---|---|
| **Observe** | look and understand only | sees everything; nothing acts |
| **Recommend** | propose actions | approves every action before it happens |
| **Assisted** | execute low-risk, well-understood actions | supervises; approves the rest |
| **Trusted** | execute within its domain autonomously | sees exceptions only |
| **Optimise** | act and propose improvements to its own policies | reviews the improvements |

An Agent earns its way up this ladder on evidence, exactly as a tenant does. Nothing
starts Trusted. The customer's confidence, not the platform's eagerness, sets the
pace.

## Execution permissions & confidence thresholds

Permissions are the *set* of capabilities an Agent may invoke; confidence thresholds
are the *bar* it must clear to invoke them without approval. Both are configuration
([Tenant Operating Profile](00_GLOSSARY.md#configuration--tenancy-terms)), versioned
and owned by an accountable human, never hard-coded. A capability with external
effects stays disabled until deliberately enabled. The [Decision
Engine](../reference/DECISION_ENGINE.md) enforces the threshold per action; the
[Automation Engine](../reference/AUTOMATION_ENGINE.md) re-checks the permission at
execution time.

---

## Lifecycle

An Agent moves through a governed lifecycle, and every transition is a versioned,
audited event:

**Defined** (its domain, owner, and permissions are configured) → **Observing**
(watching its domain, acting on nothing) → **Recommending** (proposing, human
approves) → **Assisted** / **Trusted** (executing within earned limits) →
**Optimising** (improving its own policies) → **Retired / superseded** (replaced by
a better configuration; its history is preserved, never deleted).

Promotion up the lifecycle requires evidence from Outcomes; demotion is automatic if
health degrades. No stage is skippable.

---

## Monitoring, health & auditing

Because an Agent owns its Outcomes, it has a **health score** derived from real
results, not from activity: are its actions succeeding, are its recommendations being
accepted, are its outcomes moving the objectives it serves, is its correction rate
falling over time? A busy Agent with poor outcomes is unhealthy; a quiet Agent with
reliable outcomes is healthy. Health is measured the way the platform measures
everything: by objectives moved, not tasks done
([Continuous Optimisation](../foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md)).

Every Agent keeps an **append-only history** ([agent history](03_BUSINESS_GRAPH.md#database-principles)):
every action, every decision it was granted, every outcome, every health change. An
Agent's behaviour is therefore always auditable and always attributable to an
accountable owner. If health falls below policy, monitoring escalates and the Agent
is automatically stepped down a mode until the cause is understood.

---

## Learning

An Agent is only worth having if it gets better. Every correction to an Agent's work
is captured as [Learning](06_LEARNING_CENTRE.md), classified by layer (universal / industry
/ tenant), and turned into a configuration or policy change so the same correction is
not needed twice. **Every avoidable intervention on an Agent is a defect in that
Agent's configuration**, and the fix is to change the configuration, not to keep
correcting the symptom. Over time an Agent's human touches should get rarer and
higher, because the routine has been optimised out. That trajectory, per Agent, is
the whole product working.
