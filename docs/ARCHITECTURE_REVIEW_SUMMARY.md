# Architecture Review Summary

_A record of the documentation consolidation that produced this manual: what was
reviewed, what was merged, removed, and rewritten, the gaps and risks that remain,
and the recommended next steps. Read the [documentation index](README.md) for the
resulting set._

**Scope.** A full review of every architectural, planning, design, and operational
document in the repository, reorganised into one coherent engineering manual with a
single vocabulary, a clear hierarchy, and no contradictory architecture.

**Outcome.** 34 scattered documents (of which many overlapped or contradicted) became
**one numbered spine (11 docs) + 8 reconciled engine references + 4 operations
runbooks + 1 roadmap + this summary**, governed by a single
[glossary](architecture/00_GLOSSARY.md), with 22 superseded documents archived behind
banners.

---

## 1. Documents reviewed

All 34 markdown documents under `docs/` and `.lovable/plan.md`, plus the root
`README.md` (setup runbook) and `CLAUDE.md`. Grouped as found:

- **Constitution:** OPENFOLK_PHILOSOPHY, OPENFOLK_CONTINUOUS_OPTIMISATION, OPENFOLK_WEBSITE_BUSINESS_CASE.
- **Intelligence engines:** UNIVERSAL_INTELLIGENCE_FOUNDATION, UNIVERSAL_DECISION_ENGINE, UNIVERSAL_AUTOMATION_ENGINE, UNIVERSAL_OBJECTIVES_ENGINE, OBJECTIVE_EVALUATION_WORKER.
- **v1 data stack:** SIGNAL_PROCESSING, IDENTITY_ENGINE, CUSTOMER_CARD_ENGINE, RECOMMENDATION_ENGINE, BUSINESS_GRAPH, INTELLIGENCE_INGEST_BRIDGE, EVENT_ARCHITECTURE, LIVE_CALL_CARD.
- **Runtime/infra:** ASYNC_WORKER_QUEUE, WORKER_HANDLERS, SCHEDULERS, SCHEDULER_DEPLOYMENT, INPUT_RELIABILITY, PHONE_INPUT_SIMWOOD_SPEC, OPERATIONS_HEALTH_MODEL.
- **Verification/acceptance:** DEPLOYMENT_AND_TEST_CHECKLIST, EMAIL_RELIABILITY_ACCEPTANCE, PHONE_RELIABILITY_ACCEPTANCE, INPUT_RELIABILITY_ACCEPTANCE, REMOTE_VERIFICATION_HARNESS, PHASE_7_PROOF.
- **Product/frontend:** FRONTEND_ALIGNMENT_AUDIT, PRODUCT_ARCHITECTURE_ALIGNMENT, NAVIGATION_ARCHITECTURE, IMPLEMENTATION_ROADMAP.

Every document was read in full and cross-checked against the real code
(`supabase/functions/`, `supabase/migrations/`, `src/lib/`) so the reorganisation is
grounded in what is actually built, not only in what was claimed.

---

## 2. The central finding

The most important discovery is not a document problem but an **architecture-narrative
problem the documents had frozen in place**:

> ServiceOS contains **two parallel expressions of the same loop** that were never
> reconciled in prose. An earlier "v1" deterministic stack (interactions → identity →
> cards → recommendations → business graph) and a later "intelligence" stack
> (observations → decisions → operational modes → automation intents → objectives →
> outcomes) describe **the same Core Loop in two different vocabularies**.

The reconciliation is now the spine of the manual:
[02_CORE_LOOP](architecture/02_CORE_LOOP.md) adopts one name per stage, and
[00_GLOSSARY](architecture/00_GLOSSARY.md) enforces it. This is the single most
valuable outcome of the review, and it exposes the top architectural risk (§7).

---

## 3. Documents merged

Five canonical documents were synthesised from multiple overlapping sources, each
resolving specific contradictions:

