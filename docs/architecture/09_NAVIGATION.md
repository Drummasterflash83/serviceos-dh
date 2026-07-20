# Navigation & Information Architecture

_The definitive product surface. Eight screens, each answering exactly one question.
This supersedes every earlier navigation proposal (the old four-section IA, the
"New Dawn engine" spine, and the interim Learning-Centre nav); where any of those
disagree with this document, this document wins. Read
[10_FRONTEND_PRINCIPLES](10_FRONTEND_PRINCIPLES.md) next for the rules that keep it
this way._

---

## The eight screens

Navigation reflects the [architecture](01_PLATFORM.md), not the order things were
built. There are eight screens, in priority order, and **each answers one question,
never several:**

| # | Screen | The one question | Reality |
|---|---|---|---|
| 1 | **Command Centre** | "What needs my attention?" | Live |
| 2 | **Communications** | "What conversations are happening?" | Live |
| 3 | **Customers** | "What do we know about this customer?" | Live |
| 4 | **Operations** | "What work is flowing?" | Foundation |
| 5 | **Learning Centre** | "What is the company continuously learning?" | Foundation |
| 6 | **Agents** | "What AI workers exist?" | Preview |
| 7 | **Protocol** | "What rules govern behaviour?" | Foundation |
| 8 | **Settings** | "How is ServiceOS configured?" | Live |

_Reality tags: **Live** = wired to the real backend; **Foundation** = the backend
exists, the surface is partial; **Preview** = the backend is not built, so the
screen is an honest placeholder, never a fabricated dashboard._

Everything that is not one of these eight either **supports** one of them,
**integrates into** one of them, or moves to **Preview/Labs** until its backend is
real. The justification for that severity is below.

---

## Why only eight, and why this order

The [frontend audit](../archive/FRONTEND_ALIGNMENT_AUDIT.md) found the truth plainly:
the backend is an operating system, but the frontend had grown to ~27 nav items of
which only a handful were wired to real data and the rest were hardcoded demo
screens. A polished screen showing fabricated numbers is worse than no screen: it
teaches users to distrust the ones that are real.

So the IA is cut to the surfaces that map to the [platform's layers](01_PLATFORM.md)
and [the Core Loop](02_CORE_LOOP.md), in the order a user needs them:

- **Command Centre** first, because the loop's whole point is to tell you what
  matters now.
- **Communications, Customers, Operations** next: the three surfaces of what is
  actually happening in the business (conversations, relationships, work).
- **Learning Centre, Agents, Protocol**: the intelligence layer, made legible, what
  the company is continuously learning, who is acting on it, and the rules they act
  under.
- **Settings** last: configuration, used rarely, by few.

The order is also a statement of priority for construction: build and deepen from the
top. See [roadmap/IMPLEMENTATION_ROADMAP](../roadmap/IMPLEMENTATION_ROADMAP.md).

The old top-level surfaces that were really one business's tactics (North Star, ARR
Growth, Quote Engine, Coordinator, Assets, Further Works, Numbers, Marketing,
Campaigns, Journeys, Reviews) are **not** deleted; they move to **Preview/Labs** or
fold into one of the eight as a panel, and become real only when a backend backs
them. None of them earns a permanent top-level slot by being a good idea; it earns it
by moving an objective with real data.

---

## The screens in detail

For each: its **one question**, its **inputs** (what it reads), its **outputs** (what
a user does there), its **dependencies**, its **evolution**, and **how it contributes
to [the Core Loop](02_CORE_LOOP.md)**.

### 1. Command Centre — "What needs my attention?"
- **Inputs.** The intelligence feed: Observations, Decisions awaiting approval, open
  Recommendations, risks, SLA breaches, and what the AI has already handled
  (`command-feed`, `command-centre`).
- **Outputs.** Triage: approve or reject a proposed action, open the underlying case,
  see what was handled autonomously. This is the one surface where a human resolves
  the loop's [Approval](02_CORE_LOOP.md#6-decision--approval) stage.
