
# ServiceOS → Drummond Heating: UX Build Plan

Front-end UX only. No backend, no integrations, no data wiring. All numbers and lists remain illustrative. Existing visual language (white surfaces, hairline borders, semantic tokens, Numbers-page chart style, Agents card pattern) is reused throughout — no new design system.

---

## Guiding principles

- Adopt Heidi's vocabulary: **Protocol**, **Parameters**, **Wraparound**, **Plant Room Health** — not generic "SLA / rules / follow-up".
- Every new surface follows the established pattern: hero strip → stat tiles → main panel → click-into modal for detail.
- Nothing on a card runs out of its box; titles, primary numbers, and deltas line up across all tiles (continuing the recent Intelligence/Automations cleanup).
- Human-in-the-loop is visible everywhere agents act (approve / edit / send).

---

## Phase 1 — Core gaps from discovery (highest priority)

### 1.1 Response Protocol pillar (new top-level nav item)
The single biggest pain Heidi named. Becomes a first-class section.
- **Hero:** "Inside protocol · 14 of 17 active threads"
- **Parameter tiles:** Complaint response (24h), Quote follow-up (3d), Emergency call-back (15m), Warranty callback (48h) — each shows target, current avg, % inside protocol.
- **Live thread list:** caller / channel / clock counting down / owner / status chip (Inside / At risk / Breached).
- **Click-into modal:** full thread timeline, suggested next action, "Mark handled / Reassign / Escalate".

### 1.2 On-call & Emergency rota (new surface, lives under Operations)
Removes the Tony-single-point-of-failure story.
- Tonight / This week / Next week tabs.
- Primary on-call, Backup 1, Backup 2 cards with avatar, phone, last ack.
- "Emergency intake" panel: incoming call → routing tree visual → who it would hit right now.
- Modal: edit rota slot, swap engineer, mark unavailable.

### 1.3 Inbox & comms routing map (new surface, under Operations)
- Visual map: `office@`, `invoicing@`, `scheduling@`, website quote form, main phone line → owner → SLA.
- Mailbox health tiles per address: unread, oldest, avg response, % routed correctly.
- "Misrouted" queue: items that landed in the wrong inbox, with one-click re-route modal.

---

## Phase 2 — Operational depth

### 2.1 Parts & Van Stock (new surface, under Operations)
- Three tabs: **Store**, **Vans**, **Movements**.
- Store: parts grid with stock count, reserved, last counted.
- Vans: one card per engineer van, fill bar, top parts, "needs restock" chip.
- Movements: check-in / check-out log.
- Modal per part: usage history, recommended min, suppliers carrying it.

### 2.2 Supplier Price Normaliser (new surface, under Operations)
The "22mm copper pipe vs copper pipe 22mm" problem.
- Upload-CSV affordance (visual only — drop zone, no real upload).
- Normalised parts table: canonical name → supplier variants (collapsible rows) → best price highlighted.
- "Conflicts" panel: items where AI isn't confident, awaiting human merge — modal shows side-by-side compare + Merge / Keep separate.

### 2.3 Warranty Tracker (new surface, under Operations)
- Asset list with install date, warranty end, manufacturer, status chip (In warranty / Expiring 90d / Expired).
- "Recoverable callbacks" tile — £ value of work that should be billed back to manufacturer.
- Modal: full asset card, warranty doc placeholder, "Raise manufacturer claim" CTA.

---

## Phase 3 — Customer-facing & revenue surfaces

### 3.1 Asset Health — 5-year Visual (upgrade existing Asset Health agent)
Heidi's clearest sellable product.
- New "Customer Asset Stack" view inside Intelligence.
- Per-customer: asset list → 5-year timeline strip (service / likely failure / break-even-to-replace markers).
- Plant Room Health score (boiler + pumps + conveyors combined).
- Modal per asset: forecast cost curve, recommended action, "Generate customer report" CTA.

### 3.2 PPM & Service Reminders (new surface, under Operations)
- Calendar strip: next 90 days of due services.
- Contracts table: customer, asset count, renewal date, value, status.
- "Auto-prompt queue": upcoming 3-month cycles awaiting trigger — approve / snooze modal.

