# Protocol

_The rules that govern how the platform behaves for a business. This screen answers
one question: **"What rules govern behaviour?"** Protocol is the configuration that
makes the universal engine act the way one tenant needs, and it is the boundary
inside which every [Agent](05_AGENTS.md), [Decision](../reference/DECISION_ENGINE.md),
and [action](../reference/AUTOMATION_ENGINE.md) must stay._

> **Status.** The governing mechanisms are real: operational modes
> (`20260719120000_operational_modes.sql`), the policy primitive (`policy.ts`), and
> the Decision Engine's risk and authority axes all enforce Protocol server-side.
> The Protocol *screen* is currently a Preview over demo parameters; it becomes real
> by binding to these existing configuration surfaces.

---

## What Protocol is

Protocol is the tenant-facing name for the whole **governed rule set**: the business
rules, response windows, SLAs, escalation paths, policies, compliance obligations,
and risk thresholds that decide what the platform may do on its own, what it must ask
about, and how fast it must respond. It is the single place a business (with OpenFolk)
answers "how should ServiceOS behave for us?", and it is the reason the same universal
engine can run a heating company and a wholesaler without forked code
([configuration, not forks](01_PLATFORM.md#configuration-not-forks)).

Protocol is **data, not code**. There is no `if tenant == …` anywhere; behaviour
lives in the [Tenant Operating Profile](00_GLOSSARY.md#configuration--tenancy-terms),
and Protocol is the human-legible face of that profile.

---

## What Protocol governs

### Business rules
The declarative statements of how this business wants work handled: which
interactions matter, who owns what, what "good" looks like. These become
[policies](#policies-the-unit-of-protocol) the engines evaluate.

### Response windows & SLAs
How quickly the business commits to responding and completing, by channel and by
customer tier. Response windows are what turn a passive observation ("this complaint
arrived") into a time-bound obligation ("and it must be acknowledged within N
minutes"), which the platform then tracks and escalates against. An SLA breached, or
about to breach, is one of the clearest things the [Command Centre](09_NAVIGATION.md)
surfaces as "needs attention".

### Escalation
Where work goes when it cannot be handled where it is: to the on-call person, to a
senior, to OpenFolk, or to the customer. Escalation in Protocol is the *policy* ("a
red-graded complaint escalates to the account owner within 15 minutes"); the
[Decision Engine](../reference/DECISION_ENGINE.md) is the *mechanism* that routes an
individual case. Protocol says who and when; the engine does it.

### Risk thresholds
The bar above which the platform must stop and ask. Risk and reversibility are two of
the Decision Engine's five axes; Protocol sets, per tenant, where those axes trip
from "act" to "require approval" to "escalate". Raising a threshold grants more
autonomy; lowering it pulls a human back in. This is the dial a business turns as its
trust grows.

### Compliance
The obligations the business must meet and prove: certifications, registrations,
deadlines, required documents, and their current state. Compliance is
[knowledge](06_LEARNING_CENTRE.md) the platform tracks and a set of policies it enforces,
so an approaching deadline or a missing document becomes a surfaced, owned action
rather than a surprise. (Compliance detail is surfaced within
[Operations](09_NAVIGATION.md); the rules that drive it live here.)

---

## Human ownership

Every Protocol rule has an **accountable human owner**. Protocol is where the
platform records who is responsible for a class of decision, so that when the
Decision Engine routes to "tenant senior review" or "customer approval", there is a
real, named person on the other end. This is the operational expression of the
[constitution's](../foundation/OPENFOLK_PHILOSOPHY.md) rule that the customer's
authority stays with the customer: Protocol is where that authority is assigned, not
assumed. A rule with no owner is a defect.

---

## Policies: the unit of Protocol

A **Policy** is a single declarative rule the engines evaluate (`policies`, governed
by `policy.ts`). Policies are what make Protocol executable rather than aspirational:
a response window is a policy, a risk threshold is a policy, an escalation path is a
policy. The [Decision Engine](../reference/DECISION_ENGINE.md) consults the applicable
policies for every object, which is how a business's stated rules become the machine's
actual behaviour. Where no policy covers a situation, the engine does not guess; it
routes to a human, and the gap becomes a candidate for a new policy
([Learning](06_LEARNING_CENTRE.md)).

---

## Parameter management

Most of Protocol is a set of **parameters** a business tunes: the numbers in the
response windows, the levels of the risk thresholds, the tiers of customers, the
recipients of escalations. Parameter management is deliberately a first-class,
legible surface, not a settings page nobody understands, because the
[design principle](01_PLATFORM.md) is that configuration only earns its place when it
is comprehensible and owned. A thousand opaque knobs is worse than a little honest
branching; Protocol keeps the knobs few, named, and accountable.

---

## Protocol versioning

Nothing in Protocol changes silently. Every rule and parameter is **versioned** on
the canonical config lifecycle `draft → review → published → superseded → archived`
([glossary](00_GLOSSARY.md#configuration--tenancy-terms)), so that:

- every behaviour change is attributable to a person and a moment,
- the platform can explain "we did that because this policy was in force then",
- and any change can be **rolled back**.

Because Decisions are [immutable and replayable](../reference/DECISION_ENGINE.md), a
Protocol change can be simulated against history before it is published: "if this new
risk threshold had been in force last month, what would have changed?" Versioning is
what makes Protocol safe to evolve, which is the whole point of putting behaviour in
configuration in the first place.

---

## Monitoring

Protocol is watched, not just set. The platform monitors whether the rules are being
met (SLAs held, escalations honoured, thresholds not silently breached) and whether
the rules are still right (a policy that produces a steady stream of exceptions is a
policy to change, not an exception stream to keep clearing). This is the
[slow loop](02_CORE_LOOP.md#two-loops-two-altitudes) pointed at Protocol itself:
**every avoidable, recurring intervention is a signal that a rule, not the staffing,
needs to change.**

---

## Why Protocol is its own layer

Autonomy without governance is recklessness; governance buried in code is
un-auditable and un-tunable. Protocol is the single, versioned, human-owned layer
where a business decides how much it trusts the platform and under what rules, and
where that decision is enforced by every engine automatically. It is the counterpart
to the [AI Architecture](04_AI_ARCHITECTURE.md): the AI decides *within* the bounds
Protocol sets, and the business owns the bounds.
