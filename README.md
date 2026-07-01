# ServiceOS

Bespoke operating system for Drummond Heating — a TanStack Start (SSR) + React 19
frontend, currently a Lovable-generated prototype being extended with a real
backend foundation.

For engineering conventions, architecture, and commands see [CLAUDE.md](CLAUDE.md).

## Development workflow: Lovable → GitHub → Claude Code → Supabase → Vercel

ServiceOS moves through a fixed pipeline. Each stage owns a distinct concern;
keep changes in the stage that owns them to avoid sync conflicts.

1. **Lovable** — the visual UI editor and source of the original design. Lovable
   two-way syncs with the connected GitHub branch: edits made in Lovable land as
   commits, and commits pushed to that branch appear back in Lovable. Because of
   this sync, **never rewrite published history** (no force-push, rebase, amend,
   or squash of pushed commits) and keep the branch in a working state. UI/visual
   changes are made here to preserve the Lovable design. See [AGENTS.md](AGENTS.md).

2. **GitHub** — the system of record and the hand-off point between Lovable and
   local development. Backend work happens on a dedicated branch (currently
   `serviceos-backend-foundation`) so it can be reviewed independently of Lovable
   UI edits before merging.

3. **Claude Code** — local engineering: backend foundation, data layer, API
   wiring, specs, and non-visual code. Work here must **preserve the Lovable UI
   exactly** — no visual changes — so the two-way sync stays clean.

4. **Supabase** — the backend platform: Postgres database, auth, storage, and
   Edge Functions (`supabase/functions/`). Public client config is exposed to the
   frontend via `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; all secrets
   (service-role key, integration credentials) stay server-side and are never
   prefixed `VITE_`.

5. **Vercel** — deployment/hosting target for the app. Environment variables are
   configured in the Vercel project (public `VITE_*` for the client, secrets for
   server functions).

   > Note: the current Vite build (via `@lovable.dev/vite-tanstack-config`)
   > defaults its Nitro output to a Cloudflare target. Deploying to Vercel will
   > require selecting the appropriate Nitro/deploy preset — a foundation task,
   > not yet done.

### Environment variables

Copy [`.env.example`](.env.example) to `.env.local` (git-ignored) and fill in the
public values. Only `VITE_`-prefixed, client-safe values belong in `.env.local`;
backend secrets go in the server-side secret store, never in the client bundle.
