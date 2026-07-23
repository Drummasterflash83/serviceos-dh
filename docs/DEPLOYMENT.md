# Deployment — how ServiceOS reaches production

> Authoritative description of the **live** deployment path. If anything else in the repo
> (including older notes in `CLAUDE.md` / `AGENTS.md`) implies Lovable deploys the site,
> this file wins.

## TL;DR

- **Frontend host: Vercel.** The live site is served by Vercel, not Lovable.
- **Lovable is legacy.** It was an early UX accelerator. It is **not** the active deploy
  path and must not be used to publish. Lovable-origin packages (e.g.
  `@lovable.dev/vite-tanstack-config`) are still load-bearing for the build — do **not**
  remove them just because they came from Lovable.
- **Backend is separate.** Supabase (project `tgbnakbxwcqjeimygroz`) is deployed
  independently via the Supabase CLI (migrations + edge functions). Frontend deploys
  never touch Supabase.

## The pipeline

```
Claude builds & verifies  →  git push  →  Vercel builds from Git  →  production
```

| Fact | Value |
|------|-------|
| Vercel team | **Allkin** |
| Vercel project | **serviceos-dh** (`prj_XEuCp5gnEireW5WynUgkRp9QNiXa`) |
| Linked Git repo | **github.com/Drummasterflash83/serviceos-dh** |
| **Production branch** | **`main`** |
| Production domain | **https://serviceos-dh.vercel.app** |
| Framework preset | TanStack Start (nitro) |
| Install / build command | `npm install` / `npm run build` |
| Public env (Production + Preview) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (marked *Sensitive*) |

### Build-target note

`npm run build` runs Vite + nitro. Nitro's **default preset is Cloudflare** (a local build
emits `wrangler.json`), but when Vercel runs the same command it **auto-detects `VERCEL=1`
and switches to the Vercel preset** (`λ __server`). So: build **remotely on Vercel** (source
upload or Git push). Do **not** ship a locally-prebuilt `.output` to Vercel — it would be
Cloudflare-flavoured.

## Preview deployments

- Every branch push produces a **Preview** deployment. Pushes to a non-production branch
  (e.g. `serviceos-backend-foundation`) only ever produce Preview, never Production.
- A preview can also be created from the working tree with `vercel deploy` (remote build).
- **Preview URLs are behind Vercel Deployment Protection (SSO)** — open them while signed
  in to Vercel, or via a Protection-Bypass-for-Automation token. Production URLs are public.

## Promoting to production

Production tracks `main`, so the controlled routes are:

1. **Fast-forward `main`** to the verified branch and push — Vercel's Git integration then
   builds & deploys it to production (carries the real commit SHA). This is the current
   default. It is a fast-forward, never a history rewrite.
2. `vercel promote <preview-url>` — promote an already-built, verified preview.
3. `vercel deploy --prod` — deploy the working tree straight to production.

Instant rollback: `vercel rollback` (or `vercel promote <previous-prod-url>`).

### Required checks before promoting

1. `npm install` — dependency install (repo also carries `bun.lock`; **Vercel uses npm**).
2. `npx tsc --noEmit` — typecheck must pass (the meaningful gate).
3. `npm run build` — production build must succeed.
4. Route verification — the intended routes exist (`/openfolk`, `/openfolk/$tenantId`,
   `/demo/openfolk`, `/demo/ownership`, `/health-shadow`, `/demo/customer-health`).
5. Preview smoke test — routes render, auth works, API calls target
   `tgbnakbxwcqjeimygroz`, no console errors, unauthorised users fail closed.

> `npm run lint` currently reports pre-existing `prettier/prettier` formatting drift. Vercel
> builds with `vite build`, **not** lint, so it does not gate deployment. Do not mass-reformat
> as part of a deploy.

## Confirming the deployed commit

- **In-app:** the OpenFolk operator surface (`/openfolk`) renders a build/version badge —
  frontend commit SHA, build timestamp, environment, and Supabase project ref
  (`src/components/BuildBadge.tsx`, injected via `vite.config.ts` `define`). If the badge SHA
  is behind the branch HEAD, the frontend is stale. It is operator-only (auth-gated route,
  never in tenant navigation) so ordinary tenant users do not see it.
- **From the CLI:** `vercel inspect https://serviceos-dh.vercel.app --scope allkin` and
  `vercel ls serviceos-dh --scope allkin`.

## Backend (Supabase) — separate track

Supabase migrations and edge functions deploy via the Supabase CLI against project
`tgbnakbxwcqjeimygroz`, independently of Vercel. A frontend deploy must never modify
Supabase, publish the Customer Health policy, enable the source allowlist, or activate any
live source.
