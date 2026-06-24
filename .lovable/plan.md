# SERVICEOS — Premium Pitch + Product Demo

A two-route TanStack Start experience: a 15-section scroll pitch at `/` and a pseudo-product Command Centre at `/app`. Apple-grade visual quality, fully frontend (no backend).

## Design System (src/styles.css)

- Background `#FFFFFF`, alt section `#F8FAFC`, text `#0A0A0A`, accent `#2563EB`, muted greys for panels
- Type scale: hero 96–120px, section heads 56–80px, sub 28–42px, body 18–22px, tight tracking, generous leading
- Font: Inter Tight (display) + Inter (body), loaded via `<link>` in `__root.tsx`
- Tokens added to `@theme inline`: `--color-accent`, `--color-surface-alt`, `--font-display`, gradient + shadow tokens
- Motion: Framer Motion (`motion` package). Scroll reveals, parallax, staggered entrances, hover lifts. No bouncy/tacky easing — use `[0.22, 1, 0.36, 1]`

## Dependencies
- `bun add motion` (Framer Motion for React)
- `bun add lucide-react` (already present — verify)

## Route Architecture

```
src/routes/
  __root.tsx         (fonts, nav, meta)
  index.tsx          (pitch experience — composes all 15 sections)
  app.tsx            (Command Centre demo with sidebar)
```

Each route gets its own `head()` metadata. Nav bar is a slim sticky glass header with SERVICEOS wordmark + links to `/` and `/app`.

## Pitch Page Sections (`/`)

Each section is its own component under `src/components/pitch/`:

1. **Hero** — full viewport, animated wordmark, dual CTAs, scroll-driven shrink
2. **HiddenProblem** — two-beat reveal, floating disconnected system chips (Commusoft, QuickBooks, Slack…) drifting in fragmented orbits
3. **CostOfFriction** — 4 metric cards with count-up numbers on scroll into view
4. **WhyAINow** — chaos → intelligence animated transition (particle cluster condensing into grid)
5. **IntroducingServiceOS** — 5-layer architecture stack, hover highlights, click opens dialog with detail
6. **CaptureLayer** — 5 cards (Phone/Workflow/Email/API/Asset), hover expands
7. **WorkflowIntelligence** — animated flow diagram Commusoft → Supplier → PDF → Quote → Approval with SVG path draw + floating "74% Automation" stat
8. **VoiceIntelligence** — call-flow diagram + sample transcript card
9. **AgentLayer** — 4 agent cards with live status dots, current task, confidence bar
10. **CommandCentrePreview** — embedded mini dashboard (sells the link to `/app`)
11. **Security** — 5 shield cards, calm confident tone
12. **Roadmap** — horizontal scroll-driven timeline, 5 phases
13. **ROI** — before/after table with animated value transitions
14. **StrategicFuture** — visionary copy + subtle dotted world map SVG
15. **Closing** — huge typography reveal, primary + secondary CTA

Shared primitives in `src/components/pitch/primitives/`: `SectionShell`, `Eyebrow`, `Reveal` (intersection-observer fade-up), `CountUp`, `GlassCard`.

## /app Command Centre

Layout: fixed left sidebar (Dashboard, Operations, Calls, Workflow Intelligence, Agents, Finance, Settings) + main content area. Sidebar selection is local state; each view is a static mock screen.

- **Dashboard** (default): widgets — Live Jobs 42, Calls Waiting 8, Engineers Available 11, Revenue Today £18,400, Complaint Risk gauge, AI Insights feed (3 items)
- **Operations**: jobs table mock
- **Calls**: list of recent calls with transcript preview drawer
- **Workflow Intelligence**: process-mining graph mock
- **Agents**: 4 agent cards mirroring section 9
- **Finance**: revenue chart mock (simple SVG sparkline, no chart lib)
- **Settings**: static form

Style: Bloomberg/Palantir density on a white canvas, monospaced numbers, hairline borders, subtle inner shadows.

## Quality Bar
- Zero hardcoded color utilities — semantic tokens only
- No stock-photo placeholders; all visuals are SVG/CSS/typography
- Motion is restrained: one signature animation per section, never all at once
- Mobile: stacks gracefully, hero scales down, dashboard becomes single column

## Technical Notes
- All data is hardcoded mock data colocated with components
- No Lovable Cloud needed
- SEO: per-route titles + OG; `og:image` skipped (no generated hero image in v1)
- Replace placeholder `index.tsx` entirely