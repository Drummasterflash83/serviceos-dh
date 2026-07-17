# ServiceOS / Open Folk — Implementation Roadmap (approved architecture)

_The construction blueprint for the aligned product. Per phase: objective · user outcome ·
backend dependencies · frontend files · database changes · testing · deployment. **No code
yet — approve the blueprint, then build.**_

Reality tags: 🟢 LIVE · 🟡 FOUNDATION (backend exists) · 🔴 needs backend build.
Effort: S (≤1d) · M (2–4d) · L (1–2wk).

---

## Final navigation (approved) + IA mapping (nothing deleted)

```
⭐ COMMAND CENTRE            default homepage
OPERATE      Customers · Operations · Communications
INTELLIGENCE Learning Centre · Knowledge · Agents
GROW         Growth Intelligence
CONTROL      Settings · Integrations · System Health
── OPEN FOLK CONTROL PLANE (super-admin only, separate gated area) ──
```

Every current view maps to a home (or to **Labs/Preview**), so no work is lost:

| Current view | New home |
|---|---|
| My Day | → role-specific view later; retired as default (Command Centre is home) |
| Command Centre | ⭐ Command Centre (default) |
| Customers · Cards | → **Customers** |
| Calls & Comms | → **Communications** (Phone tab) |
| Operations · Coordinator · Quote · Assets · Engineers · Further Works | → **Operations** (Commusoft-dependent tabs = Preview) |
| Operations Centre (admin) | → **CONTROL → Integrations / System Health** |
| Intelligence · Protocol | → **INTELLIGENCE** (Protocol = real modes/policy config) |
| Knowledge · Agents | → **INTELLIGENCE** (Preview until backend) |
| North Star | → real **Objectives** (Growth Intelligence) — rebuild |
| ARR · Marketing · Campaigns · Journeys · Reviews · Numbers · Automations | → **Growth Intelligence** / **Labs** (Preview) |
| Compliance | → CONTROL (Preview) |
| Settings · Admin | → **CONTROL → Settings** |

**Labs/Preview** = a single honest holding area for concepts whose backend isn't built.
Components are MOVED there, never deleted (honours the constraint).

---

## Phase 1 — Navigation & IA reset  🟢 S (frontend only)

- **Objective:** collapse 27 items → the approved structure; introduce Labs/Preview; remove dead/duplicate wiring.
- **User outcome:** the app reads as one coherent operating system, not a module grab-bag; nothing shown is fake production.
- **Backend deps:** none.
- **Frontend files:** `src/routes/app.tsx` (rewrite `NAV`, `ViewKey`, group labels, render switch, default view), a new `LabsPreview` wrapper component; delete dead `Dashboard`/`Calls` inline views; consolidate `cards.ts` into `customer-cards.ts` (single card module).
- **DB changes:** none.
- **Testing:** `tsc` + `lint` + `vite build`; drive `/app` in the in-app browser — every nav item routes, PREVIEW items show the honest Labs placeholder; visual pass desktop + mobile.
- **Deployment:** commit → push branch → CI preview; confirm `VITE_SUPABASE_ANON_KEY` in host env (the "logged out" fix) so login works on the preview.

## Phase 2 — Command Centre as homepage  🟢 S (frontend only)

- **Objective:** Command Centre becomes the default landing; fold briefing + system health into the hero.
- **User outcome:** on open, the owner immediately sees "what needs my attention / risks / approvals / what the AI handled."
- **Backend deps:** none (uses existing `command-feed`).
- **Frontend files:** `src/routes/app.tsx` (default view `myday` → `command`), `src/components/app/CommandCentre.tsx` (ensure hero framing), keep `MyDay.tsx` for a later role view.
- **DB changes:** none.
- **Testing:** load `/app` → Command Centre renders first; the two-mode (auth + demo) render still works via `/demo/command-centre`; approve flow smoke test.
- **Deployment:** push → preview.

## Phase 3 — Data liveness I: Phone + Email enrichment  🟡→🟢 M (backend, CRITICAL)

- **Objective:** unblock the enrichment stall so real interactions reach `enriched` and flow to intelligence. (1834 stuck `pending`; only test data enriched.)
- **User outcome:** the system feels **alive** — real calls and emails appear as understanding, not raw rows.
- **Backend deps:** diagnose the promotion gap — phone has `phone_enrich.ts`; **email interactions have no equivalent `pending → enriched` promotion** (root-cause candidate). Likely fix: an email enrichment step (identity resolve + context) mirroring phone, wired into `interactions-scheduled-sync`/`identity-scheduled-sync`, plus draining the existing backlog. Also: retire the 2 dead-letter `email.gmail_sync` (`unsupported_job`) legacy jobs.
- **Frontend files:** none (data-only); surfaces already exist.
- **DB changes:** likely none structural (logic/scheduling); possibly an index on `interactions(processing_status, tenant_id)` for the drain. Confirm during diagnosis.
- **Testing:** extend `scripts/verify/` with an **enrichment verify suite** (seed real-shaped email/phone → assert reaches `enriched` → ledger → Observation); re-run `golden-loop` (34/34); `trace.ts` backlog drain shows real verdicts; assert backlog trends to ~0.
- **Deployment:** `supabase functions deploy` the changed enrichment functions; **do not** enable external comms; optionally activate the ingestion cron (`INTELLIGENCE_INGEST_SECRET` in Edge env + Vault + `serviceos_schedule_all`) — separate gated step.

