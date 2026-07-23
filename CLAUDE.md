# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Branch note.** The "What this is" section below describes the `main` branch (a
> front-end prototype with no backend). The `serviceos-backend-foundation` branch has
> a **real Supabase Intelligence → Automation backend** (54 migrations, ~45 edge
> functions). The definitive architecture for that platform — what ServiceOS is as an
> AI operating system, its Core Loop, engines, and the eight-screen product — is the
> manual at **[docs/README.md](docs/README.md)**. Read it before doing backend or
> product work on that branch.

## What this is

**ServiceOS** — a bespoke, SSR React marketing + product-demo site built for Drummond Heating ("Drummonds"). It is a **presentation/prototype**, not a live system: there is no backend, database, or auth. Every view renders hard-coded demo data (jobs, calls, agents, health scores) defined inline in the components. When editing, you are shaping a pitch narrative, not wiring real data — keep the copy and numbers internally consistent with the "New Dawn engine" story in [.lovable/plan.md](.lovable/plan.md).

Two surfaces:
- `/` ([src/routes/index.tsx](src/routes/index.tsx)) — the long-scroll marketing pitch page.
- `/app` ([src/routes/app.tsx](src/routes/app.tsx)) — the interactive product demo (a sidebar-driven single-page "command centre").

## Commands

This project uses **Bun** (`bun.lock`, `bunfig.toml`). The stray `package-lock.json` is not the source of truth — prefer `bun install`.

```bash
bun install          # install deps (24h supply-chain guard via bunfig.toml)
bun run dev          # vite dev server
bun run build        # production build (Vite + nitro; Vercel auto-detects its preset, cloudflare locally)
bun run build:dev    # build in development mode
bun run preview      # preview a build
bun run lint         # eslint over the repo
bun run format       # prettier --write .
```

There is **no test suite** and no typecheck script; `tsc` runs with `noEmit` for editor/IDE checks only. Verify changes by running `bun run dev` and `bun run lint`.

## Architecture

**Stack:** TanStack Start (SSR) + TanStack Router (file-based) + React 19 + Tailwind v4 + Radix/shadcn (new-york style) + `motion` for animation. Vite is configured entirely through `@lovable.dev/vite-tanstack-config` — see the warning in [vite.config.ts](vite.config.ts): **do not add tanstackStart / react / tailwind / tsconfig-paths / nitro plugins manually**, they are already bundled and duplicating them breaks the build.

**Routing** — file-based under [src/routes/](src/routes/). Read [src/routes/README.md](src/routes/README.md) before adding routes: TanStack conventions only (`$id` dynamic, `{-$x}` optional, `$.tsx` splat, `_layout` layout, `__root.tsx` shell). Do **not** create `src/pages/` or Next/Remix-style layouts. `src/routeTree.gen.ts` is auto-generated — never hand-edit.

**Entrypoints & error handling** — the SSR error path is deliberately layered and worth preserving:
- [src/router.tsx](src/router.tsx) builds the router with a per-request `QueryClient` in context.
- [src/start.ts](src/start.ts) wraps request handling in middleware that renders an HTML error page on throw.
- [src/server.ts](src/server.ts) is the custom server entry (wired via `vite.config.ts` `server.entry`). It exists to catch errors h3 swallows into JSON 500s (`{"unhandled":true,...}`) and re-render them as the branded error page.
- [src/routes/__root.tsx](src/routes/__root.tsx) is the app shell: HTML document, `<head>` meta/fonts, `QueryClientProvider`, plus the 404 and error-boundary components. Reported client errors go through `reportLovableError`.

**View components** — the `/app` demo is large and split by concern:
- [src/routes/app.tsx](src/routes/app.tsx) (~3k lines) holds the `AppShell` (sidebar + header), the `NAV` config, the `ViewKey` union, and several inline views (Dashboard, Operations, Calls, Agents, etc.). The sidebar groups views into **Spine / Surfaces / Intelligence** — this grouping is the product's information architecture, keep it coherent with `.lovable/plan.md`.
- [src/components/app/](src/components/app/) — extracted views: `NorthStar.tsx` (NorthStar, ARRGrowth, FurtherWorks, QuoteEngine, CoordinatorCockpit, Assets, ComplianceRoadmap, CommsHub), `NewViews.tsx` (Protocol, OperationsHub, Customers, panels), `Cards.tsx`, `Engineers.tsx`.
- [src/components/pitch/primitives.tsx](src/components/pitch/primitives.tsx) — animation/layout primitives (`Reveal`, `SectionShell`, `Eyebrow`, `CountUp`, `GlassCard`) used by the marketing page.
- [src/components/ui/](src/components/ui/) — shadcn primitives. `src/components/Nav.tsx` is the marketing nav.

To add a view to `/app`: add a `ViewKey`, an entry in `NAV` (with `group`), and a render line in `AppShell`'s `<main>` switch.

## Conventions

- **Imports:** use the `@/*` alias (→ `src/`), e.g. `@/lib/utils`, `@/components/ui/...`. shadcn aliases are in `components.json`.
- **Styling:** Tailwind v4 configured in CSS ([src/styles.css](src/styles.css)) via `@theme`/`@utility`, not a JS config. Colors are CSS variables (`--accent`, `--hairline`, `--surface-alt`, `--success`, etc.) exposed as Tailwind color tokens — use semantic classes like `bg-surface-alt`, `text-muted-foreground`, `border-hairline` rather than raw hex. Custom utilities: `text-display`, `tabular`, `hairline-border`, `noise-grain`. Fonts: Inter / Inter Tight (display) / JetBrains Mono. Merge classes with `cn()` from `@/lib/utils`.
- **Icons:** `lucide-react`.
- **Images/assets:** live in [src/assets/](src/assets/) as `*.asset.json` files (Lovable's asset manifest — they carry a hosted `url`). Import the JSON and use `.url`: `import dhIcon from "@/assets/dh-icon-black.png.asset.json"; <img src={dhIcon.url} />`.
- **Prettier:** printWidth 100, double quotes, semicolons, trailing commas. Run `bun run format`.
- **ESLint:** `no-restricted-imports` blocks the Next.js `server-only` package — use `*.server.ts` naming instead. `no-unused-vars` is off.

## Deployment & git hygiene — important

**The live frontend is deployed by Vercel from Git — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the authoritative path.** Lovable is **legacy** (an early UX accelerator), not the active deploy route; do not use or publish through it. Production tracks `main` on `github.com/Drummasterflash83/serviceos-dh`; every push builds a Vercel deployment (Preview for non-prod branches, Production for `main`). Backend (Supabase) deploys separately via the Supabase CLI and is never touched by a frontend deploy.

- **Never rewrite published git history** — no force-push, rebase, amend, or squash of already-pushed commits. (Promoting `main` is a **fast-forward**, which is safe — not a rewrite.)
- Keep the branch in a working state on every push — Vercel builds it.
- Do **not** remove Lovable-origin packages (e.g. `@lovable.dev/vite-tanstack-config`) merely because they came from Lovable — they are still load-bearing for the build.
- `bunfig.toml` enforces a 24h supply-chain delay on new packages; only the whitelisted `@lovable.dev/*` packages bypass it. Confirm with the user before adding to that exclude list. (Note: Vercel builds with **npm**, not bun.)
