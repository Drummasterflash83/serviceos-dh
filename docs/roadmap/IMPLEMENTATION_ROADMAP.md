# Implementation Roadmap

_The construction sequence for aligning the product to the architecture in this
manual. It builds the [eight screens](../architecture/09_NAVIGATION.md) top-down and
wires each to the backend that already exists, gating anything backend-dependent
behind its capability. Per phase: objective, user outcome, backend dependencies,
frontend work, testing, deployment._

Reality tags: **Live** (wired) · **Foundation** (backend exists, surface partial) ·
**Preview** (needs backend build). Effort: S (≤1d) · M (2–4d) · L (1–2wk).

> This roadmap is a living plan, the one document in the set expected to change as
> phases complete. The architecture it builds toward is fixed; the sequence is not.

---

## Target IA (what we are building toward)

The authoritative surface is the [eight screens](../architecture/09_NAVIGATION.md):
**Command Centre · Communications · Customers · Operations · Learning Centre · Agents ·
Protocol · Settings**, plus a separate gated OpenFolk control plane (aspirational,
`platform_admin` role not yet implemented). Every current view maps to one of these or
to **Labs/Preview**; nothing is deleted without a home.

| Current / legacy view | New home |
|---|---|
| Command Centre | **Command Centre** (default landing) |
| My Day | folded into Command Centre; retired as default |
| Calls & Comms · Email (from admin) | **Communications** |
| Customers · Cards | **Customers** |
| Operations · Coordinator · Quote · Assets · Engineers · Further Works | **Operations** (connector-dependent tabs = Preview) |
| Operations Centre (admin) | **Settings** (Integrations / System Health) + [operations runbooks](../operations/) |
| Learning Centre concept · Knowledge graph | **Learning Centre** (Knowledge is a section within it) |
| Agents | **Agents** (Preview until configured) |
| Protocol | **Protocol** (real modes/policies) |
| North Star · ARR · Numbers · Marketing · Campaigns · Journeys · Reviews · Automations · Intelligence | **Labs/Preview** or a panel within a screen, real only when a backend backs them |
| Settings · Admin | **Settings** |

---

## Phases

### Phase 1 — Navigation & IA reset  · Live · S (frontend)
- **Objective.** Collapse the ~27-item nav to the [eight screens](../architecture/09_NAVIGATION.md); introduce Labs/Preview; remove dead/duplicate wiring.
- **User outcome.** The app reads as one operating system, not a module grab-bag; nothing shown is fake production.
- **Backend deps.** None.
- **Frontend.** Rewrite `NAV`, `ViewKey`, group labels, render switch, default view in `src/routes/app.tsx`; a `LabsPreview` wrapper; delete dead `Dashboard`/`Calls` inline views; consolidate `cards.ts` into `customer-cards.ts`.
- **Testing/deploy.** `tsc` + `lint` + `vite build`; drive `/app`; confirm `VITE_SUPABASE_ANON_KEY` in host env (the "logged out" fix).

### Phase 2 — Command Centre as home  · Live · S (frontend)
- **Objective.** Command Centre becomes the default landing; fold briefing + system health into the hero.
- **User outcome.** On open, the owner immediately sees what needs attention, risks, approvals, and what the AI handled.
- **Backend deps.** None (uses `command-feed`).
- **Testing.** Command Centre renders first; the two-mode (auth + demo) render still works via `/demo/command-centre`; approve-flow smoke test.

### Phase 3 — Data liveness I: enrichment  · Foundation→Live · M (backend)
- **Objective.** Keep real interactions flowing to `enriched` and on into intelligence, and make that flow autonomous and observable.
- **Status.** The **enrichment starvation bug is RESOLVED.** Its cause was newest-first identity resolution, which starved the historical backfill; identity-resolve was changed to **oldest-first**, deployed, and proven live by the historical backlog moving from `pending` to `enriched`. What remains:
  - **Remaining historical backlog** — an operational monitoring item: watch the backlog drain to ~0, not a code fix.
  - **Autonomous processing and health visibility** — the remaining work: run enrichment on its own cadence without manual drive, and surface enrichment health in [Observability](../operations/OBSERVABILITY_HEALTH.md) and the [Learning Centre](../architecture/06_LEARNING_CENTRE.md).
- **User outcome.** The system stays alive on its own: real calls and emails keep appearing as understanding, not raw rows.
- **Backend deps.** The oldest-first fix is shipped. Remaining: autonomous cadence + backlog-drain monitoring. See [Verification & Acceptance](../operations/VERIFICATION_AND_ACCEPTANCE.md).
- **Testing.** Enrichment verify suite (seed real-shaped email/phone → assert reaches `enriched` → Observation); re-run `golden-loop`; assert backlog continues trending to ~0.

