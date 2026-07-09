# Navigation & Information Architecture v2

The sidebar was built organically during development. v2 restructures it to reflect
the actual product architecture — four operating sections that map to how the
business actually runs, and how OpenFolk's products will scale.

## The four sections

| Section          | One-line purpose       | Who lives here                        |
| ---------------- | ---------------------- | ------------------------------------- |
| **OPERATE**      | Run today's business   | Office staff, engineers, coordinators |
| **GROW**         | Increase revenue       | Marketing, sales, retention           |
| **INTELLIGENCE** | Understand and improve | Managers, analysts, AI/knowledge      |
| **CONTROL**      | Configure and govern   | Admins, platform owners               |

### OPERATE — run today's business

North Star · Cards · Operations · Calls & Comms · Customers · Engineers ·
Coordinator · Quote Engine · Assets · Further Works.

The daily work surface — where most people spend most of their day.

### GROW — increase revenue

ARR Growth · Marketing* · Campaigns* · Automations · Customer Journeys* · Reviews*.

Acquisition, retention, reactivation, marketing and automation. (* = honest
"Coming soon" placeholder — no fake metrics.)

### INTELLIGENCE — understand and improve

Intelligence · Knowledge · Agents · Protocol · Compliance · Numbers.

Insights, AI, knowledge, recommendations, reporting and governance.

### CONTROL — configure and govern

Operations Centre · Admin* · Settings.

Platform administration, monitoring and configuration. The Operations Centre now
lives under Control (it is platform monitoring, not daily work).

## What changed

- Sections **Spine / Surfaces / Intelligence** → **OPERATE / GROW / INTELLIGENCE / CONTROL**.
- **Learn → Knowledge** (label only; the route/key `learn` is preserved — no URL change).
- **Automations** moved to **GROW**.
- **Operations Centre** moved to **CONTROL** (route/key `admin` preserved).
- New placeholders (honest "Coming soon", no data): Marketing, Campaigns, Customer
  Journeys, Reviews, Admin.
- **Further Works** was not in the new section lists but is a working route, so it is
  **retained** under OPERATE (see audit).
- No URLs changed — the app is a single `/app` route with an internal `view` switch;
  every existing view key still resolves to its existing component.

## Route audit (recommendations only — nothing deleted)

- **Further Works** — retained under OPERATE. Recommendation: it is arguably a GROW
  surface (upsell pipeline); revisit once GROW pages are real.
- **Cards** (`CardsView`) — today a demo view; should become the customer/job card
  surface fed by the Customer Cards + Live Call Card foundations.
- **Customers** — should become a list → detail (customer card) view once `people` /
  `companies` / `customer_cards` are populated.
- **Operations** — should become the live jobs dashboard once a job connector exists.
- **Intelligence / Numbers / ARR Growth** — currently render hard-coded demo data;
  should become real dashboards from the signal/interaction layer.
- **Agents / Protocol / Marketing / Campaigns / Journeys / Reviews** — future modules;
  keep as placeholders until backed by real data.
- **Admin** (new, Control) vs **Settings** — Admin should host users/roles, connector
  governance and audit; Settings hosts branding/business/security. Keep distinct.

## How this scales (ServiceOS → ProductOS → OpenFolk)

The four verbs are product-agnostic — every OpenFolk product answers the same four
questions, so the shell stays stable while the contents specialise:

- **ServiceOS** (field service): Operate = jobs/calls/engineers; Grow = reactivation
  & reviews; Intelligence = call/job analytics; Control = connectors & compliance.
- **ProductOS** (product/commerce): Operate = orders/fulfilment/support; Grow =
  campaigns/journeys/LTV; Intelligence = product & cohort analytics; Control = catalog
  & platform config.
- **Any future OpenFolk product**: reuses OPERATE / GROW / INTELLIGENCE / CONTROL as the
  top-level IA; only the items within each section change. New surfaces slot into an
  existing verb rather than inventing new top-level nav — so users moving between
  OpenFolk products always know where to look.