## Phase 4 — Data liveness II: Commusoft + Microsoft 365  🔴 L (backend build)

- **Objective:** add the two named inputs so jobs/engineers/assets (Commusoft) and mail/calendar/docs (M365) flow into interactions + graph.
- **User outcome:** ServiceOS understands operational + calendar reality, not just calls/email.
- **Backend deps:** new connector adapters + OAuth/credential flow + sync edge functions (mirror the Simwood/Gmail pattern) + projection into `interactions` and `graph_nodes`. Registry entries already exist (`business.commusoft`, `comms.microsoft365`).
- **Frontend files:** `src/lib/connectors/registry.ts` status wiring; Integrations UI (`ops/centre`) to connect/authorise.
- **DB changes:** **new tables** — `commusoft_customers/jobs/engineers/assets`, `m365_messages/events/documents` (+ `tenant_connectors`/`connector_accounts` rows), plus `interactions` projection mappers. Migrations follow the existing per-source pattern.
- **Testing:** per-connector sync verify suite against a sandbox/test account (no production writes); assert projection → interaction → enriched → intelligence.
- **Deployment:** migrations (`db push`) then `functions deploy`; secrets in Edge env + Vault; connect via Integrations UI. **Larger effort — can run in parallel with Phases 5–7.**

## Phase 5 — Learning Centre  🟡→🟢 M (frontend on existing backend)

- **Objective:** the new INTELLIGENCE hero — "The company's continuous intelligence layer." Learning Health · Sources · Learning Timeline · Knowledge Graph.
- **User outcome:** "the system is always learning" — visible connector health, live signal stream, and the company memory graph.
- **Backend deps:** all existing — connector registry + `tenant_connectors` (health), `platform_events` + `intelligence_objects` + `graph_events` (timeline), `graph_nodes/edges` (graph), `system-health`. Documents stay 🔴 Preview.
- **Frontend files:** new `src/components/app/LearningCentre.tsx` + `src/lib/learning-feed.ts` (pure reads over the above, reusing `business-graph.ts`, `system-health.ts`, `command-feed` patterns); nav entry in `app.tsx`.
- **DB changes:** none required; optionally a read-only `learning_timeline` SQL view unifying events/observations/graph_events for one ordered stream.
- **Testing:** feed real rows → timeline renders in order; Sources reflects true connector status (3 live, rest "available"); graph view renders `graph_nodes`; verify no fabricated counts (documents shows "not connected", never "342 indexed").
- **Deployment:** push → preview.

## Phase 6 — Communications rebuild  🟢 M (frontend)

- **Objective:** one interaction layer — Phone + Email + unified timeline + AI summaries. Pull Email out of admin.
- **User outcome:** "what conversations has the company had?" in one place; each feeds Learning.
- **Backend deps:** existing `phone-feed`, `email-feed`, `interactions` (+ `email_ai_insights`, `phone_ai_insights`).
- **Frontend files:** promote `CallsComms.tsx` → `Communications` with Phone + **Email** tabs (reuse `admin/EmailOperations.tsx` reads), `UnifiedTimeline.tsx`; SMS/WhatsApp tabs = Preview.
- **DB changes:** none.
- **Testing:** Phone + Email tabs show real feeds; timeline merges both; AI-summary panels bind to real `*_ai_insights`; empty-state honesty.
- **Deployment:** push → preview.

## Phase 7 — Customer Intelligence pillar  🟡→🟢 L (frontend + light backend) — CORE PILLAR

- **Objective:** the moat — "ServiceOS understands a customer relationship better than any human." One customer view of: profile · interactions · jobs · assets · sentiment · value · risk · recommendations · AI memory.
- **User outcome:** open a customer and see the whole relationship + what to do next.
- **Backend deps:** existing `customer_cards`, `interactions`, `recommendations`; **direct `people`/`companies` reads** (currently only projected through cards — add tenant-scoped queries + RLS); jobs/assets from **Phase 4 (Commusoft)**; sentiment/value/risk derivable now from cards + interactions; `review_tasks` surfaced.
- **Frontend files:** new `src/components/app/CustomerDetail.tsx` (relationship view) replacing the thin Customers list; `src/lib/customer-intelligence.ts` (aggregator over cards/interactions/recs/graph); deepen `customer-cards.ts`.
- **DB changes:** RLS select policies for `people`/`companies` (tenant-scoped, authenticated); optionally a `customer_intelligence` read view aggregating per-customer signals; add `matching` accept/reject write (Edge function) for identity resolution.
- **Testing:** seed a rich customer (the Sarah scenario) → the detail view shows real timeline + risk + recs; "why this matters" pulls real signals; no field is fabricated (jobs/assets show "connect Commusoft" until Phase 4).
- **Deployment:** migrations (RLS/view) → `db push`; frontend push → preview.