### 3.3 Wraparound & Reviews (new surface, under Customers or Agents detail)
- Completed-job feed with review status (Not sent / Sent / Received / Flagged).
- Big / problem jobs auto-flagged for Mary's personal touch.
- Modal: edit thank-you message, preview, send.

---

## Phase 4 — Cross-cutting upgrades

### 4.1 Agents → Approval Queue tab
Heidi explicitly wants human-approved automations.
- Tab inside Agents page showing all pending agent actions: follow-up emails, quote sends, complaint replies.
- Each row: agent, action, target, confidence, "Approve / Edit / Reject" — modal shows full draft.

### 4.2 Calls → Recurring Issues board
- New panel above call log: top 5 repeating customer issues this month, count, trend, linked jobs.
- Modal: drill into all calls tagged with that issue.

### 4.3 Dashboard additions
Three new snapshot tiles aligned with the existing 5-tile grid:
- **Inside protocol** (% — links to Response Protocol)
- **On-call tonight** (engineer name — links to rota)
- **Mailbox health** (oldest unread age — links to inbox map)

### 4.4 Settings → Systems Inventory
Heidi's stated first deliverable.
- Table: system (Commusoft, Perplexity, Trello, Drive, QuickBooks, Notion, Slack), owner, purpose, status, "in use / sunset".
- Modal per system: who uses it, last accessed, replacement candidate.

### 4.5 Numbers page additions
- New tile row: **Hours recovered from reactivity** (ties directly to Heidi's #1 pain).
- New tile: **Warranty £ recovered**.
- New tile: **PPM renewal value secured**.

---

## Navigation changes

Final left-nav order:
`Dashboard · Learn · Intelligence · Automations · Agents · Protocol · Operations · Calls · Customers · Numbers · Settings`

- **Protocol** is new (Phase 1.1).
- **Operations** becomes a layout page with sub-tabs: Rota · Inbox · Parts · Suppliers · Warranty · PPM.
- **Customers** is new and hosts Wraparound (Phase 3.3).
- Keep visual treatment of selected nav identical to today.

---

## Modal pattern (reused everywhere)

All new "click-into detail" surfaces use the existing `Dialog` component already wired in `src/routes/app.tsx`, matching the Agents detail modal style:
- Header: title + status chip + close.
- Body: 2-column on desktop (context left, actions right), stacked on mobile.
- Footer: primary action + secondary.

---

## Technical notes (for the build agent, not the user)

- All work confined to `src/routes/app.tsx` plus, if it gets large, extraction of new view components into `src/components/app/` (Protocol.tsx, Rota.tsx, Inbox.tsx, Parts.tsx, Suppliers.tsx, Warranty.tsx, PPM.tsx, Wraparound.tsx, SystemsInventory.tsx).
- Add a sub-router/tabs state inside Operations rather than new top-level routes — keeps URL surface unchanged.
- Extend `ViewKey` and `NAV` arrays; add `protocol`, `operations`, `customers` keys.
- Continue using `lucide-react` icons already imported; add only what's needed (e.g. `ShieldCheck` for Protocol — already imported, `Truck` for vans, `PackageSearch` for parts, `Receipt` for warranty, `CalendarClock` for PPM, `Inbox` for routing).
- No new dependencies, no Lovable Cloud, no server functions. All data stays as in-file illustrative constants matching the style used on Numbers / Agents today.

---

## Suggested build order

1. Phase 1.1 Response Protocol (biggest demo win)
2. Phase 4.3 Dashboard tiles (immediately shows Phase 1 value on home)
3. Phase 1.2 On-call rota
4. Phase 1.3 Inbox routing
5. Phase 4.1 Agents approval queue
6. Phase 3.1 Asset Health 5-year visual (sellable wow)
7. Phase 2.1–2.3 Parts / Suppliers / Warranty
8. Phase 3.2 PPM, Phase 3.3 Wraparound
9. Phase 4.2 Calls recurring issues, Phase 4.4 Systems Inventory, Phase 4.5 Numbers additions

Each phase is independently shippable so the client can review after every step.