- **Dependencies.** The whole [intelligence pipeline](04_AI_ARCHITECTURE.md); the
  review queue (`review_tasks`); [Protocol](07_PROTOCOL.md) for what counts as urgent.
- **Evolution.** Deepen each item into "why this surfaced" (evidence and lineage);
  surface the orphaned `review_tasks` and `automation_approvals` fully.
- **Loop contribution.** It *is* the human window into the loop: the point where
  Decisions that need a person get one, and nothing else.
- **This is the default landing screen.**

### 2. Communications — "What conversations are happening?"
- **Inputs.** The interaction layer: phone (`phone_calls/recordings/transcripts/
  ai_insights`) and email (`email_messages/threads/ai_insights`), unified into one
  timeline with AI summaries; live calls (`live_call_sessions`).
- **Outputs.** See and understand every conversation the business is having, across
  channels, in one place. Not a table of calls, a narrative of relationships in
  motion.
- **Dependencies.** `phone-feed`, `email-feed`, `interactions`, the
  [Live Call Card](../reference/LIVE_CALL_CARD.md). (Email is real today but was
  buried in admin; it belongs here.)
- **Evolution.** Add SMS/WhatsApp channels as Preview until their connectors exist;
  richer AI summaries.
- **Loop contribution.** This is [Core Loop](02_CORE_LOOP.md) stage 1 made visible:
  the Signals arriving and becoming Interactions. It is the interaction layer, **not**
  the intelligence engine, that distinction keeps it from overlapping the Command
  Centre.

### 3. Customers — "What do we know about this customer?"
- **Inputs.** The [Customer Card](../reference/INTERACTIONS_IDENTITY_CARDS.md)
  projection, the interaction timeline, linked [people/companies](03_BUSINESS_GRAPH.md),
  value, sentiment, risk, recommendations, and AI memory.
- **Outputs.** Open one customer and see the whole relationship and what to do next.
  This is the moat: the platform understanding a relationship better than any single
  human could hold in their head.
- **Dependencies.** `customer_cards`, `interactions`, `recommendations`, direct
  `people`/`companies` reads, the [Business Graph](03_BUSINESS_GRAPH.md).
- **Evolution.** Deepen from a list into a full relationship view; jobs and assets
  appear here once the operational connectors land (Preview until then).
- **Loop contribution.** It is the [Card](02_CORE_LOOP.md) stage as a surface: the
  projection of everything known about a subject, with its next actions.

### 4. Operations — "What work is flowing?"
- **Inputs.** Jobs, engineers, scheduling, assets, compliance state, built from real
  operational data as connectors provide it.
- **Outputs.** See the flow of work and where it is stalling. Answer "is the business
  keeping up?" for the physical work, as the Command Centre answers it for attention.
- **Dependencies.** Today: the real operations/connector data. Fully: a jobs
  connector (e.g. Commusoft); those tabs stay Preview until it exists.
- **Evolution.** The old Coordinator, Quote Engine, Assets, Further Works, and
  Engineers surfaces fold in here as tabs/panels, each becoming real only when backed
  by a connector.
- **Loop contribution.** Operational work is both a major source of [Signals](02_CORE_LOOP.md)
  and a major target of [Actions](../reference/AUTOMATION_ENGINE.md); Operations is
  where the loop touches the physical business.

### 5. Learning Centre — "What is the company continuously learning?"
The always-learning company feed, and a first-class Intelligence surface. It has four
sections: **Overview / Learning Health · Sources · Learning Timeline · Knowledge /
Business Graph**. "Knowledge" is a section here, not a separate screen. Distinct from
Communications: Communications shows conversations; the Learning Centre shows what
ServiceOS is learning from all enabled inputs.
- **Inputs.** Learning health, Sources (connector registry + live status), the
  learning timeline (from real `platform_events`/`intelligence_objects`/`graph_events`),
  the [Business Graph](03_BUSINESS_GRAPH.md), and reconstructed workflows.
