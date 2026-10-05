> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Navigation & IA](../architecture/09_NAVIGATION.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# ServiceOS — Frontend Alignment Audit (no code changes)

_Read-only audit of the `/app` product surface against the backend that now exists.
Deliverables: (1) frontend map, (2) backend↔frontend capability map, (3) navigation
proposal, (4) Green/Amber/Red truth table, (5) prioritised roadmap. Awaiting approval
before any code._

---

## Executive summary

The backend is an AI operating system; the frontend is still mostly a **demo pitch deck
of CRM/FSM modules**. Of **27 nav items, only 5 are real** (wired to live Supabase); the
other ~17 render hard-coded arrays and 5 are honest "Coming soon" placeholders.

Three structural truths:

1. **A clean two-tier split.** Views extracted into `src/components/app/*` and
   `src/components/ops/centre/*` are the **real** ones; the large view functions defined
   **inline inside `app.tsx`** import no data layer at all (only `cn`/`auth`) — they are
   all static demo. So "real vs fake" tracks almost perfectly with "extracted component
   vs inline in app.tsx."
2. **The crown-jewel backend is surfaced, but singular.** The intelligence loop shows up
   in exactly one place — the **Command Centre** — which is the only surface that tells a
   business _story_. Everything else that's real (Operations Centre, System Health) is an
   **operator/infrastructure dashboard** (jobs, queues, connectors), not business
   understanding.
3. **The real data is thin, and that's a backend problem.** Even the GREEN views are
   under-fed because the **enrichment stage is stalled** (Phase 8 finding: 1834
   interactions stuck at `pending`, only 12 — all test — ever reached `enriched`). This is
   the #1 systemic blocker: it starves every real surface of genuine customer data.

**The product isn't missing backend capability — the frontend just doesn't reflect it,
and the good surfaces are buried among demo modules.**

---

## Deliverable 1 + 4 — Frontend map & truth table (combined)

Default landing view is **My Day** (`app.tsx:116`); the whole `/app` is `RequireAuth`-gated
(so a missing `VITE_SUPABASE_ANON_KEY` bounces the entire app to `/login`).

| Group | View | Component | Data source | Status |
|---|---|---|---|---|
| OPERATE | **My Day** | `MyDay.tsx` | interactions, customer-cards, matching, recommendations, live-calls | 🟢 GREEN |
| OPERATE | North Star | `NorthStar.tsx` | inline `glide[]` | 🔴 RED (hardcoded) |
| OPERATE | Cards | `Cards.tsx` | inline `JOBS`,`CUSTOMERS` ("ABC School","Tony") | 🔴 RED |
| OPERATE | Operations | `NewViews` OperationsHub + **inline** `Operations` | recs/cards (real) **+** inline `jobs`,`Rota`,`PartsStock`… | 🟠 AMBER (real shell, demo tabs) |
| OPERATE | **Calls & Comms** | `CallsComms.tsx` + `UnifiedTimeline` | phone-feed (`phone_calls/recordings/transcripts/ai_insights`), interactions | 🟢 GREEN |
| OPERATE | **Customers** | `NewViews.tsx:1218` | customer-cards, recommendations | 🟢 GREEN |
| OPERATE | Engineers | `Engineers.tsx` | inline `ENGINEERS[]` | 🔴 RED |
| OPERATE | Coordinator | `NorthStar.tsx:569` | inline `queues`,`trend` | 🔴 RED |
| OPERATE | Quote Engine | `NorthStar.tsx:425` | inline `draft`,`normaliser` | 🔴 RED |
| OPERATE | Assets | `NorthStar.tsx:654` | inline `sites` ("1,406 assets") | 🔴 RED |
| OPERATE | Further Works | `NorthStar.tsx:347` | inline `rows` | 🔴 RED |
| GROW | ARR Growth | `NorthStar.tsx:238` | inline `segments`,`renewals` | 🔴 RED |
| GROW | Marketing | `<ComingSoon>` | none | 🔴 RED (honest placeholder) |
| GROW | Campaigns | `<ComingSoon>` | none | 🔴 RED (honest placeholder) |
| GROW | Automations | `app.tsx:2831` | inline `statTiles`,`AutomationItem[]` | 🔴 RED |
| GROW | Customer Journeys | `<ComingSoon>` | none | 🔴 RED (honest placeholder) |
| GROW | Reviews | `<ComingSoon>` | none | 🔴 RED (honest placeholder) |
| INTELLIGENCE | **Command Centre** | `CommandCentre.tsx` | command-feed (intelligence loop) + System Health + Daily Briefing | 🟢 GREEN |
| INTELLIGENCE | Intelligence | `app.tsx:2357` | inline `statTiles`,`Upgrade[]` | 🔴 RED |
| INTELLIGENCE | Knowledge | `app.tsx:1879` | inline `insights`,`workflows` | 🔴 RED |
| INTELLIGENCE | Agents | `app.tsx:1059` | inline `AgentItem[]` (+ RED ApprovalQueuePanel) | 🔴 RED |
| INTELLIGENCE | Protocol | `NewViews.tsx:88` | inline `PROTOCOL_PARAMS` | 🔴 RED |
| INTELLIGENCE | Compliance | `NorthStar.tsx:761` | inline `credentials`,`certs`,`gaps` | 🔴 RED |
| INTELLIGENCE | Numbers | `app.tsx:1309` | inline `revenue[]`,`headline` | 🔴 RED |
| CONTROL | **Operations Centre** | `ops/centre/OperationsCentre.tsx` | platform-jobs, interactions, cards, matching, scheduler-health, live-calls, identity, business-graph, email/phone ops, connectors | 🟢 GREEN (deepest real surface) |
| CONTROL | Admin | `<ComingSoon>` | none | 🔴 RED (placeholder) |
| CONTROL | Settings | `app.tsx:1475` | inline static config | 🔴 RED |

**Real, wired widgets** (all 🟢): `LiveCallCard` (live_call_sessions), `SystemHealth`
(system_health_*), `DailyBriefing` (derived from real feed), `AuthDiagnostics` (dev-only,
prod-gated), `UnifiedTimeline` (interactions).

**Dead code:** `Dashboard` (`app.tsx:242`) and `Calls` (`app.tsx:848`) are defined but
never rendered (superseded by MyDay/CallsComms).

---

## Deliverable 2 — Backend → frontend capability map

| Backend capability | Surfaced in frontend? | Where |
|---|---|---|
| Intelligence objects / decisions / intents / outcomes / events | ✅ | Command Centre (via `command-feed`) |
| Human approval (write) | ✅ | Command Centre → `intelligence-review-action` |
| **`review_tasks`** (the human review queue) | ❌ **orphaned** | no reader anywhere |
| **`automation_approvals`** (read) | ❌ **write-only** | never displayed |
| Recommendations | ✅ | My Day, Customers, Operations Centre |
| Customer cards | ✅ | Customers, My Day, Operations Centre |
| **`people` / `companies`** (direct) | ⚠️ | only projected _through_ `customer_cards`; never queried directly → shallow relationship view |
| Interactions | ✅ | My Day, Calls & Comms (UnifiedTimeline), Operations Centre |
| Phone (calls/recordings/transcripts/AI insights) | ✅ | Calls & Comms, Operations Centre |
| **Email (messages/threads/AI insights/workspace)** | ⚠️ | **only inside admin Operations Centre** → not a first-class comms surface |
| Live calls | ✅ | LiveCallCard, My Day |
| Platform jobs | ✅ (read) | Operations Centre; **retry/cancel are non-functional stubs** |
| System / scheduler health, business graph | ✅ | System Health widget, Operations Centre |
| **Objectives engine** | ❌ **orphaned** | North Star UI is 100% hardcoded — the real objectives backend has no surface |
| Matching (`interaction_match_suggestions`) | ⚠️ | read-only; no accept/reject write path |

**Orphaned backend (built, no UI):** `review_tasks`, `automation_approvals` (read),
`objectives`, direct `people`/`companies`. **Duplication:** two customer-card modules
(`customer-cards.ts` + `cards.ts`); two Operations surfaces (`operations` view + Operations
Centre); two comms surfaces (Calls & Comms + Operations Centre → Communications).

---

## Deliverable 3 — Navigation proposal

Current: 27 items across OPERATE(11)/GROW(6)/INTELLIGENCE(7)/CONTROL(3). Proposed: lead
with the 5 real surfaces, quarantine demo/roadmap, and pull Email up to first-class.

```
HEARTBEAT
  ⭐ Command Centre        [GREEN]  default landing (currently My Day)
                                    what needs attention · risks · approvals · health

OPERATE  (business understanding — story-first, not tables)
  Customers                [GREEN → deepen]  relationship intelligence: card + interactions
                                    timeline + people/companies + value/sentiment/risk + AI memory
  Communications           [GREEN → merge]   Calls & Comms + Email (pull out of admin) +
                                    unified interaction timeline + AI summaries
  Operations               [GREEN → promote] jobs/scheduling/engineers/assets/quotes built
                                    from real Operations-Centre data (retire the demo twins)

GROW  (roadmap — clearly labelled "Preview")
  Revenue · Reviews · Campaigns · Journeys    [RED]  keep as honest placeholders, not fake data

INTELLIGENCE  (the brain — mostly roadmap today)
  Intelligence (objects/decisions detail) · Agents · Knowledge · Protocol   [RED preview]

CONTROL  (operator / admin — infrastructure, correctly technical)
  Operations Centre        [GREEN]  connectors · jobs · queues · scheduler · sync health
  Settings · Compliance · Users/Admin
```

Key moves: (1) **Command Centre = default home**. (2) **Email → Communications** (it's real,
just buried in admin). (3) **Reposition Operations Centre as the operator/admin surface**
(it exposes plumbing) and build a business-facing Operations view from its data. (4)
**Quarantine the ~13 hardcoded demo views** behind an explicit "Preview" treatment so no
one sees a polished screen with fabricated data.

_Guiding principle (yours):_ a surface should say "ServiceOS understands your customer
conversations and tells you what matters," not "you are looking at the calls table."
Today only the Command Centre passes that test.

---

## Deliverable 5 — Prioritised roadmap

### Immediate (confidence blockers — small, high-trust)
1. **Make Command Centre the default view** (currently My Day) — the heartbeat should open first.
2. **Set `VITE_SUPABASE_ANON_KEY` in the host env** — root cause of the "logged out" symptom (config, not code).
3. **Pull Email into a first-class Communications surface** (reuse `email-feed.ts`, already real).
4. **Quarantine/label the RED demo views** so users never see a beautiful UI with no data (your core rule). Prefer honest `<ComingSoon>` over fake arrays.
5. **Hide or implement the dead controls** — platform-jobs retry/cancel stubs, dead `Dashboard`/`Calls` components.

### Phase 2 (connect existing backend into UI — no new backend)
1. **Customer relationship intelligence** (the moat): on the customer card, surface the real interactions timeline, linked people/companies, value, sentiment, risk, recommendations, and "AI memory / why this matters." Backend already has the pieces.
2. **Surface `review_tasks`** — the human review queue is built but invisible.
3. **Replace hardcoded North Star with the real Objectives engine.**
4. **Matching accept/reject** write path (identity resolution is a real workflow).
5. **Deepen the intelligence-object detail** ("why this surfaced", evidence, lineage) from the Command Centre.

### Phase 3 (future surfaces — need backend first)
- Agents, Knowledge, Growth intelligence — build the UI when the backend capability lands; keep as honest placeholders until then.

### Systemic (backend, unblocks everything above)
- **Fix the enrichment stall** (`pending → enriched`). Until real interactions enrich, every GREEN surface stays thin. This is the single highest-leverage fix for making the whole frontend feel _alive_ with real data — and it dovetails with the relationship-intelligence phase.

---

## Development rules honoured
No parallel systems — reuse existing Supabase patterns, auth, `ApiResult<T>` query layer,
the intelligence objects, and the Command Centre architecture. Every proposed surface names
its backing capability; where there is none, it's flagged RED/preview, not faked.

**Open questions for you before any code:** (a) approve making Command Centre the default?
(b) merge Email into Communications, or keep it in admin? (c) for the ~13 demo views —
quarantine as "Preview", wire where a backend exists, or delete? (d) is fixing the
enrichment stall in scope for this sprint, or a separate backend task?
