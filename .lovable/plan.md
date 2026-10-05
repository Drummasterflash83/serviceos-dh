
# ServiceOS × New Dawn — UX First Pass (Re-spine)

## The reframe

The app today reads as a general "company health" cockpit. The North Star is not general — it's a precision funnel to **£1.26M GP by Mar-28** via one engine: **Grow ARR → surface Further Works → convert fast at margin → protect the ratio → free the team.** Every screen below either moves a number on that engine or frees Rudi/Larne/Mary to do work that does.

The four pillars stay as *categories*. The **spine becomes the engine.** The Dashboard stops asking "how are we doing?" and starts asking "how far from £1.26M, and what's the next highest-leverage move?"

---

## Top-level navigation (rebuilt)

```text
SPINE (New Dawn engine, top of sidebar, in engine order)
  1. North Star          ← replaces "Dashboard"
  2. ARR Growth          ← new
  3. Further Works       ← new (the 48-hour cockpit)
  4. Quote Engine        ← new (Larne's Jarvis)
  5. Coordinator         ← new (the structural unlock)
  6. Assets              ← new (Plant-Room 360)

SURFACES (role-aware execution)
  7. Cards               ← keep, repointed (every card carries its New Dawn tag)
  8. Operations          ← keep (Rota, Parts & Vans, Supplier Hub, Warranty, PPM)
  9. Calls & Comms       ← keep, upgraded with SLA + complaint grading
 10. Customers           ← keep, adds Portal preview + retainer invitations
 11. Engineers           ← keep, adds Happiness / Super Ted score

INTELLIGENCE (the why behind the engine)
 12. Learn
 13. Intelligence
 14. Automations
 15. Agents
 16. Protocol
 17. Compliance          ← promoted out of Operations to its own view
 18. Numbers             ← keep, becomes the financial deep-dive under North Star
 19. Settings
```

`Dashboard` and `Finance` keys retire; `northstar`, `arr`, `furtherworks`, `quote`, `coordinator`, `assets`, `compliance`, `comms` are added.

---

## New views — what each one is

### 1. North Star (replaces Dashboard)
Hero shows **distance to £1.26M GP** as a single number with a 24-month glide path. Below it, the **7 Key Numbers** live as tiles, each with target / actual / delta / trend:
- GP £ (and GP margin %)
- ARR £ (milestones 249k → 360k Mar-27 → 700k Mar-28)
- PPM share of relationship income (target ≥ 45%)
- HMP concentration (target < 40% of ARR)
- FW : ARR ratio (target ~1.2x; today 2.8 / 1.9x flagged red)
- Average order value (target £2,566)
- SLT admin hours / week (Rudi & Heidi target < 5)

Each tile clicks through to its owning view. A **"Ratio Trap" banner** auto-fires when FW:ARR drifts > 1.5x. A **Next Highest-Leverage Move** card surfaces the single action with biggest forecast GP impact this week.

### 2. ARR Growth
Front of the funnel. Three panels:
- **Blue Ocean board** — 7 segments × named target accounts (Godolphin, White Horse, Elevate, Royal Lymington YC, …), each with status, owner, last touch, next action.
- **Renewal calendar** — every PPM renewal date, **HMP Feb-27 pinned as #1 risk** with countdown and mitigation plan.
- **Mary's 90-day nurture cycle** — rolling Kanban (Day 0 / 30 / 60 / 90) with auto-generated touches.

### 3. Further Works (48-hour cockpit)
A live queue of every FW opportunity surfaced from a PPM visit. Each row:
- countdown clock from job-close (15-min Slack alert → 48-hour quote deadline)
- owner, value, margin estimate
- **GP-floor gate** — quotes < 43% GP cannot be sent, only escalated
- status: identified / quoted / chasing / won / lost (+ reason)

Header KPI: **FW conversion %, average quote-turnaround, GP captured this month, £98k recovery glide path.**

### 4. Quote Engine (Larne's Jarvis)
The single point of failure, instrumented:
- **Drop zone** for job sheets / Google Sheet / supplier PDFs (CSV, XLSX, PDF, DOCX, images).
- **Auto-draft preview** with **3-supplier price compare** side-by-side, best price highlighted, GP % per line.
- **Part-name normaliser** with confidence + merge/keep-separate (the cylinder/Gledhill, 22mm copper problem).
- **Good / Better / Best** option builder carrying the engineer's "why."
- **Approval pop-up** — "Opportunity 41 is ready to approve" — one click sends.
- **GP-floor enforcement** at draft, not after the fact.

### 5. Coordinator Cockpit
Makes the structural unlock real. One screen showing what the Finance & Ops Coordinator is absorbing today:
- Commusoft job processing queue
- Timesheet / GPS reconciliation
- Compliance chasing
- FW quote production (links into Quote Engine)
- Tender assembly checklist
Plus **SLT admin-hours trend chart** (Rudi, Larne, Mary, Heidi) sloping toward < 5 hrs/wk — the visible proof the unlock is happening.

