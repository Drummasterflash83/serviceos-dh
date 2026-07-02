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

## Authentication & access control (Auth-0)

The app uses **Supabase Auth** (email/password). The marketing landing page (`/`)
is public; **`/app` is protected** — unauthenticated users are redirected to
`/login`. Access is **invite-only**: there is no public sign-up unless
`VITE_ENABLE_SIGNUP="true"` is set.

- Client wiring: [`src/lib/supabase.ts`](src/lib/supabase.ts) (browser client,
  anon key only) and [`src/lib/auth.tsx`](src/lib/auth.tsx) (`AuthProvider`,
  `useAuth`, `RequireAuth`). No secrets in the frontend.
- Login page: [`src/routes/login.tsx`](src/routes/login.tsx).
- Roles (prepared in the `profiles` table): **owner**, **admin**, **ops**,
  **viewer**. Migration `supabase/migrations/20260702120000_profiles_and_roles.sql`
  creates `profiles` (one row per auth user, auto-provisioned by trigger, RLS:
  read-your-own only) and the role model. `tenant_id` lives on the profile.

### Setup

1. In Supabase → Auth → Providers, enable **Email**. Keep **"Allow new users to
   sign up" OFF** (invite-only). Add users via Dashboard → Auth → Add user.
2. Auth → URL Configuration: set the **Site URL** and add **Redirect URLs** for
   production and Vercel previews.
3. Apply migrations (`supabase db push`) so the `profiles` table + trigger exist.
4. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (and optionally
   `VITE_ENABLE_SIGNUP`) in `.env.local` / Vercel.

### Testing

1. `npm run dev`, visit `/app` while signed out → you are redirected to `/login`.
2. Sign in with an invited user's email/password → you land on `/app`.
3. Reload `/app` while signed in → stays on `/app` (session persists).
4. The landing page `/` remains reachable without a session.

> Not yet built: invite flow UI, and tenant-scoped RLS on the `phone_*` tables
> (those still deny-by-default; see
> [docs/DEPLOYMENT_AND_TEST_CHECKLIST.md](docs/DEPLOYMENT_AND_TEST_CHECKLIST.md)).

### Edge Function authorization (Security-1)

All phone Edge Functions authenticate the caller and **bind the tenant
server-side** — they do **not** trust a client-supplied `tenant_id`.

- **Auth:** the frontend sends the signed-in user's **access token** (JWT) as the
  bearer (not the anon key). The shared helper
  `supabase/functions/_shared/authz.ts` verifies it, loads the caller's
  `profiles` row, and returns `{ user_id, email, tenant_id, role }`.
- **Tenant binding:** functions use `profile.tenant_id` for every write. If the
  request body also includes `tenant_id`, it must equal the profile's — otherwise
  `tenant_mismatch`.
- **Roles:**
  - `owner` / `admin` / `ops` — may run sync, diagnostics, transcription,
    analysis and the pipeline.
  - **`force`/destructive retries** require `owner` / `admin`.
  - `viewer` — cannot run sync / retry / pipeline; the Admin console is hidden.
- **Internal calls** (pipeline → step functions, and the recordings-sync
  auto-trigger) **forward the caller's JWT**, so the same tenant/role is enforced
  end-to-end.
- **Error codes:** `missing_auth`, `invalid_auth`, `profile_not_found`,
  `tenant_mismatch`, `forbidden`.

The Admin console is available only to `owner`/`admin`/`ops`; other roles see a
"Restricted" state. Assign a user's tenant and role in the `profiles` table
(service-role / SQL) — end users cannot change their own role or tenant.

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
  -d '{"tenant_id":"00000000-0000-0000-0000-000000000000","provider_customer_id":"3950"}'
```

Deployed, or later from the app, via the typed helper (not yet wired to UI):

```ts
import { testSimwoodConnection } from "@/lib/api";

const result = await testSimwoodConnection(tenantId, "3950");
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
    "provider_customer_id": "3950",
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
    "provider_customer_id": "3950",
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

### Phase Phone-3 — recording audio download & secure storage

Downloads a single recording's **WAV audio** from Simwood (server-side only) and
stores it in the **private** Supabase Storage bucket `phone-recordings`. Every
attempt is logged to `phone_sync_runs` (`sync_type = "recording_download"`) and
`audit_logs`.

Still **no transcription and no AI enrichment.** The raw Simwood recording URL
and credentials are never returned to the client — only ids, the internal
`storage_path`, and flags.