| New canonical document | Merged from | Key contradictions resolved |
|---|---|---|
| [reference/BACKEND_RUNTIME](reference/BACKEND_RUNTIME.md) | ASYNC_WORKER_QUEUE + WORKER_HANDLERS | "six vs sixteen" job types → confirmed **16** handlers from `index.ts` |
| [reference/OBJECTIVES_AND_OUTCOMES](reference/OBJECTIVES_AND_OUTCOMES.md) | UNIVERSAL_OBJECTIVES_ENGINE + OBJECTIVE_EVALUATION_WORKER | "future extension" vs implemented worker; "no Outcomes layer yet" vs the shipped `outcomes` table |
| [reference/INTERACTIONS_IDENTITY_CARDS](reference/INTERACTIONS_IDENTITY_CARDS.md) | SIGNAL_PROCESSING + IDENTITY_ENGINE + CUSTOMER_CARD_ENGINE + RECOMMENDATION_ENGINE | who owns card writes; who owns recommendation generation; one confidence enum; the `type` vs `source_rule` rule-id split; two distinct scores (priority vs activity) |
| [operations/SCHEDULER_OPERATIONS](operations/SCHEDULER_OPERATIONS.md) | SCHEDULERS + SCHEDULER_DEPLOYMENT + INPUT_RELIABILITY | "no cron exists anywhere" vs the shipped cron migration; one canonical cadence/secret table |
| [operations/VERIFICATION_AND_ACCEPTANCE](operations/VERIFICATION_AND_ACCEPTANCE.md) | EMAIL_ + PHONE_RELIABILITY_ACCEPTANCE (+ INPUT_RELIABILITY_ACCEPTANCE rationale) | de-duplicated twin acceptance scaffolds; folded content-versioned-projection and honest-health rationale |

---

## 4. Documents rewritten

**Reconciled in place** (renamed to their canonical name, links repaired, stale
headers replaced with honest status lines, terminology conformed, specific bugs
fixed):

- UNIVERSAL_DECISION_ENGINE → [reference/DECISION_ENGINE](reference/DECISION_ENGINE.md) (deleted the corrupted "naming (applied)" box; documented the 9 real destinations from code; folded in Operational Modes = the five maturity stages).
- UNIVERSAL_AUTOMATION_ENGINE → [reference/AUTOMATION_ENGINE](reference/AUTOMATION_ENGINE.md).
- EVENT_ARCHITECTURE → [reference/EVENT_ARCHITECTURE](reference/EVENT_ARCHITECTURE.md) (resolved the three-way "event" collision and the subscriber-vs-identity contradiction against real code).
- INTELLIGENCE_INGEST_BRIDGE → [reference/INTELLIGENCE_INGEST_BRIDGE](reference/INTELLIGENCE_INGEST_BRIDGE.md) (framed as the Observation seam; reconciled with the v1 path).
- LIVE_CALL_CARD → [reference/LIVE_CALL_CARD](reference/LIVE_CALL_CARD.md) (disambiguated from Customer Card; relocated the Workflow-Intelligence idea to the Learning Centre).
- OPERATIONS_HEALTH_MODEL → [operations/OBSERVABILITY_HEALTH](operations/OBSERVABILITY_HEALTH.md).
- IMPLEMENTATION_ROADMAP → [roadmap/IMPLEMENTATION_ROADMAP](roadmap/IMPLEMENTATION_ROADMAP.md) (realigned to the eight screens).
- REMOTE_VERIFICATION_HARNESS → [operations/REMOTE_VERIFICATION_HARNESS](operations/REMOTE_VERIFICATION_HARNESS.md).

**Net-new canonical documents** (the subject previously had no coherent home):

- The entire numbered [architecture spine](architecture/): 00_GLOSSARY, 01_PLATFORM,
  02_CORE_LOOP, 03_BUSINESS_GRAPH, 04_AI_ARCHITECTURE, 05_AGENTS, 06_LEARNING_CENTRE,
  07_PROTOCOL, 08_BACKEND_PRINCIPLES, 09_NAVIGATION, 10_FRONTEND_PRINCIPLES.
- The [documentation index](README.md) and this summary.

---

## 5. Documents removed (archived)

22 documents were moved to [archive/](archive/), each with a SUPERSEDED banner naming
its replacement. They fall into three kinds:

- **Absorbed by a merge** (content lives on in a canonical doc): SIGNAL_PROCESSING,
  IDENTITY_ENGINE, CUSTOMER_CARD_ENGINE, RECOMMENDATION_ENGINE, BUSINESS_GRAPH,
  ASYNC_WORKER_QUEUE, WORKER_HANDLERS, UNIVERSAL_OBJECTIVES_ENGINE,
  OBJECTIVE_EVALUATION_WORKER, SCHEDULERS, SCHEDULER_DEPLOYMENT, INPUT_RELIABILITY,
  EMAIL_RELIABILITY_ACCEPTANCE, PHONE_RELIABILITY_ACCEPTANCE,
  INPUT_RELIABILITY_ACCEPTANCE.
- **Superseded planning/audit** (their conclusions are now in the spine): FRONTEND_ALIGNMENT_AUDIT,
  PRODUCT_ARCHITECTURE_ALIGNMENT, NAVIGATION_ARCHITECTURE, UNIVERSAL_INTELLIGENCE_FOUNDATION.
- **Historical snapshots** (a moment already passed): PHASE_7_PROOF (milestone proof),
  DEPLOYMENT_AND_TEST_CHECKLIST (stale bring-up runbook), PHONE_INPUT_SIMWOOD_SPEC
  (design spec whose tables/providers/storage differ from what shipped).

Nothing was hard-deleted; git history and the archive both preserve the evolution.

---

## 6. Contradictions resolved (the full list)

1. Two pipelines / two vocabularies → one loop, one glossary.
2. `platform-worker` job types: "six" (prose) vs 16 (registry) → **16**.
3. Objectives: "no first-class Outcomes layer" → the `outcomes` layer exists.
4. Objectives: health-evaluation worker "future" → implemented.
5. Decision destinations: corrupted rename box → 9 real destinations from code.
6. `config_versions` lifecycle: 5-state with `simulation` → canonical 4-verb `draft → review → published → superseded → archived`.
7. Cron: "no cron anywhere" → cron migration ships it; 12 live cron rows documented.
8. Event bus: three tables conflated → `platform_events` / `graph_events` / `live_call_events` qualified everywhere.
9. Subscribers: "independent fan-out" → identity resolution runs cards/recs inline today (target is fan-out).
10. Customer-card & recommendation ownership: two claimants each → explicit ownership split.
11. Rule-id spellings: two variants → they are `type` vs `source_rule`; full set documented.
12. Confidence enum: three casings + `unmatched` → canonical `unknown|possible|likely|confirmed|rejected`.
13. Interaction status: `analysed` → retired synonym for `ready`; canonical `pending → ready → enriched`.
14. "Signal" (3 meanings), "Agent" vs "Worker", "Card" (2 models), "Automation" (engine vs stance) → all fixed in the glossary.
15. Navigation: three conflicting nav proposals → the one authoritative eight-screen IA.

---

## 7. Architectural risks discovered

These are risks in the **system**, surfaced by the review; they are not documentation
tasks but engineering ones.