### 6. Assets (Plant-Room 360)
The identity shift from contractor → captive lifecycle partner:
- **Asset register** per site with 5-year plan, predictive failure flags, IoT readings (Chris's clip), warranty dates.
- **Asset Focused survey pipeline** (£3,500 / 60% GM) with conversion to install £ and PPM £.
- **Written condition reports** as a tangible deliverable (PDF preview, premium-branded).
- **Failure-precedes-call** prompts — "contact client before they experience a failure."

### 7. Compliance (promoted to top-level)
SFG20, SSIP, security clearance, MoJ framework as a **pipeline**, not a folder. Plus:
- Boiler registrations with deadline countdowns
- Cert / course expiries per engineer
- RAMS attachment status
- Missing engineer forms (open/closed flue, ASHP service)
- Audit-readiness score per contract type

### 8. Calls & Comms (upgraded)
Adds:
- **Response SLAs** by channel and customer tier
- **Complaint inbox** — system-graded red / orange / green, owned by Mary, never self-judged
- **Emergency routing** with a real backup to Tony's phone (named on-call rota)
- Sentiment + complaint-risk scoring on every recorded call

---

## Repointed (don't rebuild, just re-aim)

- **Cards** — every card now carries a New Dawn tag: `ARR`, `FW`, `Margin`, `Unlock`, `Compliance`. Filterable. The job/customer card surfaces the GP%, FW potential, and ratio impact.
- **Operations Hub** — keeps Rota, Parts & Vans, Supplier Hub (5 tabs), Warranty, PPM. **Parts & Vans** adds goods-in verification, dead-stock recovery (£50k), and feeds the Quote Engine's 3-supplier compare. **Supplier Hub** unlocks the 60%-volume finance deal.
- **Customers** — adds **Customer Portal preview** (service history, condition reports, markup transparency, direct booking, retainer invitation) and a "premium positioning" badge.
- **Engineers** — adds **Happiness / Super Ted** data-driven recognition score (tone & behaviour data, no peer voting), engineer-health surfacing, quick-reply bonus tracker.
- **Numbers** — repositioned as the financial deep-dive *under* North Star, with the +16.1 margin-point journey (29.1% → 43.2%) instrumented per job and per contract type.
- **Agents / Automations / Protocol / Learn / Intelligence** — unchanged structurally; copy updated so every item answers the test: *does this move GP / ARR / PPM / HMP, or free Rudi/Larne/Mary?*

---

## Cross-cutting: Margin Guardrail
Not a screen — a rule that lives inside Quote Engine and the job-close flow. Below 43% GP triggers a block + escalation, with a per-job margin badge visible everywhere the job appears (Cards, Operations, FW, Quote Engine, Numbers).

---

## Build order for this pass

Pass 1 (this turn):
1. Sidebar re-spine (new nav, new order, retire `dashboard`/`finance` keys).
2. **North Star** view — hero number, 7 KPIs, Ratio Trap banner, Next Highest-Leverage Move.
3. **ARR Growth**, **Further Works**, **Quote Engine**, **Coordinator**, **Assets**, **Compliance**, **Calls & Comms** as new components in `src/components/app/NorthStar.tsx` (grouped) — mocked data, semantic tokens.
4. Repoint **Cards** with New Dawn tag filter.
5. Add **Happiness / Super Ted** strip to Engineers and **Portal preview** strip to Customers.
6. Update Numbers headline to the GP-margin journey.

Out of scope this pass: live data wiring, Commusoft/QuickBooks integration, real IoT, real auth, PDF export of condition reports. All marked clearly as "mock" in the UI where relevant.

---

## Technical notes

- All new views live under `src/components/app/` and are mounted from `src/routes/app.tsx` via the existing `view` switch — no new routes, keeps current single-page shell.
- Icons from `lucide-react` only. Use semantic tone tokens (`success / warning / destructive / accent / muted`) — no hex, no `text-white`, no purple gradients.
- Plain English copy, **no em-dashes anywhere** (project-wide rule already in force).
- TypeScript: extend `ViewKey` union, drop `dashboard` and `finance` keys, add the 8 new ones.
- Each new view ships with mocked but realistic numbers calibrated to the North Star figures (£1.26M, £700k, 45%, 40%, 1.2x, £2,566, 43%, £98k, £50k).

---

## The test applied to every tile

> *Does this move GP toward £1.26M, ARR toward £700k, PPM share toward 45%, or HMP below 40% — or does it free Rudi, Larne, or Mary to do the work that does?*

If a tile in this plan doesn't pass that test, it gets cut before build. Nothing in the list above fails it.
