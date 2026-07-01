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

## Phone Input (Simwood / Sipcentric) — Phase Phone-0

The first real backend input. Phase Phone-0 provides the schema, a
connection-test Edge Function, and a typed frontend helper — **no call sync,
recording download, or transcription yet**. Design basis:
[docs/PHONE_INPUT_SIMWOOD_SPEC.md](docs/PHONE_INPUT_SIMWOOD_SPEC.md).

### Required Supabase secrets (server-side only)

These are **secrets**, not frontend env vars — they are never prefixed `VITE_`,
never placed in `.env.example`/`.env.local`, and never returned to the client.

| Secret | Purpose |
| --- | --- |
| `SIMWOOD_USERNAME` | Simwood/Sipcentric portal username (HTTP Basic Auth) |
| `SIMWOOD_PASSWORD` | Simwood/Sipcentric portal password (HTTP Basic Auth) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into
Edge Functions by the platform and are used to write audit rows.

Set them with:

```bash
supabase secrets set SIMWOOD_USERNAME=... SIMWOOD_PASSWORD=...
```

### Apply the database migration

```bash
# against the linked Supabase project
supabase db push
# or, for local development
supabase migration up
```

Migration: `supabase/migrations/20260701120000_phone_input_foundation.sql`.
Creates the tenant-scoped `phone_*` tables plus `audit_logs`, with Row Level
Security **enabled and closed by default** (service-role writes bypass RLS;
tenant read policies arrive with the auth model).

### Deploy the Edge Function

```bash
supabase functions deploy simwood-test-connection
```

### Test the function

Locally (requires the Supabase CLI + Docker):

```bash
# serve functions with secrets from a local env file (git-ignored)
supabase functions serve simwood-test-connection --env-file supabase/functions/.env.local

# then, in another shell:
curl -i -X POST http://localhost:54321/functions/v1/simwood-test-connection \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"00000000-0000-0000-0000-000000000000"}'
```

Deployed, or later from the app, via the typed helper (not yet wired to UI):

```ts
import { testSimwoodConnection } from "@/lib/api";

const result = await testSimwoodConnection(tenantId);
if (result.ok) {
  console.log(result.data.customerCount, "account(s) reachable");
} else {
  console.error(result.error.code, result.error.message);
}
```

A successful call returns credential-free account metadata only and logs the
outcome to `phone_sync_runs` and `audit_logs`.

### Phase Phone-1 — call history sync

Ingests call history (CDRs) from Simwood into the `phone_calls` table. Idempotent
(upsert on `tenant_id + provider + provider_call_id`), so re-running never
duplicates a call. Every attempt is logged to `phone_sync_runs` and `audit_logs`.
Still **no recordings, audio, transcription or AI enrichment** — that's later.

Uses the same `SIMWOOD_USERNAME` / `SIMWOOD_PASSWORD` secrets. Shared provider
helpers live in `supabase/functions/_shared/simwood.ts`.

Deploy:

```bash
supabase functions deploy simwood-sync-calls
```

Invoke (defaults to the last 24 hours if `from`/`to` are omitted):

```bash
curl -i -X POST http://localhost:54321/functions/v1/simwood-sync-calls \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "from": "2026-06-30T00:00:00Z",
    "to": "2026-07-01T00:00:00Z",
    "direction": "inbound",
    "limit": 200
  }'
```

Request fields (all optional except `tenant_id`):

| Field | Meaning |
| --- | --- |
| `tenant_id` | Tenant UUID (required) |
| `provider_customer_id` | Simwood customer id; auto-discovered if omitted |
| `from` / `to` | ISO **date window** → mapped to the API's `startedAfter` / `startedBefore` (not the API's number filters). Defaults to now-24h → now |
| `direction` | `inbound` / `outbound` → mapped to the API's `IN` / `OUT` |
| `limit` | Max records to process this run |

Successful response:

```json
{
  "success": true,
  "provider": "simwood",
  "records_processed": 12,
  "from": "2026-06-30T00:00:00.000Z",
  "to": "2026-07-01T00:00:00.000Z",
  "customer_id": "1234",
  "sync_run_id": "…uuid…"
}
```

Typed helper (not wired to UI):

```ts
import { syncSimwoodCalls } from "@/lib/api";

const result = await syncSimwoodCalls({ tenantId, from, to, direction: "inbound" });
if (result.ok) {
  console.log(result.data.records_processed, "calls synced");
} else {
  console.error(result.error.code, result.error.message);
}
```

### Phase Phone-2 — recording metadata sync

Ingests recording **metadata** from Simwood into the `phone_recordings` table.
Idempotent (upsert on `tenant_id + provider + provider_recording_id`), so
re-running never duplicates a recording. Every attempt is logged to
`phone_sync_runs` and `audit_logs`.

**Metadata only — it does not download WAV audio, transcribe, or run AI.**
Recordings store `provider_call_id` / `linked_id` so they join to `phone_calls`
later; the sync also reports (best-effort) how many referenced calls already
exist, without failing if a matching call is absent.

Uses the same `SIMWOOD_USERNAME` / `SIMWOOD_PASSWORD` secrets and the shared
helpers in `supabase/functions/_shared/simwood.ts`.

Deploy:

```bash
supabase functions deploy simwood-sync-recordings
```

Invoke (defaults to the last 24 hours if `from`/`to` are omitted):

```bash
curl -i -X POST http://localhost:54321/functions/v1/simwood-sync-recordings \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "from": "2026-06-30T00:00:00Z",
    "to": "2026-07-01T00:00:00Z",
    "limit": 200
  }'
```

Request fields (all optional except `tenant_id`):

| Field | Meaning |
| --- | --- |
| `tenant_id` | Tenant UUID (required) |
| `provider_customer_id` | Simwood customer id; auto-discovered if omitted |
| `from` / `to` | ISO **date window** → mapped to the API's `startedAfter` / `startedBefore`. Defaults to now-24h → now |
| `call_id` | Filter to a single provider call id (API `callId`) |
| `linked_id` | Filter to a single linked id (API `linkedId`) |
| `limit` | Max records to process this run |

The success response matches the call sync shape (`success`, `provider`,
`records_processed`, `from`, `to`, `customer_id`, `sync_run_id`).

Typed helper (not wired to UI):

```ts
import { syncSimwoodRecordings } from "@/lib/api";

const result = await syncSimwoodRecordings({ tenantId, from, to });
if (result.ok) {
  console.log(result.data.records_processed, "recordings synced");
} else {
  console.error(result.error.code, result.error.message);
}
```