1. **The two pipelines still co-exist in code, not just docs.** The deterministic
   recommendation path and the observation → decision path both run. The manual
   reconciles them narratively; the code should **converge** (one path should produce
   the other's artefacts, or one should be clearly subordinate) so behaviour cannot
   diverge and `recommendations` is not double-written. **Highest architectural risk.**
2. **Two engines write `customer_cards` and `recommendations`.** The ownership split
   is now documented; it should be **enforced in code** (and verified) so the split is
   real, not just described.
3. **The enrichment starvation bug is RESOLVED** (was previously the top operational
   risk). Its cause was newest-first identity resolution starving the historical
   backfill; identity-resolve was changed to **oldest-first**, deployed, and proven
   live by the backlog moving from `pending` to `enriched`. What remains is not a
   blocker: **(a)** the historical backlog draining to ~0 is an **operational
   monitoring item**, and **(b)** autonomous processing and enrichment-health
   visibility are the **remaining work** ([Roadmap Phase 3](roadmap/IMPLEMENTATION_ROADMAP.md)).
4. **Live-vs-branch deployment drift.** The live Supabase deployment runs behind this
   branch (e.g. eligibility-ledger columns not deployed, per PHASE_7 and prior notes).
   Verification suites should assert deployment parity, not just branch correctness.
5. **Single-tenant reality vs multi-tenant architecture.** The OpenFolk control plane
   is **aspirational, not production**: the code is single-tenant and the
   `platform_admin` role and multi-tenant management are not yet implemented. Risk of
   building management UI ahead of the backend. Keep it gated Preview and never
   describe it as live.
6. **Confidence enum drift in code** (uppercase TS enum vs lowercase persisted values).
   Cosmetic today, a real bug source if a comparison ever assumes one casing.
7. **`CLAUDE.md` says "there is no backend".** True for `main`, false for this branch.
   An onboarding hazard; see the recommendation below.
8. **`.lovable/plan.md` still encodes the old "New Dawn" navigation**, which contradicts
   the authoritative eight-screen IA. It is Lovable-managed and was left untouched;
   anyone reading it in the Lovable editor will see a superseded nav.

---

## 8. Remaining documentation gaps

Honest list of what this set does **not** yet cover:

- **Connector authoring guide.** Only two input channels are confirmed live with an
  active ingestion pipeline: **phone (Simwood)** and **email (Gmail / Google
  Workspace)**. Everything else in the ~24-entry registry (Commusoft, Microsoft 365,
  Slack, documents/RAG, …) is catalogue, planned, or aspirational and must be labelled
  as such. There is no "how to add a connector" reference or a per-connector status
  page yet; write it when the next real pipeline lands.
- **Data dictionary / schema reference.** The migrations are the source of truth; there
  is no generated, browsable schema reference. Consider generating one.
- **Dedicated security / RLS posture document.** Security is folded into
  [08_BACKEND_PRINCIPLES](architecture/08_BACKEND_PRINCIPLES.md); RLS was confirmed
  present (29 policy migrations, tenant scoping, `authz.ts`, webhook guards) but a full
  threat model and RLS-policy inventory is not written.
- **Documents / RAG / knowledge-base capability.** Not built; only a Preview note in
  [06_LEARNING_CENTRE](architecture/06_LEARNING_CENTRE.md). No spec until the backend exists.
- **Per-Agent catalogue.** [05_AGENTS](architecture/05_AGENTS.md) defines the concept;
  no concrete Agents are configured yet, so there is no catalogue of real agents.
- **Multi-tenant / OpenFolk control-plane spec.** Deliberately deferred until the
  backend is designed.

---

## 9. Recommended documentation roadmap

1. **Keep the roadmap and this summary living**; retire archive entries and update the
   central finding (§2) once the two code pipelines converge.
2. **Add a `reference/CONNECTORS.md`** (registry + authoring pattern + per-connector
   status) when the operational connectors (Roadmap Phase 4) begin.
3. **Add a `SECURITY.md`** (RLS policy inventory + threat model) extracted from and
   linked by 08_BACKEND_PRINCIPLES.
4. **Generate a schema reference** from migrations and link it from 03_BUSINESS_GRAPH.
5. **`CLAUDE.md` now points to [docs/README.md](README.md)** and clarifies that the
   "no backend" note is `main`-only (done during this consolidation).
6. **Reconcile `.lovable/plan.md`** with the eight-screen nav, or add a note there that
   it is superseded, once the Phase 1 nav reset ships.

---

## 10. Suggested next implementation phase

**Do [Roadmap](roadmap/IMPLEMENTATION_ROADMAP.md) Phases 1 + 2 (nav reset + Command
Centre as home) immediately.** Enrichment is no longer a blocker (the starvation bug is
resolved), so real data already flows; the surface phases can render it now. Phase 3's
remaining work (autonomous cadence + backlog monitoring) runs alongside, not ahead of,
the surfaces. That delivers visible coherence in week one on top of live data.

**In parallel, address risk #1:** begin converging the two code pipelines so the
deterministic recommendation path and the intelligence observation/decision path are
one path in code, matching the reconciliation this manual makes in prose. Until that
convergence happens, the architecture's biggest latent inconsistency lives in the
code, not the docs, and every new feature built on either path widens it.
