# MASTER ServiceOS / OpenFolk Specification

**Status:** master source of truth. This document **consolidates and links** the existing
architecture manual — it does not replace it. Where a topic has a dedicated authoritative
document, this spec summarises it and points there. The full manual and its reading order live
in **[docs/README.md](README.md)**; the glossary **[docs/architecture/00_GLOSSARY.md](architecture/00_GLOSSARY.md)**
is the term tie-breaker.

**Branch:** describes `serviceos-backend-foundation` — a real Supabase backend (79 migrations,
~45 edge functions). The `main`-branch "no backend / prototype" note in `CLAUDE.md`/root
`README.md` applies only to `main`.

**Reality tags** (used throughout, from the manual): **Live** (running in prod) · **Foundation**
(schema/plumbing exists, not an active pipeline) · **Preview** (built, gated, not activated) ·
**Planned** (designed, not built) · **Aspirational** (catalogued only).

---

## 1. Product purpose

ServiceOS is an **AI operating system for a service business**: it observes everything the
business does across its real tools (phone, email, jobs, quotes, …), builds one canonical
understanding, and continuously helps the company run better — surfacing what needs doing, what
is waiting, where work stalls, and what should be automated or eliminated. **OpenFolk** is the
company behind it and the **operator control plane** that configures and governs each tenant.

Authoritative: **[foundation/OPENFOLK_PHILOSOPHY.md](foundation/OPENFOLK_PHILOSOPHY.md)** (why) ·
**[architecture/01_PLATFORM.md](architecture/01_PLATFORM.md)** (what it is / is not) ·
**[foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md](foundation/OPENFOLK_CONTINUOUS_OPTIMISATION.md)**
(the value model — the highest optimisation is often *elimination*, not automation).

The organising idea is **the Core Loop**: Signal → Interpretation → Decision → Action → Outcome →
**Learning** → durable Knowledge, which makes the next decision better. Authoritative:
**[architecture/02_CORE_LOOP.md](architecture/02_CORE_LOOP.md)**.

## 2. Tenant North Stars

Each tenant configures the measurable outcomes the platform optimises toward. For **Drummonds**
the configured objectives are **Grow contracted ARR** (target £700k+, Mar 2028) and **Protect
gross margin** (≈35%); operational sub-goals include reduced elapsed time to invoice, fewer
missed callbacks, and higher quote conversion. North Stars are **Objectives** in the canonical
model, with live actuals where a source is connected and honest "measurement unavailable" where
not. Authoritative: **[reference/OBJECTIVES_AND_OUTCOMES.md](reference/OBJECTIVES_AND_OUTCOMES.md)**.
*(Unresolved: a single canonical, tenant-configurable North Star record — see §14.)*

## 3. OpenFolk vs ServiceOS responsibilities

| | **OpenFolk** (operator control plane) | **ServiceOS** (the employee/company product) |
|---|---|---|
| Answers | "How is this company configured & governed?" | "What should this company/person do now?" |
| Owns | tenants, people, source identities, connections, ownership, routing, confidence, governance, policy, the Learning Centre | the generated operational experience: Command Centres, Health, Momentum, actions |
| Access | platform operators only (gated) | tenant staff (role-scoped) |

ServiceOS **derives** the employee experience from OpenFolk configuration; nothing is hard-coded
per tenant. Authoritative: **[architecture/09_NAVIGATION.md](architecture/09_NAVIGATION.md)**
(the eight product surfaces + the gated Control Plane) · access gate in
**[DEPLOYMENT.md](DEPLOYMENT.md)** (`platform_authority_grants`).

## 4. Source-adapter architecture

Every source reaches the platform the same way: **Provider → Adapter (evidence) → canonical
normalisation → candidate → operator review → confirmed link → use.** The adapter is the only
provider-aware code; a source id is never a canonical id; nothing auto-confirms. Adding a source
is an adapter, not a screen. Authoritative:
**[architecture/source-adapter-pattern.md](architecture/source-adapter-pattern.md)**. Instantiated
by telephony (Sipcentric/Simwood), email (Google Workspace), Slack (design only —
**[slack-integration-design.md](architecture/slack-integration-design.md)**), and Commusoft
(universal CSV import).

## 5. Canonical entities

One canonical model, provider-neutral: `team_members`, `communication_endpoints`,
`member_integration_identities`, `endpoint_ownership_assignments`, the Business Graph
(`graph_nodes`/`graph_edges`), `customer_cards`, `people`, `companies`, `interactions`,
`intelligence_objects`. New sources reuse these; a source table is not a reason for a new
canonical entity. Authoritative: **[architecture/03_BUSINESS_GRAPH.md](architecture/03_BUSINESS_GRAPH.md)**
(model + identity resolution) · **[architecture/canonical-entity-and-health-map.md](architecture/canonical-entity-and-health-map.md)**
(the Drummonds entity catalogue + every source→canonical mapping).