**Idempotent:** the storage path is deterministic —
`{tenant_id}/simwood/recordings/{provider_recording_id}.wav`. If a recording
already has a `storage_path`, the function returns `already_downloaded: true`
without re-downloading, unless `force: true` is passed.

#### Storage bucket

Migration `supabase/migrations/20260701130000_phone_recordings_storage.sql`
creates the private bucket idempotently:

```sql
insert into storage.buckets (id, name, public)
values ('phone-recordings', 'phone-recordings', false)
on conflict (id) do nothing;
```

If your environment blocks direct inserts into `storage.buckets`, create it
manually instead (the migration then no-ops):

```bash
# CLI
supabase storage create phone-recordings   # then ensure it is PRIVATE
```

Or in the Supabase Dashboard → Storage → New bucket → name `phone-recordings`,
**Public = off**. The download function uses the service-role key and bypasses
storage RLS, so no storage policies are needed yet. **Do not** make the bucket
public or create public URLs — future playback will use short-lived **signed
URLs** (not implemented here).

#### Deploy & invoke

```bash
supabase functions deploy simwood-download-recording
```

```bash
curl -i -X POST http://localhost:54321/functions/v1/simwood-download-recording \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "recording_id": "<phone_recordings.id UUID>",
    "force": false
  }'
```

Request fields:

| Field | Meaning |
| --- | --- |
| `tenant_id` | Tenant UUID (required) |
| `recording_id` | `phone_recordings.id` UUID (required) |
| `force` | Re-download and overwrite even if already stored (optional) |

Successful response:

```json
{
  "success": true,
  "provider": "simwood",
  "recording_id": "…",
  "provider_recording_id": "…",
  "storage_path": "…/simwood/recordings/….wav",
  "already_downloaded": false,
  "sync_run_id": "…"
}
```

Typed helper (not wired to UI):

```ts
import { downloadSimwoodRecording } from "@/lib/api";

const result = await downloadSimwoodRecording({ tenantId, recordingId });
if (result.ok) {
  console.log(result.data.already_downloaded ? "already stored" : "downloaded", result.data.storage_path);
} else {
  console.error(result.error.code, result.error.message);
}
```

## Phone Input — Phase Phone-4A: call transcription (OpenAI)

The first Voice Intelligence layer. Reads a recording's WAV from private storage
(service role) and transcribes it via **OpenAI**, writing the text to
`phone_transcripts`. Audio and the OpenAI key stay **server-side only** — the
client never sees the audio URL or the key.

Still **no AI summary/insight extraction, no diarization, no playback UI.** The
provider is isolated in `supabase/functions/_shared/openai.ts` so a specialist
(e.g. Deepgram) can be added later.

> ⚠️ Transcripts are **machine-generated and may need human review** before being
> relied on operationally (accents, telephony audio, overlapping speech).

### Required secret / env

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | **Required.** OpenAI API key (server-side only; never `VITE_`-prefixed) |
| `OPENAI_TRANSCRIPTION_MODEL` | Optional. Transcription model. Default `gpt-4o-transcribe`; a documented fallback is `whisper-1`. |

```bash
supabase secrets set OPENAI_API_KEY=<value>
# optional:
supabase secrets set OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
```

### Deploy & invoke

```bash
supabase functions deploy phone-transcribe-recording
```

```bash
curl -i -X POST http://localhost:54321/functions/v1/phone-transcribe-recording \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "recording_id": "294014bf-0e25-4904-8ad7-81c8526e2025",
    "force": false
  }'
```

Request fields: `tenant_id` (required UUID), `recording_id` (required — a
`phone_recordings.id`), `force` (optional — re-transcribe even if a completed
transcript exists). Requires the recording to already have a `storage_path`
(Phase-3). Successful response returns a **240-char `text_preview` only**:

```json
{
  "success": true,
  "provider": "openai",
  "recording_id": "…",
  "transcript_id": "…",
  "status": "completed",
  "language": "en",
  "model": "gpt-4o-transcribe",
  "text_preview": "first 240 chars…",
  "sync_run_id": "…"
}
```

Typed helper (used by the Admin console, not the product UI):

```ts
import { transcribePhoneRecording } from "@/lib/api";

const result = await transcribePhoneRecording({ tenantId, recordingId });
if (result.ok) {
  console.log(result.data.status, result.data.text_preview);
} else {
  console.error(result.error.code, result.error.message);
}
```