### Phase 4 — Data liveness II: operational connectors  · Preview→Foundation · L (backend)
- **Objective.** Add the named inputs (jobs/engineers/assets via Commusoft; mail/calendar/docs via M365) so operational reality flows into interactions + graph.
- **Backend deps.** New connector adapters + OAuth + sync functions mirroring the Simwood/Gmail pattern; projection into `interactions` and `graph_nodes`. Registry entries exist.
- **Note.** Larger effort; can run in parallel with Phases 5–7. Surfaces degrade honestly (Preview) until it lands.

### Phase 5 — Learning Centre  · Foundation→Live · M (frontend on existing backend)
- **Objective.** Build the [Learning Centre](../architecture/06_LEARNING_CENTRE.md) and its four sections: Overview / Learning Health, Sources (connector registry + live status), Learning Timeline (from real `platform_events`/`intelligence_objects`/`graph_events`), and Knowledge / Business Graph.
- **Backend deps.** All existing. Sources must show only genuinely live pipelines as live (Simwood phone, Gmail/Workspace email); Commusoft, M365, Slack, documents/RAG stay Planned/Catalogue/Preview.
- **Testing.** Real rows render in order; Sources reflect true connector status; no fabricated counts (documents shows "not connected", never "342 indexed").

### Phase 6 — Communications rebuild  · Live · M (frontend)
- **Objective.** One interaction layer: Phone + Email + unified timeline + AI summaries. Pull Email out of admin.
- **Backend deps.** Existing `phone-feed`, `email-feed`, `interactions`, `*_ai_insights`.
- **Testing.** Both tabs show real feeds; timeline merges both; SMS/WhatsApp = Preview; empty-state honesty.

### Phase 7 — Customer Intelligence  · Foundation→Live · L (frontend + light backend) — CORE
- **Objective.** The moat: one [Customers](../architecture/09_NAVIGATION.md) view of profile, interactions, jobs, assets, sentiment, value, risk, recommendations, and AI memory.
- **Backend deps.** Existing `customer_cards`/`interactions`/`recommendations`; direct `people`/`companies` reads (tenant-scoped RLS); jobs/assets from Phase 4; surface `review_tasks`.
- **Testing.** Seed a rich customer → detail view shows real timeline + risk + recs; "why this matters" pulls real signals; unbuilt fields show "connect Commusoft", never fabricated.

### Phase 8 — Agents & Protocol  · Preview/Foundation · M
- **Objective.** Turn the [Agents](../architecture/05_AGENTS.md) and [Protocol](../architecture/07_PROTOCOL.md) screens into real supervision + governance surfaces bound to the existing engines (operational modes, policies, decision thresholds), not demo parameters.
- **Backend deps.** `operational_modes`, `policies`/`policy.ts`, decision/automation engines exist; Agent objects (name/owner/permissions/health) need modelling.

### Phase 9 — OpenFolk control-plane shell  · Preview · M (gated)
- **Objective.** A super-admin-only plane (Companies · Connectors fleet · AI Config · Platform Health), architecture-ready for multi-tenant, real gating, honest-Preview management surfaces.
- **Backend deps.** New `platform_admin` role; route guard. Real multi-tenant `tenants` management deferred.

### Phase 0 (systemic) — enrichment, now unblocked
The enrichment starvation bug that once starved every Live surface is **RESOLVED**
(oldest-first identity resolution, deployed and proven live). What remains is
operational, not a blocker: monitor the historical backlog draining to ~0, and finish
autonomous processing + enrichment-health visibility (folded into Phase 3). Real data
now flows; the surface phases are no longer waiting on it.

---

## Sequencing

```
1 Nav/IA ─▶ 2 Command Centre home            (coherence wins, week 1)
        └─▶ 3 Enrichment (bug resolved; autonomy + monitoring) ─▶ real data flows
                 4 Operational connectors (parallel, longer) ──┐
5 Learning Centre ─ 6 Communications ─ 7 Customer Intelligence   (fed by 3/4)
                 8 Agents & Protocol
                 9 OpenFolk shell (independent, aspirational)
```

**Now that enrichment is unblocked**, the surface phases can render real data
immediately. Phase 3's remaining work (autonomous cadence + monitoring) runs alongside
them rather than gating them. Phase 4 is the larger backend investment and runs in
parallel; surfaces degrade
honestly (Preview) until it lands.

---

## Cross-cutting standards (every phase)

- Reuse `ApiResult<T>` + `getSupabaseClient()`; no parallel data layer
  ([frontend principles](../architecture/10_FRONTEND_PRINCIPLES.md)).
- Writes only via Edge Functions; never client-side table mutations
  ([backend principles](../architecture/08_BACKEND_PRINCIPLES.md)).
- Every surface names its backing capability; no backend ⇒ honest Preview, never a
  fake dashboard.
- Verify each change end to end (the `/verify` approach + suites,
  [Verification & Acceptance](../operations/VERIFICATION_AND_ACCEPTANCE.md)); tsc/lint/
  build green; push to the branch → CI preview (no merge to `main` without approval).
- Backend changes: migration dry-run → `db push` → `functions deploy`; external-effect
  capabilities stay disabled.