## 6. Identity and ownership

**Identity** ("this endpoint represents this person/team") and **ownership** ("this person is
accountable for activity on this endpoint") are separate axes, both effective-dated, confidence-
bearing, and operator-confirmed. The **Person Intelligence Hub** (OpenFolk → Directory → actor)
is the operator surface: connected systems, candidates, confirm/reject/replace, provenance,
timeline. Confirm is the governed `cp_review_identity` RPC writing `member_integration_identities`.
Authoritative: identity resolution in `03_BUSINESS_GRAPH`; ownership model in the entity map §1a;
the operator preview generates a member's experience by `tenant_id + team_member_id` (never a
profile_id).

## 7. Learning Centre

The OpenFolk operator surface that makes the always-learning company legible: what is happening
company-wide, what is moving, what is waiting and why, who owns it, and where OpenFolk can create
value. **V1 leads with factual operational queues and drill-downs** (not speculative Health
scores). Authoritative target: **[architecture/06_LEARNING_CENTRE.md](architecture/06_LEARNING_CENTRE.md)**;
V1 product spec: **[product/learning-centre-v1.md](product/learning-centre-v1.md)**.

## 8. Health and Momentum

**Health** = evidence-backed findings that something (customer / job / quote / ownership / flow)
needs attention — "what is unhealthy, why, evidence, owner, waiting-on, proposed intervention,
confidence, uncertainty". **Momentum** = movement toward North Stars over time. Two distinct
"health" meanings exist and must stay separate: **customer/entity Health**
(**[canonical-entity-and-health-map.md](architecture/canonical-entity-and-health-map.md)** §9) vs
**operational health/freshness** (**[operations/OBSERVABILITY_HEALTH.md](operations/OBSERVABILITY_HEALTH.md)**).
**Health V1 rules, prioritisation, intervention taxonomy, notification thresholds, AI-worker
authority and explainability are a PRODUCT DECISION and are deliberately unspecified here — they
await the Health V1 brief.** No Health rules are invented in code.

## 9. Individual, team and leadership experiences

- **Individual Command Centre** — "what should I do now?": Needs me now, Commitments, Waiting
  (both directions), Customer Health, Help & cover, Recently resolved.
- **Team Command Centre** — stuck work, unowned work, cover gaps, help requested, repeated
  handoffs, capacity bottlenecks, deteriorating customers/jobs.
- **Leadership Command Centre** — customers/jobs/contracts at risk, profit leakage, further-works
  opportunities, trapped capacity, repeated process failures, leadership-only decisions,
  intervention outcomes. **Leadership is not a larger task list.**

Authoritative: **[architecture/09_NAVIGATION.md](architecture/09_NAVIGATION.md)**. Built: the
shared `CommandCentreConsole`; the read-only **operator preview** (`OperationalDay`, Mary's First
Day) generates a member's day from confirmed evidence only, honest gaps otherwise.

## 10. Automation and AI-worker model

An **Agent / AI worker** owns a bounded remit, acts only within governed authority, and can never
exceed its approval mode; automation candidates are discovered from reconstructed workflows and
routed/approved like any action (the Learning Centre suggests, the Protocol governs). AI-worker
authority, approval modes, and confidence thresholds are defined in
**[architecture/05_AGENTS.md](architecture/05_AGENTS.md)** and
**[architecture/04_AI_ARCHITECTURE.md](architecture/04_AI_ARCHITECTURE.md)**; governed execution in
**[reference/AUTOMATION_ENGINE.md](reference/AUTOMATION_ENGINE.md)** and
**[reference/DECISION_ENGINE.md](reference/DECISION_ENGINE.md)**. *(The precise AI-worker authority
for Health interventions awaits the Health V1 brief.)*

## 11. Controls, permissions and explainability

- **Permissions:** OpenFolk operator authority (`platform_authority_grants`) gates the control
  plane; tenant staff are role-scoped; View-As / operator preview are read-only and never
  attributed. **[DEPLOYMENT.md](DEPLOYMENT.md)** (authority) · `08_BACKEND_PRINCIPLES`.
- **Explainability:** every candidate, finding and recommendation carries confidence + evidence +
  provenance; nothing is presented as certainty; unknowns are honest. `04_AI_ARCHITECTURE`
  (confidence/safety/trust) · `10_FRONTEND_PRINCIPLES` (never fabricate data).
- **Governance of consequential changes:** append-only audit (`controlplane_change_log`),
  governed RPCs, operator-confirmed mappings.

## 12. Current implementation status (audited 2026-07-25, read-only prod `tgbnakbxwcqjeimygroz`)