## Phase 8 — Open Folk control-plane shell  🔴 M (gated; backend role)

- **Objective:** a super-admin-only platform plane, **architecture ready for multi-tenant** — Companies · Connectors (fleet) · AI Configuration · Platform Health. Real gating; management surfaces are honest Preview.
- **User outcome:** operators have a home for the platform; expansion path is visible, nothing pretends multi-tenancy exists.
- **Backend deps:** **new role** — extend `profiles.role` CHECK to add `platform_admin` (currently `owner|admin|ops|viewer`); `requireTenantUser`/`authz.ts` to recognise it; a route-level guard.
- **Frontend files:** new gated route `src/routes/openfolk.$.tsx` (or a `RequirePlatformAdmin` wrapper) + `src/components/openfolk/*` (Companies/Connectors/AIConfig/PlatformHealth — Platform Health can reuse real `system-health` for the single tenant; the rest = Preview).
- **DB changes:** `alter … profiles role check` to include `platform_admin`; RLS so only `platform_admin` reaches the plane; (future) a real `tenants` table + management — deferred.
- **Testing:** a non-platform-admin is denied the route; a platform_admin sees the shell; Platform Health shows real single-tenant data; Preview panels never fabricate cross-tenant numbers.
- **Deployment:** role migration → `db push`; frontend push → preview; grant the role via service-role admin tooling.

## Phase 9 — Remaining modules  🟡/🔴 M (mixed)

- **Objective:** rebuild what has a backend, keep the rest honest Preview.
- **Real now:** **Objectives** (rebuild North Star on the real `objectives` engine); **Protocol** (surface operational-modes/policy config).
- **Preview (need backend):** Growth Intelligence, Agents, Knowledge (documents/RAG), Marketing/Campaigns/Reviews.
- **Frontend files:** new `Objectives.tsx` (replaces hardcoded `NorthStar` exports); `Protocol` wired to modes/policies reads.
- **DB changes:** none for Objectives/Protocol (tables exist); Growth/Knowledge deferred to their backend.
- **Testing:** Objectives renders real objective health; Protocol reflects real modes; Preview modules clearly labelled.
- **Deployment:** push → preview.

---

## Sequencing & parallelism

```
1 Nav/IA ─▶ 2 Command Centre home           (quick coherence wins, week 1)
        └─▶ 3 Enrichment (CRITICAL) ─▶ real data starts flowing
                 4 Commusoft/365 (parallel, longer) ──┐
5 Learning Centre ─ 6 Communications ─ 7 Customer Intelligence  (fed by 3/4)
                 8 Open Folk shell (independent)
                 9 Remaining (Objectives real; rest Preview)
```

**Critical path to "feels alive":** Phase 3 (enrichment) — do this before/with the frontend
surfaces so Learning Centre, Communications and Customer Intelligence render real data, not
thin test data. Phase 4 (Commusoft/365) is the larger backend investment and can run in
parallel with the frontend phases; the surfaces degrade honestly (Preview) until it lands.

## Cross-cutting standards (every phase)
- Reuse the `ApiResult<T>` + `getSupabaseClient()` pattern; no parallel data layer.
- Writes only via Edge Functions (never client-side table mutations) — matches current arch.
- Every surface names its backing capability; no backend ⇒ honest Preview, never a fake dashboard.
- Verify each change end-to-end (the `/verify` approach + suites), tsc/lint/build green, then push to the branch → CI preview (no merge to `main` without approval).
- Backend changes: migration dry-run → `db push` → `functions deploy`, external-effect capabilities stay disabled.

## Decisions to confirm before construction
1. **Start point:** Phase 1+2 (nav + homepage) first for immediate coherence, in parallel with Phase 3 diagnosis?
2. **Phase 4 (Commusoft/365):** do you have sandbox/test credentials, or should it be scaffolded (adapters + tables) and left disconnected until creds exist?
3. **Enrichment cron activation** during Phase 3 (autonomous processing) — activate, or keep manual-drive until the surfaces are ready?
4. **Open Folk role:** add `platform_admin` to the profiles role model now (Phase 8), or gate on an env/allowlist until the multi-tenant backend is designed?