## Phone Input — Phase Phone-4B: AI call intelligence (OpenAI)

Turns a completed transcript into structured operational intelligence in
`phone_ai_insights` via OpenAI (chat completions, JSON mode). The OpenAI key
stays **server-side only**. Insights link to `recording_id` (derived from the
transcript); `transcript_id` and all extra extracted fields live in
`raw_payload`.

Still **no task creation, no customer matching, no dashboard charts.** Provider
is isolated in `supabase/functions/_shared/openai.ts`.

> ⚠️ AI-generated intelligence is **advisory only** and may need human review.

### Required / optional env

| Name | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | **Required.** Shared with Phase-4A (server-side only). |
| `OPENAI_ANALYSIS_MODEL` | Optional. Analysis model. Default `gpt-4o-mini` (alt: `gpt-4.1-mini`). |

```bash
# key is shared with transcription; set the analysis model only to override:
supabase secrets set OPENAI_ANALYSIS_MODEL=gpt-4o-mini
```

### Deploy & invoke

```bash
supabase functions deploy phone-analyse-transcript
```

```bash
curl -i -X POST http://localhost:54321/functions/v1/phone-analyse-transcript \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "transcript_id": "2d800bc5-063d-4a3e-8eab-52f0637f1aaa",
    "force": false
  }'
```

### Outputs

Stored columns: `intent`, `urgency` (low/medium/high/emergency), `sentiment`
(negative/neutral/positive/mixed), `summary`, `action_required` (bool),
`suggested_owner` (office/accounts/engineer/manager/unknown), `confidence`
(0–1). Extra extracted fields (`customer_name`, `phone_number`,
`address_or_postcode`, `appliance_or_system`, `fault_or_reason`,
`promised_action`, `risk_flags`) are kept in `raw_payload` for later phases. The
response returns a **240-char `summary_preview` only**:

```json
{
  "success": true,
  "provider": "openai",
  "transcript_id": "…",
  "insight_id": "…",
  "intent": "no heating",
  "urgency": "high",
  "sentiment": "negative",
  "action_required": true,
  "suggested_owner": "engineer",
  "confidence": 0.87,
  "summary_preview": "first 240 chars…",
  "sync_run_id": "…"
}
```

Typed helper (used by the Admin console):

```ts
import { analysePhoneTranscript } from "@/lib/api";

const result = await analysePhoneTranscript({ tenantId, transcriptId });
if (result.ok) {
  console.log(result.data.intent, result.data.urgency, result.data.summary_preview);
} else {
  console.error(result.error.code, result.error.message);
}
```

## Phone Input — Phase 5A: automated pipeline

New recordings now become AI-enriched **automatically** — no Admin step required.
`simwood-sync-recordings` detects genuinely-new inserts and background-triggers
the pipeline for each (historical recordings are never re-processed; capped at
50 per sync as a backfill backstop).

`phone-process-pipeline` orchestrates one recording end-to-end by **reusing** the
existing idempotent step functions (`simwood-download-recording` →
`phone-transcribe-recording` → `phone-analyse-transcript`, via
`supabase/functions/_shared/phone_pipeline.ts`). It is safe to re-run; `force`
re-runs every step. A failed step stops only that recording's pipeline — a batch
of 50 with one failure yields 49 succeeded, 1 logged failed (in `phone_sync_runs`
+ `audit_logs`). No new secrets; uses the platform-injected `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` for internal invocation.

Admin is now **diagnostics only**: a read-only status panel (counts via
`phone-pipeline-status`) plus a "Retry processing" control that calls
`phone-process-pipeline` for a single recording UUID.

### Deploy

```bash
supabase functions deploy phone-process-pipeline
supabase functions deploy phone-pipeline-status
supabase functions deploy simwood-sync-recordings   # updated: auto-trigger
```

### Invoke the pipeline directly

```bash
curl -i -X POST http://localhost:54321/functions/v1/phone-process-pipeline \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "recording_id": "294014bf-0e25-4904-8ad7-81c8526e2025",
    "force": false
  }'
```

Response:

```json
{
  "success": true,
  "recording_id": "…",
  "downloaded": true,
  "transcribed": true,
  "analysed": true,
  "transcript_id": "…",
  "insight_id": "…",
  "sync_run_id": "…"
}
```