| Capability | Reality | Evidence |
|---|---|---|
| Telephony ingestion (Simwood) | **Live** | 850 calls (latest 24 Jul 16:17), both directions, 575 recordings+transcripts+AI insights, 6,240 sync runs |
| Email ingestion (Gmail/Workspace) | **Live & fresh** | 3,812 messages (latest **today** 07:08), 2,884 threads, both directions, 40 mailboxes; **attachments=0, email AI insights=0** |
| Canonical pipeline (interactions→intelligence→graph) | **Live** | 4,674 interactions → 3,156 intelligence_objects (Observations/Actions, 968/1000 with deadlines) → 11,480 graph nodes, 1,176 customer_cards, 516 companies; 4,106 recommendations |
| Identity mapping | **Thin** | 1 confirmed email link (Heidi); **0 confirmed telephony links**; 0 phone `communication_endpoints` in prod (telephony discovery not deployed) |
| Waiting relationships / handoffs | **Gap** | `intelligence_objects.waiting_on_ref` populated on 0 rows; `responsibility_handoffs` = 0 |
| Commusoft | **Importer built, never run** | manual preview→apply CSV importer (`data-import`, seeded "Commusoft Customers/Jobs/Staff" profiles) exists but 0 data_imports, jobs = 0 — analysed only |
| Slack | **Not connected** | 0 slack connection/endpoints/chat interactions (design prepared only) |
| Customer/entity Health | **Inert** | health_objects / assessments / commitment_proposals = 0 |
| OpenFolk Directory / Person Hub / operator preview / Mary's First Day | **Built, local, not deployed** | commits 113901d, 6fc2fd1, ebd5cf1, ff01066, 936e036 |

**Scheduling nuance:** the ingestion code ships **dormant** — no migration runs
`serviceos_schedule_all()`, so cron is off by default and every `*-scheduled-sync` is also
manually invocable ([operations/SCHEDULER_OPERATIONS.md](operations/SCHEDULER_OPERATIONS.md)).
The prod tenant is nonetheless **actively ingesting** (email row written **today** 07:16; 13k+
email + 6k+ phone sync runs), so an operator has enabled it there. "Live" above = live *in prod*,
not enabled-by-code. Enrichment (transcribe/analyse) is automatic once a sync lands a new record.

**Correction to prior assumptions:** the ingestion + canonical pipeline is **already live and
populated** for phone + email; the missing pieces are *identity-mapping coverage*, *waiting/handoff
signals*, *Commusoft ingestion* (importer exists, unrun), *Slack*, *Health activation*, and the
*operator-facing Learning Centre view*.

## 13. Immediate build priority

**Prove the complete learning loop** — inputs → evidence → company-wide learning → ownership &
waiting → patterns & bottlenecks → automation/agent opportunities → North-Star progress — via a
**factual Learning Centre over the evidence that already exists** (see
**[product/learning-centre-v1.md](product/learning-centre-v1.md)**), plus a **unified
provider-neutral evidence projection** (§ Learning Centre spec). Not: more isolated integrations,
and not Health V1 rules (deferred to its own brief).

## 14. Unresolved decisions

1. **Two pipelines co-exist in code** (deterministic Signal→Card→Rec vs observation→decision), and
   two engines write `customer_cards`/`recommendations` — reconciled in docs, not enforced in code.
   **Highest architectural risk.**
2. **Waiting relationships & handoffs are unpopulated** — the columns exist; the deriving logic
   does not. Required for the Learning Centre "who is waiting on what" and Command Centre "waiting".
3. **Canonical North Star record** — Objectives exist; a single tenant-configurable North Star with
   live actuals is not consolidated.
4. **Health V1** — what "healthy" means, prioritisation, intervention taxonomy, notification
   thresholds, AI-worker authority, explainability — a product decision, not yet specified.
5. **Identity-mapping coverage** — 0 telephony / 1 email confirmed; the loop's attribution depends
   on operator confirmation at scale.
6. **OpenFolk Control Plane is single-tenant in code** — multi-tenant operator management is
   aspirational (`09_NAVIGATION` surface vs `DEPLOYMENT.md` gate).
7. **Attachments & email AI insights not captured** (both 0 in prod) — a coverage gap for
   document/RAG knowledge later.

---

## Document governance

- **This document is the master index of truth.** Its **§12 implementation status** and **§13
  build priority** MUST be updated **at each material milestone** (a source going live, a pipeline
  reconciled, a surface deployed, a mapping confirmed at scale, Health activated).
- When a milestone changes reality, update §12 with the audited evidence (re-run the read-only
  Source Truth Audit — see [product/learning-centre-v1.md](product/learning-centre-v1.md)),
  then update the affected authoritative document, then this summary. **Never** update the summary
  to claim a state the audit does not support.
- The **glossary** (`00_GLOSSARY.md`) remains the term tie-breaker; **`09_NAVIGATION.md`**
  supersedes all navigation/IA proposals; **code is ground truth** over any doc.
- The non-numbered `architecture/*.md` docs (canonical-entity-and-health-map, source-adapter-
  pattern, slack-integration-design) and this master spec should be added to
  [docs/README.md](README.md)'s reading order.
