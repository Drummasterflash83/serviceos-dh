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

### Tenant-scoped reads & the call feed (Security-2)

The phone tables are now **safe to read directly from the authenticated
frontend**. Migration `supabase/migrations/20260702130000_security2_feed_rls.sql`
adds **SELECT-only** RLS policies scoped to the caller's tenant:

- Read allowed only where `row.tenant_id = current_tenant_id()` (the caller's
  `profiles.tenant_id`, resolved by a `security definer` helper).
- `phone_calls`, `phone_recordings`, `phone_transcripts`, `phone_ai_insights`,
  `phone_sync_runs` — readable by any authenticated tenant member
  (owner/admin/ops/viewer). `audit_logs` — **owner/admin only**.
- **No INSERT/UPDATE/DELETE policies** — all writes stay server-side (Edge
  Functions via the service role, which bypasses RLS). **No anon/public reads.**

Hardening in the same migration (non-destructive): `phone_ai_insights.transcript_id`
(also mirrored in `raw_payload`), feed indexes
(`phone_calls(tenant_id, started_at desc)`, `phone_recordings(tenant_id, started_at desc)`,
transcript/insight-by-recording), and partial unique indexes enforcing one
completed transcript and one insight per recording.

**Feed helper:** [`src/lib/phone-feed.ts`](src/lib/phone-feed.ts) →
`getPhoneFeed({ from?, to?, limit?, direction?, actionRequiredOnly? })`. It uses
the **browser** Supabase client (the user's session), so RLS filters everything
to the tenant automatically — no `tenant_id` is ever sent by the client. It
composes `phone_calls` + `phone_recordings` + `phone_transcripts` +
`phone_ai_insights` into `PhoneFeedItem` records with a derived
`processing_status`.

Why reads are safe now: the frontend can only ever see its own tenant's rows
(RLS), cannot write (no write policies), and never handles the service role.

**Remaining limitations:** the feed is composed in two client reads (recordings
join to calls by `provider_call_id`, which PostgREST can't auto-embed);
`actionRequiredOnly` is applied after composition (may return fewer than
`limit`); and the Calls & Comms UI is not built yet.

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

## Email Input — Phase Email-0: Gmail ingestion foundation

Email is the **second real communications input**, alongside phone. Phase Email-0
lays down only the **database schema, RLS model, shared types, and a typed
frontend feed helper** — the integration _shape_. There is **no UI, no Gmail
OAuth, no Gmail API calls, and no data yet**. It deliberately mirrors the
Phone-0 → Security-2 model so email can later join the same **Calls & Comms**
feed.

### Schema

Migration `supabase/migrations/20260702140000_email_input_foundation.sql`
(idempotent; reuses `set_updated_at()` from Phone-0 and `current_tenant_id()`
from Security-2) creates six tenant-scoped tables:

- **`email_accounts`** — one connected mailbox per tenant/provider
  (`provider` defaults to `gmail`; `status`: pending | active | error | disabled).
- **`email_threads`** — conversation grouping (`provider_thread_id`, `subject`,
  `participants` jsonb, `last_message_at`, `raw_payload`).
- **`email_messages`** — individual messages (`from_email`/`from_name`,
  `to_emails`/`cc_emails` jsonb, `subject`, `snippet`, `body_text`/`body_html`,
  `sent_at`/`received_at`, `direction` inbound | outbound, `raw_payload`). Links
  to a thread by `provider_thread_id` (text), matching the phone model.
- **`email_attachments`** — attachment metadata + `storage_path` pointer
  (`null` until downloaded; no blobs in the DB), `on delete cascade` from message.
- **`email_ai_insights`** — advisory AI enrichment per message and/or thread
  (`intent`, `urgency`, `sentiment`, `summary`, `action_required`,
  `suggested_owner`, `confidence`, `raw_payload`).
- **`email_sync_runs`** — observability/audit of sync + analysis runs
  (`sync_type`: oauth | messages | threads | ai_analysis | attachment_download;
  `status`: running | success | failed; `records_processed`, `error_message`,
  `metadata`).

Feed indexes: `email_messages(tenant_id, received_at desc)`,
`email_messages(tenant_id, from_email)`,
`email_threads(tenant_id, last_message_at desc)`, and
`email_ai_insights` by `(tenant_id, message_id)` and `(tenant_id, thread_id)`.

### RLS model

Same **closed-by-default** posture as the phone tables:

- **SELECT-only** policies scoped to `row.tenant_id = current_tenant_id()`,
  granted to `authenticated` — any tenant member can read their own tenant's rows.
- **No INSERT/UPDATE/DELETE policies** — every write stays server-side (future
  Edge Functions via the service role, which bypasses RLS). **No anon/public
  reads, no frontend writes.**

### Feed helper

[`src/lib/email-feed.ts`](src/lib/email-feed.ts) exposes two functions that use
the **browser** Supabase client (the user's session), so RLS filters everything
to the tenant automatically — no `tenant_id` is ever sent by the client:

- `getEmailFeed({ from?, to?, limit?, direction?, actionRequiredOnly? })` →
  `EmailFeedItem[]`. Thread-centric: composes `email_threads` + each thread's
  **latest** `email_messages` row + that message's `email_ai_insights` into one
  record with a derived `processing_status` (`analysed` | `received`). Bodies are
  not fetched here.
- `getEmailThreadDetail(threadId)` → `EmailThreadDetail`. Lazily loads one
  thread's ordered messages (with `body_text`/`body_html`) and each message's
  best-effort insight.

Shared row/feed types live in [`src/lib/types.ts`](src/lib/types.ts):
`EmailAccount`, `EmailThread`, `EmailMessage`, `EmailInsight`, `EmailFeedItem`
(+ `EmailFeedInput`, `EmailThreadMessage`, `EmailThreadDetail`).

### Planned (not in this phase)

- **OAuth** — a `gmail-connect` Edge Function to run Google OAuth server-side,
  storing tokens as Supabase secrets (never in the DB or frontend) and upserting
  an `email_accounts` row. Tracked as `email_sync_runs.sync_type = 'oauth'`.
- **Sync** — `gmail-sync-threads` / `gmail-sync-messages` Edge Functions that
  page the Gmail API (service role, tenant-bound like the Simwood syncs),
  upserting threads/messages/attachments and logging each run.
- **AI analysis** — a `gmail-analyse-message` (or thread) function mirroring
  `phone-analyse-transcript`, writing `email_ai_insights`, with an automated
  pipeline like Phone-5A.

### Link to Calls & Comms

Because email carries the same insight shape (`intent`, `urgency`, `sentiment`,
`summary`, `action_required`, `suggested_owner`, `confidence`) and `direction` as
phone, `EmailFeedItem` and `PhoneFeedItem` can be merged into a single unified
**Calls & Comms** timeline once that surface is built — a shared, RLS-safe read
of every communications channel.

## Email Input — Phase Email-1: Gmail OAuth connection

Lets an **owner/admin/ops** user securely connect a Gmail / Google Workspace
mailbox so ServiceOS can sync email **later**. This phase is **connection only**
— it obtains and stores OAuth tokens. **No mail is read; no Gmail message API is
called.**

### Flow

1. **Admin → Email · Gmail → “Connect Gmail”** calls `startGmailOAuth()`
   ([`src/lib/api.ts`](src/lib/api.ts)) → the `gmail-oauth-start` Edge Function.
2. The function verifies the caller's JWT, **binds tenant + user from their
   profile** (never a client-supplied `tenant_id`), and returns a Google consent
   URL. The browser redirects to it.
3. Google redirects back to `gmail-oauth-callback` with `code` + `state`. The
   callback verifies the **HMAC-signed `state`** (which binds the initiating
   tenant/user/return-origin), exchanges the code for tokens server-side, reads
   the mailbox address, upserts `email_accounts` (status `active`) and
   `email_oauth_tokens`, logs to `email_sync_runs` + `audit_logs`, then 302s back
   to `/app?gmail=connected`.

The `state` is stateless and signed with the platform-injected service-role key
(server-only, never exposed, never logged) — so it can't be forged to point at
another tenant. The callback runs with **`verify_jwt = false`** (Google's
redirect carries no Supabase JWT); trust comes entirely from the signed state.

### Token storage

Migration `supabase/migrations/20260702150000_email_oauth_tokens.sql` adds
**`email_oauth_tokens`** (`access_token`, `refresh_token`, `expires_at`, `scope`,
`token_type`, …). **RLS is enabled with NO policies** → the frontend can never
read or write it; only the service role (the Edge Functions) touches tokens.
Tokens are **never returned to the client and never logged**.

### Scopes

Minimum for a future read-only sync: `gmail.readonly` and `userinfo.email`, with
`access_type=offline` + `prompt=consent` so Google returns a `refresh_token`.

### Google Cloud setup

1. In [Google Cloud Console](https://console.cloud.google.com/) → **APIs &
   Services**: enable the **Gmail API**.
2. **OAuth consent screen**: configure (Internal for a single Workspace, or
   External + test users), and add the two scopes above.
3. **Credentials → Create OAuth client ID → Web application**. Under
   **Authorized redirect URIs** add your callback URL:

   ```
   https://<PROJECT_REF>.supabase.co/functions/v1/gmail-oauth-callback
   ```

   This exact value must also be the `GOOGLE_REDIRECT_URI` secret.

### Required Supabase secrets (server-side only)

Never prefixed `VITE_`, never returned to the client:

| Secret                 | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | OAuth client id (Web application)                   |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret                                 |
| `GOOGLE_REDIRECT_URI`  | The `gmail-oauth-callback` URL registered in Google |

State signing reuses the injected `SUPABASE_SERVICE_ROLE_KEY` — **no additional
secret is required** (optionally override with `GMAIL_OAUTH_STATE_SECRET`).

```bash
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  GOOGLE_REDIRECT_URI=https://<PROJECT_REF>.supabase.co/functions/v1/gmail-oauth-callback
```

### Apply migration & deploy

```bash
supabase db push
supabase functions deploy gmail-oauth-start
supabase functions deploy gmail-oauth-callback   # verify_jwt=false via config.toml
```

`supabase/config.toml` sets `verify_jwt = false` for the **callback** only; the
**start** function keeps JWT verification on. (Equivalent without config.toml:
`supabase functions deploy gmail-oauth-callback --no-verify-jwt`.)

### Testing

1. Sign in as an owner/admin/ops user, open **Admin**, click **Connect Gmail**.
2. Approve on Google's consent screen → you're redirected back to
   `/app?gmail=connected`.
3. Verify (service-role / SQL, since RLS hides tokens): a row exists in
   `email_accounts` (status `active`) and one in `email_oauth_tokens`
   (`has_refresh_token` reflected in the `email_sync_runs` `oauth` row's
   metadata). Tokens must **not** be visible to the anon/authenticated client.
4. A `viewer` calling `gmail-oauth-start` receives `forbidden`.

**No email sync yet** — Phase Email-2 will use these tokens (service-role, with
refresh) to page the Gmail API into `email_threads` / `email_messages`.

## Email Input — Phase Email-1B: Google Workspace domain-wide delegation

Per-user Gmail OAuth (Phase-1) doesn't scale to 20+ mailboxes. **Domain-wide
delegation (DWD)** lets one Workspace admin authorise a ServiceOS **service
account** to impersonate many mailboxes across the domain — no per-user consent.
Phase-1B is **foundation only**: schema + a test-connection function that proves
delegation works. **No mailbox sync yet.** Per-user OAuth is untouched and still
works.

### Schema

Migration `supabase/migrations/20260702160000_google_workspace_foundation.sql`
adds two tenant-scoped tables (SELECT-only RLS for `authenticated`; service-role
writes only):

- **`google_workspace_connections`** — one delegated connection per
  `(tenant_id, domain)` (`customer_id`, `service_account_email`, `status`,
  `delegated_scopes text[]`).
- **`google_workspace_mailboxes`** — mailboxes under a connection
  (`email_address`, `display_name`, `mailbox_type`, `sync_enabled`, `status`).

The service-account **private key is never stored in the DB** — it lives only in
Edge Function secrets.

### Scopes (admin-authorised)

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/admin.directory.user.readonly`

### Required Supabase secrets (server-side only)

| Secret                                   | Purpose                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `GOOGLE_WORKSPACE_CLIENT_EMAIL`          | Service account `client_email`                                     |
| `GOOGLE_WORKSPACE_PRIVATE_KEY`           | Service account private key (PEM; `\n`-escaped is fine)            |
| `GOOGLE_WORKSPACE_DOMAIN`                | The Workspace domain, e.g. `drummondheating.co.uk`                 |
| `GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT` | Admin mailbox to impersonate (optional; defaults `admin@<domain>`) |

```bash
supabase secrets set \
  GOOGLE_WORKSPACE_CLIENT_EMAIL="svc@project.iam.gserviceaccount.com" \
  GOOGLE_WORKSPACE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  GOOGLE_WORKSPACE_DOMAIN="example.com" \
  GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT="admin@example.com"
```

### Google setup

1. **Google Cloud Console** → create a **service account**; create a **JSON key**
   (its `client_email` + `private_key` become the secrets above). Note the
   service account's **numeric client ID** (OAuth2 client ID).
2. Enable the **Gmail API** and **Admin SDK API** on the project.
3. **Google Admin console** → **Security → Access and data control → API controls
   → Domain-wide delegation → Add new**: paste the service account's **client ID**
   and the two scopes above (comma-separated). This is the admin authorisation
   step that makes impersonation possible.
4. Ensure `GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT` is a real mailbox (an admin for
   the directory scope).

### Deploy & test

```bash
supabase db push
supabase functions deploy google-workspace-test-connection
```

Then **Admin → Email · Google Workspace → “Test Workspace Connection”** (owner /
admin only). The function signs a service-account JWT, exchanges it for a token
that **impersonates** the admin subject, reads that mailbox's Gmail profile, and
returns a safe summary:

```json
{
  "success": true,
  "domain": "example.com",
  "impersonated": "admin@example.com",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly", "..."]
}
```

The result (and any failure code) is also logged to `email_sync_runs`
(`sync_type='workspace_test'`) + `audit_logs`. The **private key and access token
are never returned or logged.**

### Why this over per-user OAuth

One admin authorisation covers **every mailbox in the domain** — ServiceOS
impersonates each as needed, with no individual OAuth consent screens. Phase
Email-2 will enumerate mailboxes into `google_workspace_mailboxes` and sync the
`sync_enabled` ones into the shared `email_*` tables. Per-user OAuth (Phase-1)
remains available for mailboxes outside the Workspace domain.

## Scheduled phone sync — keeping Calls & Comms current

Previously phone data only updated when an admin clicked **Sync calls** /
**Sync recordings**. `phone-scheduled-sync` runs those on a **cron (every 5
minutes)** so the live Calls & Comms feed stays current with no manual action.

### How it works

It owns **no business logic** — it invokes the existing, already-idempotent
functions server-to-server and lets them do the work:

- `simwood-sync-calls` — recent call history.
- `simwood-sync-recordings` — recent recording metadata, which itself
  **auto-triggers the Phase-5A enrichment pipeline for genuinely-new recordings
  only** (download → transcribe → analyse). Nothing is re-processed.

It syncs a **10-minute rolling window** (5-minute cron ⇒ ~5 minutes overlap);
overlap is safe because every upsert is idempotent. One `phone_sync_runs` row is
written per tick with `sync_type = 'scheduled_sync'` (the child `calls` /
`recordings` runs are logged too). It returns:

```json
{ "success": true, "calls_processed": 0, "recordings_processed": 0, "sync_run_id": "…" }
```

The Admin manual sync buttons are unchanged and still work on demand.

### Auth model

The scheduled function is **not** callable by ordinary users. It requires a
shared secret header and is deployed with `verify_jwt = false` (cron has no
Supabase JWT):

- Caller must send `x-schedule-secret: <PHONE_SCHEDULE_SECRET>` — else `403`.
- It invokes the sync functions with the **service-role key** as the bearer plus
  an `x-internal-tenant-id` header. `_shared/authz.ts` recognises this
  service-role internal path and binds the tenant server-side. This path **never
  fires for real users** (the frontend only holds the anon key + a user JWT), so
  Security-1 authz for user-triggered functions is unchanged.

### Config (TODO: move to per-tenant integration config)

For now the tenant and Simwood customer are hard-coded in
`phone-scheduled-sync/index.ts`:

- `SCHEDULED_TENANT_ID = "00000000-0000-0000-0000-000000000001"`
- `PROVIDER_CUSTOMER_ID = "3950"`

### Required secret

| Secret                  | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `PHONE_SCHEDULE_SECRET` | Shared secret the cron sends as x-schedule-secret |

```bash
supabase secrets set PHONE_SCHEDULE_SECRET="$(openssl rand -hex 32)"
```

### Deploy

```bash
supabase functions deploy phone-scheduled-sync   # verify_jwt=false via config.toml
```

### Schedule it (every 5 minutes)

Supabase `config.toml` does not schedule Edge Functions, so use **pg_cron +
pg_net** in the database (SQL editor). This calls the function with the secret
header on `*/5 * * * *`:

```sql
-- one-time: enable the extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'phone-scheduled-sync-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/phone-scheduled-sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-schedule-secret', '<PHONE_SCHEDULE_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

(Alternatively, drive it from any external scheduler that can send the
`x-schedule-secret` header. To deploy without editing `config.toml`:
`supabase functions deploy phone-scheduled-sync --no-verify-jwt`.)

### Cost notes

Cheap by design: each tick only syncs **recent metadata** for a 10-minute window
and **never forces** re-download, re-transcription or re-analysis. The expensive
OpenAI steps run **once per new recording** via the Phase-5A pipeline (capped at
50 auto-triggers per recordings sync). Re-running a tick over the same window
re-upserts the same rows and enriches nothing new.

## Email Input — Phase Email-2: Gmail OAuth sync engine

Syncs recent Gmail messages from a **connected OAuth mailbox** (Phase-1) into the
`email_*` tables so they can surface in the email feed. This is the SaaS-friendly
path (Connect → approve → sync); the Workspace domain-wide-delegation foundation
(Phase-1B) stays in place but is **not used** here.

### Function

`gmail-sync-messages` — authenticated **owner/admin/ops**; tenant bound from the
caller's profile.

Input:

```json
{ "email_account_id": "uuid", "force": false, "max_results": 50 }
```

What it does:

- Verifies the `email_accounts` row belongs to the caller's tenant.
- Loads the OAuth token from `email_oauth_tokens` (**service role**), and
  **refreshes** the `access_token` via the stored `refresh_token` when it's
  expired/near-expiry. Tokens are **never returned or logged**.
- Lists recent **INBOX** and **SENT** message ids (`max_results` per label, 1–100)
  using the Gmail API read-only, then fetches each message. Without `force` it
  only fetches ids not already stored (incremental; saves API calls).
- Parses each message → `subject`, `from_email`/`from_name`, `to_emails`,
  `cc_emails`, `snippet`, `body_text`, `body_html`, `sent_at`/`received_at`
  (from `internalDate` / `Date`), and `direction` (`outbound` if from the mailbox
  or labeled `SENT`, else `inbound`). `raw_payload` holds **safe metadata only**
  (label ids, size estimate, history id, `has_attachments`) — **no body, no
  attachment bytes, no tokens**.
- Upserts `email_threads` (by `provider_thread_id`) and `email_messages` (by
  `provider_message_id`) — both **idempotent**. Logs one `email_sync_runs` row
  with `sync_type='messages'`.

Returns:

```json
{
  "success": true,
  "provider": "gmail",
  "email_account_id": "…",
  "records_processed": 0,
  "threads_processed": 0,
  "mailbox": "…",
  "sync_run_id": "…"
}
```

### Required token state

The mailbox must already be connected (Phase-1) so `email_oauth_tokens` has a row
with a `refresh_token` (Google returns one because the OAuth flow uses
`access_type=offline` + `prompt=consent`). Uses the same `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` secrets — **no new secrets**.

### Deploy & test

```bash
supabase functions deploy gmail-sync-messages
```

```bash
curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/gmail-sync-messages \
  -H "Authorization: Bearer <USER_ACCESS_TOKEN>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "email_account_id": "<EMAIL_ACCOUNT_UUID>", "max_results": 50 }'
```

In the app: **Admin → Email · Gmail → Sync Gmail messages** (shows the connected
account, an account-id input, and a result panel).

### Limitations (this phase)

- **No AI analysis** yet (`email_ai_insights` stays empty).
- **No attachments** — attachment bytes are not downloaded/stored.
- **No unified comms timeline** — email and phone feeds are still separate.
- Incremental sync is "recent `max_results` per label"; there's no Gmail
  `historyId` delta cursor yet.

> Automatic scheduled email sync is now built — see **Connector automation** below.
> This function remains the diagnostic/backfill entry point.

## Connector automation — scheduled phone + Gmail ingestion

Phone **and** Gmail now ingest automatically on a **5-minute cron**, so ServiceOS
stays current with no manual clicks. The Admin sync buttons remain
**diagnostics/backfill** only. Two functions, same pattern (secret-gated, no user
JWT, they invoke the existing idempotent sync functions via the service-role
internal path):

- `phone-scheduled-sync` — see "Scheduled phone sync" above (calls + recordings,
  10-minute rolling window; recordings still auto-trigger Phase-5A enrichment for
  new recordings only).
- `email-scheduled-sync` — finds the tenant's **active** Gmail `email_accounts`
  and invokes `gmail-sync-messages` for each (`max_results = 25` per mailbox). One
  failing mailbox never aborts the run. Logs one `email_sync_runs` row with
  `sync_type='scheduled_sync'`. Returns:

```json
{
  "success": true,
  "accounts_processed": 0,
  "messages_processed": 0,
  "failed_accounts": 0,
  "sync_run_id": "…"
}
```

Both derive the tenant from a hard-coded `SCHEDULED_TENANT_ID`
(`00000000-0000-0000-0000-000000000001`) — `TODO(integration)`: move to
per-tenant integration config.

### Secrets

| Secret                  | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `PHONE_SCHEDULE_SECRET` | Sent as `x-schedule-secret` to `phone-scheduled-sync` |
| `EMAIL_SCHEDULE_SECRET` | Sent as `x-schedule-secret` to `email-scheduled-sync` |

```bash
supabase secrets set PHONE_SCHEDULE_SECRET="$(openssl rand -hex 32)"
supabase secrets set EMAIL_SCHEDULE_SECRET="$(openssl rand -hex 32)"
```

### Deploy

```bash
supabase functions deploy phone-scheduled-sync   # verify_jwt=false via config.toml
supabase functions deploy email-scheduled-sync   # verify_jwt=false via config.toml
```

### Schedule (every 5 minutes)

`config.toml` doesn't schedule Edge Functions; use **pg_cron + pg_net** (SQL
editor). Suggested cron: `*/5 * * * *`.

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('phone-scheduled-sync-5min', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/phone-scheduled-sync',
    headers := jsonb_build_object('content-type','application/json','x-schedule-secret','<PHONE_SCHEDULE_SECRET>'),
    body    := '{}'::jsonb);
$$);

select cron.schedule('email-scheduled-sync-5min', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/email-scheduled-sync',
    headers := jsonb_build_object('content-type','application/json','x-schedule-secret','<EMAIL_SCHEDULE_SECRET>'),
    body    := '{}'::jsonb);
$$);
```

(Or drive them from any external scheduler that can send the `x-schedule-secret`
header. To deploy without editing `config.toml`, add `--no-verify-jwt`.)

### Test

```bash
curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/phone-scheduled-sync \
  -H "x-schedule-secret: <PHONE_SCHEDULE_SECRET>" -H "content-type: application/json" -d '{}'

curl -i -X POST https://<PROJECT_REF>.supabase.co/functions/v1/email-scheduled-sync \
  -H "x-schedule-secret: <EMAIL_SCHEDULE_SECRET>" -H "content-type: application/json" -d '{}'
```

Wrong/missing secret → `403`.

### Cost notes

Cheap by design. Phone syncs only a 10-minute window; Gmail pulls only
`max_results = 25` recent ids per mailbox per label, fetching only messages not
already stored. Nothing forces re-download/transcription/analysis, and **Gmail AI
analysis is not run** here. Idempotent upserts make the 5-minute overlap a no-op
for already-synced rows.

### Limitations

- Single hard-coded tenant/customer for now (the `TODO(integration)` above).
- Gmail incremental sync has no `historyId` delta cursor yet (recent-window only).
- No email AI analysis, no unified comms timeline, no Slack, no customer matching
  (out of scope for this build).
