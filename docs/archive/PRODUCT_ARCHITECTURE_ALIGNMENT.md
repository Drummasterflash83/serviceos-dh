> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Navigation & IA](../architecture/09_NAVIGATION.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# ServiceOS / Open Folk — Product Architecture Alignment (no code)

_Supersedes and extends `FRONTEND_ALIGNMENT_AUDIT.md` with the full operating model,
Learning Centre, Open Folk control plane, and a component-ownership plan. Read-only.
Awaiting approval before any construction._

**Reality tags used throughout:** 🟢 **LIVE** (wired to real backend) · 🟡
**FOUNDATION** (backend exists, surface missing/partial) · 🔴 **ASPIRATIONAL** (backend
not built — must stay honest placeholder, never a fake dashboard).

---

## 1. Current architecture assessment

**The backend is an operating system; the frontend is a demo deck with a few real
surfaces bolted on.** Of 27 nav items, **5 are truly wired**; ~17 are hardcoded demo; 5
are honest "coming soon". The clean tell: views **extracted into `components/*` are real**;
the big functions **inline in `app.tsx` import no data layer** and are all static.

What is genuinely built (and often hidden):

- 🟢 **Intelligence loop** → surfaced only in the **Command Centre** (the one story-first surface).
- 🟢 **Operations/connector plane** — jobs, queues, connector health, scheduler, phone+email ops — a deep real surface, but buried in the `admin` "Operations Centre" and skewed to **infrastructure**, not business narrative.
- 🟢 **Customers / My Day / Calls & Comms** — real reads (customer_cards, interactions, phone feed, recommendations, live calls).
- 🟢 **Knowledge graph** (`graph_nodes/edges/events`) — real, exposed thinly inside Operations Centre only.
- 🟢 **Connector catalogue** — `lib/modules/registry.ts` + `lib/connectors/registry.ts` list ~24 connectors; **only 3 are live pipelines** (Simwood phone, Gmail, Google Workspace).

What is **not** built (must not be faked):

- 🔴 **Documents / RAG / company knowledge base** — no documents table, no embeddings.
- 🔴 **Most connectors** (Commusoft, Slack, M365, QuickBooks, Drive, Calendar…) — catalogued, not ingesting.
- 🔴 **Open Folk multi-tenant control plane** — single tenant only; nothing reads `tenants`; "OpenFolk" in code is the **decision-authority** layer (`openfolk-core`, `openfolk_review`), not a companies/AI-config console.
- 🟡 **Learning loop** — a `learning.ts` primitive exists (`proposeImprovement`); no learning data surface.

**Drift / duplication:** two Operations surfaces, two Communications surfaces (Email is
trapped in admin), two customer-card modules (`cards.ts` + `customer-cards.ts`); orphaned
backend (`review_tasks`, `automation_approvals` read, `objectives`, direct
`people`/`companies`); dead code (`Dashboard`, `Calls` in app.tsx); non-functional stubs
(platform-jobs retry/cancel). **The enrichment stall** (1834 interactions stuck `pending`)
starves every real surface of genuine data — the #1 systemic blocker.

---

## 2. Recommended product architecture (the operating model → real backend)

```
INPUTS ─▶ LEARNING ─▶ INTELLIGENCE ─▶ DECISIONS ─▶ ACTIONS ─▶ OUTCOMES ─▶ (LEARNING)
```

| Layer | What it is | Backend reality | Surface |
|---|---|---|---|
| **Inputs** | Raw material entering the company | 🟢 phone (Simwood), email (Gmail/Workspace) live; 🔴 ~21 more catalogued only | Sources tab (Learning Centre) |
| **Learning** | Continuous understanding: interactions → identity → graph | 🟢 interactions, identity, `graph_nodes/edges`; 🟡 no docs/RAG; 🟡 learning primitive only | **Learning Centre** (new) |
| **Intelligence** | Understanding becomes useful: observations, decisions, recommendations, risks | 🟢 `intelligence_objects`, `decision_log`, `recommendations`, `outcomes` | **Command Centre** ⭐ |
| **Decisions** | Governance: what should happen, who approves | 🟢 decision engine, operational modes, `review_tasks` (unsurfaced) | Command Centre + review queue |
| **Actions** | Controlled execution | 🟢 automation engine, `automation_intents`, approvals — internal-only capabilities | Command Centre approvals |
| **Outcomes** | Recorded results, feeding learning | 🟢 `outcomes`, `platform_events` | Command Centre + Learning timeline |

**Principle:** every surface tells the *story* of a layer ("ServiceOS understands your
conversations and tells you what matters"), never "here is the calls table." Today only the
Command Centre passes that test — the target is to make Learning Centre, Customers and
Communications pass it too, using data that already exists.

---

## 3. Navigation redesign

Current: OPERATE(11) / GROW(6) / INTELLIGENCE(7) / CONTROL(3) = 27 items. Proposed —
lead with real surfaces, one new hero (Learning Centre), Open Folk as a separate gated
plane:

```
HEARTBEAT
  ⭐ Command Centre         🟢  DEFAULT landing (currently My Day). Attention · risks ·
                                approvals · recommendations · outcomes · health

OPERATE
  Customers                🟢→deepen  relationship intelligence: card + interaction timeline +
                                people/companies + value/sentiment/risk + AI memory
  Communications           🟢→merge   Phone + Email (pull out of admin) + unified timeline + AI
                                summaries. The interaction layer — NOT the intelligence engine.
  Operations               🟢→promote jobs · engineers · scheduling · assets — built from real
                                Operations-Centre data (retire demo twins; engineers/assets that
                                need Commusoft stay 🔴 PREVIEW)

INTELLIGENCE
  Learning Centre ⭐        🟡  NEW hero: Learning Health · Sources (registry+status) · Learning
                                Timeline (from real events/graph) · Knowledge Graph (graph_nodes)
  Knowledge                🔴  documents/RAG — PREVIEW until backend exists
  Agents                   🔴  PREVIEW
  Protocol                 🟡  rules/modes/policies exist server-side — surface real config

GROW  (commercial — mostly roadmap)
  Revenue · Retention · Marketing · Campaigns · Reviews    🔴 PREVIEW (honest placeholders)

CONTROL  (operator/admin — infrastructure, correctly technical)
  Operations Centre        🟢  connectors · jobs · queues · scheduler · sync health
  Settings · Compliance · Integrations

─────────────  OPEN FOLK CONTROL PLANE (super-admin only — separate app/route)  ─────────────
  Companies (tenants)      🔴  needs multi-tenant management — ASPIRATIONAL
  Connectors (fleet)       🟡  registry exists; per-tenant credential/health mgmt partial
  AI Configuration         🔴  models/prompts/policies management — ASPIRATIONAL
  Platform Health          🟡  system_health exists per-tenant; cross-tenant rollup ASPIRATIONAL
```

Open Folk is the operator plane over many ServiceOS deployments ("AWS console for AI
operating systems"). Today it's single-tenant, so it should be a **clearly-gated,
mostly-PREVIEW** surface — the architecture (everything is `tenant_id`-scoped) supports it,
the management UI + data do not exist yet.

---

## 4. Component ownership plan (KEEP / REBUILD / MOVE / REMOVE / PREVIEW)

| Disposition | Components | Rationale |
|---|---|---|
| **KEEP** (real, good) | `CommandCentre.tsx` (+View), `MyDay.tsx`, `CallsComms.tsx`, `UnifiedTimeline.tsx`, `NewViews.Customers`, `ops/centre/*` + `ops/*`, `SystemHealth.tsx`, `DailyBriefing.tsx`, `LiveCallCard.tsx`, `AuthDiagnostics.tsx`, all real `lib/*` data modules, `command-*` | Wired to real backend; the product's spine |
| **MOVE** | Command Centre → default view; **Email ops → Communications** (out of admin); Operations Centre → CONTROL group; Knowledge-graph view → Learning Centre | Reposition real surfaces to match IA |
| **REBUILD** (demo → wire to existing backend) | North Star → real **Objectives** engine; `Cards.tsx` CardsView → real `customer_cards`; Protocol → real operational-modes/policy config; Intelligence view → real intelligence-object detail | Backend exists; replace hardcoded arrays |
| **REMOVE** (dead/duplicate) | `Dashboard` (app.tsx:242), `Calls` (app.tsx:848) dead views; consolidate `cards.ts` ↔ `customer-cards.ts`; inline `Operations` demo tabs; non-functional platform-jobs retry/cancel stubs | Reduce confusion + duplication |
| **PREVIEW ONLY** (no backend — honest placeholder) | Marketing, Campaigns, Journeys, Reviews, Agents, Knowledge(docs), Numbers/Finance, Engineers/Quote/Assets (need Commusoft/FSM), Open Folk plane | Never a beautiful UI with fake data |

Rule enforced: **do not delete a component without mapping it here**; nothing moves to
PREVIEW that has a real backend; nothing is faked.

---

## 5. Data connection map (backend capability → surface)

| Capability | Table(s)/fn | Surface (target) | Reality |
|---|---|---|---|
| Intelligence loop | intelligence_objects, decision_log, automation_intents, outcomes, platform_events | Command Centre | 🟢 |
| Approvals / review | automation_approvals (write), **review_tasks** | Command Centre + **review queue (new)** | 🟢 / 🟡 orphaned read |
| Recommendations | recommendations | Command Centre, Customers, Ops Centre | 🟢 |
| Customer cards + relationships | customer_cards; **people/companies (direct)** | **Customers (deepen)** | 🟢 / 🟡 people/companies unqueried |
| Interactions | interactions | Communications timeline, Customers, Learning | 🟢 |
| Phone | phone_calls/recordings/transcripts/ai_insights | Communications (Phone) | 🟢 |
| Email | email_messages/threads/ai_insights/workspace | **Communications (Email)** — currently admin-only | 🟢 misplaced |
| Live calls | live_call_sessions | LiveCallCard, Communications | 🟢 |
| Knowledge graph | graph_nodes/edges/events | **Learning Centre → Knowledge Graph** | 🟢 hidden |
| Connectors | tenant_connectors + registry | Sources (Learning) + Ops Centre + Open Folk | 🟢 (3 live) / 🔴 (21 catalogued) |
| System/scheduler health | system_health_*, platform_jobs | System Health, Ops Centre, Platform Health | 🟢 |
| **Objectives** | objectives | **Objectives (rebuild North Star)** | 🟡 orphaned |
| Learning loop | learning.ts (corrections→improvements) | Learning Centre → Learning Health | 🟡 primitive only |
| **Documents/knowledge** | — | Knowledge | 🔴 not built |
| **Multi-tenant mgmt** | tenants (unread) | Open Folk → Companies | 🔴 not built |

---

## 6. Implementation roadmap

Sequenced so each phase ships something real; backend-dependent surfaces are gated behind
their capability. **Frontend-only** phases are safe; **needs-backend** phases are flagged.

- **Phase 1 — Navigation + IA (frontend).** Restructure the sidebar to the proposal; label PREVIEW surfaces honestly; remove dead/duplicate components. No new data.
- **Phase 2 — Command Centre becomes the true homepage (frontend).** Default view; fold in briefing/health; ensure it's the first thing on load. _(Also: set `VITE_SUPABASE_ANON_KEY` in host env — the "logged out" root cause.)_
- **Phase 3 — Learning Centre (frontend on existing backend).** Learning Health (connector status + counts), Sources (registry + live status), Learning Timeline (from real `platform_events`/`intelligence_objects`/`graph_events`), Knowledge Graph view (`graph_nodes/edges`). Documents stay 🔴 PREVIEW.
- **Phase 4 — Communications rebuild (frontend).** Pull Email out of admin; unify Phone + Email + interaction timeline + AI summaries into one interaction layer. Reuse `phone-feed`/`email-feed`/`interactions`.
- **Phase 5 — Customer intelligence (frontend + light backend).** Deepen the customer card into relationship intelligence: interactions timeline, people/companies (needs direct queries — small backend), value/sentiment/risk, recommendations, "why this matters". Surface `review_tasks`. This is the moat.
- **Phase 6 — Open Folk control plane (needs backend first).** Multi-tenant management, connector fleet, AI config, cross-tenant health. Mostly 🔴 — build the backend before the UI; ship as gated PREVIEW meanwhile.
- **Phase 7 — Remaining modules (mixed).** Objectives (rebuild North Star, backend exists 🟡); Growth/Marketing/Reviews (🔴 need backend); Agents/Knowledge-docs (🔴).

- **Phase 0 (systemic, backend, parallel) — fix the enrichment stall.** `pending → enriched`. Until real interactions enrich, every 🟢 surface stays thin. Highest leverage for making the whole product feel alive; pairs with Phase 5.

---

## Constraints honoured
No parallel data layers, no fake dashboards, no deleting components without mapping, no
replacing the proven backend. Every proposed surface names its backing capability; where
there is none it's 🔴 PREVIEW. Reuse existing Supabase patterns, auth, `ApiResult<T>`, the
intelligence objects, and the Command Centre architecture.

## Decisions needed before any code
1. **Nav/IA (Phase 1):** adopt the proposed structure (HEARTBEAT/OPERATE/INTELLIGENCE/GROW/CONTROL + gated Open Folk)?
2. **Command Centre as default homepage** (replacing My Day) — yes?
3. **Learning Centre naming:** "Learning Centre" vs "Company Memory" vs "Business Intelligence"?
4. **PREVIEW policy:** convert hardcoded demo views to honest placeholders now, or leave until each is wired?
5. **Sprint scope:** frontend-only (Phases 1–4) first, or include the backend items (enrichment stall, people/companies queries, multi-tenant)?
6. **Open Folk:** in scope now (as gated PREVIEW shell), or deferred until multi-tenant backend exists?