- **Outputs.** See that the system is always learning: from which inputs, how fresh and
  confident the knowledge is, and what it now knows. Full definition in
  [06_LEARNING_CENTRE](06_LEARNING_CENTRE.md).
- **Dependencies.** `graph_nodes/edges/events`, `platform_events`,
  `intelligence_objects`, the connector registry (`tenant_connectors`), `learning.ts`.
  Only Simwood phone and Gmail/Workspace email are live sources; documents/RAG and
  other catalogue connectors stay Preview until an ingestion pipeline exists.
- **Evolution.** From a knowledge/graph view into the full four-section capture +
  learning surface, including knowledge health and decay.
- **Loop contribution.** It is the [Knowledge/Learning](02_CORE_LOOP.md) end of the
  loop made visible: where Outcomes become durable, compounding memory.

### 6. Agents — "What AI workers exist?"
- **Inputs.** The configured [Agents](05_AGENTS.md), their approval modes, permissions,
  confidence thresholds, health, and audit history.
- **Outputs.** See and supervise the AI workforce: what each Agent does, how much
  autonomy it has, whether it is healthy, and what it has done.
- **Dependencies.** The [intelligence engines](04_AI_ARCHITECTURE.md) surfaced as
  named workers; agent health and history records. Preview until Agents are configured
  as first-class objects.
- **Evolution.** From a placeholder into the real supervision console defined in
  [05_AGENTS](05_AGENTS.md).
- **Loop contribution.** Agents are *who runs* the loop for a domain of work; this
  screen is how a human supervises that.

### 7. Protocol — "What rules govern behaviour?"
- **Inputs.** Operational modes, policies, response windows, SLAs, escalation paths,
  risk thresholds, compliance obligations, all versioned. See
  [07_PROTOCOL](07_PROTOCOL.md).
- **Outputs.** See and tune the rules the platform operates under, with a named owner
  per rule and full version history.
- **Dependencies.** `operational_modes`, `policies`/`policy.ts`, the Decision Engine's
  thresholds. Real server-side; the surface binds to them.
- **Evolution.** From demo parameters into the real, versioned parameter-management
  surface.
- **Loop contribution.** Protocol is the boundary the whole loop runs inside; this
  screen is where a business sets that boundary.

### 8. Settings — "How is ServiceOS configured?"
- **Inputs.** Tenant, branding, users and roles, connectors/integrations, security.
- **Outputs.** Configure the instance: who has access, what is connected, how it is
  branded.
- **Dependencies.** Tenant config, `profiles`/roles, connector registry.
- **Evolution.** Absorbs the old "Admin" surface (users/roles, connector governance,
  audit) so there is one configuration home, not two.
- **Loop contribution.** None directly; it is the frame around the loop, deliberately
  the lowest-priority, least-visited screen.

---

## The OpenFolk control plane (separate, gated)

[OpenFolk](../foundation/OPENFOLK_PHILOSOPHY.md) is, in the intended architecture, the
super-admin-only operator plane *over* many ServiceOS deployments, not a ninth tenant
screen. **It is not production functionality today.** The platform is single-tenant;
multi-tenant management and the `platform_admin` role are **not yet implemented**. So
the OpenFolk plane (companies/tenants, connector fleet, AI configuration, cross-tenant
health) is an **aspirational, clearly-gated, mostly-Preview** area on its own route,
never mixed into a tenant's eight screens. The architecture (everything is
`tenant_id`-scoped) is ready for it; the role, the management UI, and the multi-tenant
data do not exist yet, and the surface must say so honestly rather than imply the
control plane is live.

---

## The rule this IA enforces

Every screen answers one question. If a proposed feature would make a screen answer a
second question, it belongs on a different screen or behind a panel, never bolted on.
If two screens would answer the same question, one of them is wrong. This is not a
style preference; it is how an operating system stays an operating system instead of
decaying into a pile of features. The enforcement rules are
[10_FRONTEND_PRINCIPLES](10_FRONTEND_PRINCIPLES.md).
