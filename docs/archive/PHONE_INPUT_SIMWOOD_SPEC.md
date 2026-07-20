> **SUPERSEDED — archived for historical reference.**
> This document is no longer maintained and may contain claims that were
> true only at the time of writing. Its subject is now owned by
> [Scheduler Operations](../operations/SCHEDULER_OPERATIONS.md).
> Start at the [documentation index](../README.md). Kept to preserve the
> architectural evolution and decision history.

---

# ServiceOS — Phone Input Module (Simwood / Sipcentric) Technical Specification

**Status:** Draft — specification only, no implementation.
**Module:** Phone Input (first ServiceOS backend data source)
**Upstream API:** Sipcentric PBX REST API **v1** (the retail/PBX API of the Simwood group; also historically branded Nimvelo).
**Owner:** ServiceOS backend foundation (`serviceos-backend-foundation` branch).
**Last updated:** 2026-07-01

> This document is the design basis for wiring Drummond Heating's telephony into ServiceOS. It describes *what* we build and *why*, not code. No dependencies, UI, or schema are created by this document. Endpoint/auth/rate-limit facts are taken from the published Sipcentric v1 docs (see [References](#references)); everything under "ServiceOS design" is our own proposal.

---

## 1. Purpose

Drummond Heating's inbound and outbound calls are the single richest, least-captured signal in the business — every job, complaint, quote query, and emergency starts as a phone call. Today that data lives only inside the Sipcentric PBX and is invisible to ServiceOS.

The **Phone Input module** is the first real backend feed for ServiceOS. It:

1. **Syncs call history (CDRs)** from Sipcentric into ServiceOS on a schedule.
2. **Syncs and stores call recordings** where recording is enabled and lawful.
3. **Downloads recording audio** and runs **transcription**.
4. **Enriches** transcripts with AI (intent, sentiment, urgency, entities, next-best-action) to feed the existing ServiceOS **Calls & Comms**, **Voice Analytics**, and **Reception Agent** surfaces (currently rendered from hard-coded demo data).
5. Produces durable, queryable records that later modules (Operations, Customers, Compliance) can join against.

**Non-goals (this module):** originating/controlling live calls, real-time streaming/whisper, IVR changes, SMS. Call origination exists in the API (`POST /calls`) but is out of scope for the input module.

---

## 2. API capabilities

The Sipcentric v1 API is a paginated REST/JSON API over HTTPS. Capabilities relevant to Phone Input:

| Capability | Available | Used by this module |
|---|---|---|
| Fetch call history / CDRs (`GET /calls`) | ✅ | Yes — core |
| Filter calls by time window, direction, from/to | ✅ | Yes |
| List call recordings metadata (`GET /recordings`) | ✅ | Yes — core |
| Download recording audio (WAV) | ✅ | Yes — core |
| Pre-auth token for browser-side recording download | ✅ | Optional (see §4) |
| Originate calls (`POST /calls`) | ✅ | **No** (out of scope) |
| Phonebook / SMS / other sub-resources | ✅ | No (future modules) |
| Rate-limit headers | ✅ | Yes — scheduler backoff |

Notably **absent upstream** (must be built in ServiceOS): transcription, sentiment/intent analysis, customer matching, dashboards, retention/audit policy. The API gives us CDRs + audio; everything analytical is ours.

---

## 3. Endpoints to use

**Base URL:** `https://pbx.sipcentric.com/api/v1`
All paths are scoped to a customer/account: `/customers/{customerId}/…`.

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | `GET` | `/customers/{customerId}/calls` | Call history (CDRs) — primary sync source |
| 2 | `GET` | `/customers/{customerId}/recordings` | Recording metadata list |
| 3 | `GET` | `/customers/{customerId}/recordings/{id}` (with `Accept: audio/wav`) | Download recording audio |
| 4 | `GET` | `/customers` *(or account bootstrap)* | Resolve `customerId` at setup |
| 5 | `POST` | `/customers/{customerId}/recordings/{id}/token` *(token generator)* | Optional pre-auth for direct audio URLs |

### 3.1 `GET /calls` — query parameters

| Param | Meaning |
|---|---|
| `createdAfter`, `createdBefore` | ISO-8601 window on record creation |
| `startedAfter`, `startedBefore` | ISO-8601 window on call start |
| `from`, `to` | Exact-match number filter |
| `direction` | `IN` / `OUT` |
| `includeLocal` | Include internal extension-to-extension calls (default `false`) |
| `pageSize`, `page` | Pagination (default 20, **max 200**) |

**Call response fields:** `type`, `uri`, `created`, `scope`, `direction`, `from`, `to`, `callStarted`, `outcome`, `duration`, `cost`, `callId`, `linkedId`.

### 3.2 `GET /recordings` — query parameters

`createdAfter`, `createdBefore`, `startedAfter`, `startedBefore`, `callId`, `linkedId`, `pageSize`, `page`.

**Recording response fields:** `type`, `uri`, `created`, `direction`, `partyId`, `started`, `size`, `callId`, `linkedId`, `endpoint`.

> **Join key:** `callId` (and `linkedId` for multi-leg/transferred calls) links a recording back to its CDR. This is the backbone of our data model — recordings are matched to calls on `callId`, and legs of one conversation are grouped on `linkedId`.

### 3.3 Pagination model

Every list response wraps: `{ totalItems, pageSize, page, items[], prevPage, nextPage }`. Sync loops follow `nextPage` until absent. We cap `pageSize=200` to minimise request count against the rate limit.

---

## 4. Authentication model

**Upstream (Sipcentric):**

- **HTTP Basic Auth** — portal `username:password`, Base64-encoded, over HTTPS only. Used for all server-to-server sync calls (`/calls`, `/recordings`, audio download).
- **Token generator** — for cases where Basic Auth can't be sent (e.g. an audio URL loaded directly in a browser `<audio>`/`<img>` element), the API mints a short-lived pre-authenticated token. ServiceOS uses this **only** if we ever expose recording playback directly to the browser; the default design proxies audio server-side and does **not** need it.

**ServiceOS design:**

- Credentials are **server-side only**. Stored as env/secret (`SIPCENTRIC_USERNAME`, `SIPCENTRIC_PASSWORD`, `SIPCENTRIC_CUSTOMER_ID`) via `.dev.vars` locally (already git-ignored) and the deploy platform's secret store (Cloudflare) in production. **Never** shipped to the client bundle.
- All Sipcentric traffic originates from a ServiceOS **server function / scheduled worker**, never from the React app.
- A single service account (Drummond's Sipcentric login) is used; per-user OAuth is not offered by the v1 API.
- Recording playback in the ServiceOS UI is served through a ServiceOS **authenticated proxy endpoint**, which re-checks the ServiceOS user's own auth before streaming stored audio — decoupling Sipcentric credentials from end-user access.

---

## 5. Rate limit notes

- **Limit:** ~**1200 requests per user per rolling 60 minutes**.
- **Signalled via headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

**ServiceOS handling:**

1. **Read the headers on every response**; when `X-RateLimit-Remaining` is low, pause the sync until `X-RateLimit-Reset`.
2. **Backoff:** exponential backoff with jitter on `429`/`5xx`; honour `Reset` when present.
3. **Budget the sync:** at `pageSize=200`, a full month of CDRs is a handful of requests — well inside budget. Recording *audio downloads* are the heavy path; throttle them (e.g. a small concurrency cap + a per-run ceiling) so a large backlog can't exhaust the hourly budget.
4. **Incremental, not full, syncs** (see §6) keep steady-state request counts tiny.
5. **Single-flight:** a distributed lock prevents overlapping scheduled runs from double-spending the budget.

---

## 6. Call history sync design

**Goal:** keep a complete, gap-free mirror of Sipcentric CDRs in ServiceOS.

**Strategy — incremental watermark sync:**

1. Maintain a per-account **watermark** = the `created` timestamp of the newest CDR successfully ingested.
2. Scheduled job (e.g. every 5–15 min) calls `GET /calls?createdAfter={watermark}&pageSize=200&includeLocal=false`, following `nextPage` to completion.
3. **Upsert** each call on the natural key `callId` (idempotent — safe to re-run; overlapping windows don't duplicate).
4. Advance the watermark only after the whole page-set commits, so a mid-run failure re-fetches rather than skips.
5. **Overlap guard:** query from `watermark − Δ` (a few minutes) to absorb late-arriving/out-of-order records; dedup on `callId` makes the overlap harmless.
6. **Backfill:** a one-off bounded historical crawl (oldest→newest by `createdBefore` windows) seeds the table on first run, tracked separately from the live watermark.
7. Record each run in a **sync-log** table (window, counts, rate-limit remaining, errors) for observability and Compliance audit.

**Direction & scope:** store both `IN`/`OUT`; `includeLocal=false` by default (internal calls are noise for the customer-facing views but can be enabled later).

---

## 7. Recording sync design

**Goal:** mirror recording *metadata* and link each recording to its call, independent of whether audio has been downloaded yet.

1. Incremental watermark sync of `GET /recordings?createdAfter={watermark}&pageSize=200`, same pattern as §6.
2. **Upsert** on recording `id`; set `call_id`/`linked_id` foreign keys to the calls table.
3. Store `size`, `started`, `direction`, `partyId`, `endpoint` — enough to index/search without fetching audio.
4. Set a lifecycle status: `pending_download → downloaded → transcribed → enriched` (or `failed`/`skipped`).
5. **Late-linking:** a recording may arrive before or after its CDR; a reconciliation pass matches orphan recordings to calls on `callId` once both exist.
6. Metadata sync is cheap and runs frequently; audio download (§8) is a separate, throttled stage so recording *discovery* is never blocked by download volume.

---

## 8. Audio download / transcription design

Two decoupled stages, driven off recording lifecycle status.

### 8.1 Download

1. Worker selects recordings in `pending_download`, throttled per §5.
2. `GET /customers/{customerId}/recordings/{id}` with header **`Accept: audio/wav`** → audio bytes.
3. Store audio in **object storage** (Cloudflare R2 — already in the deploy stack), keyed by recording id; store the storage key + checksum + byte size in the DB. **Do not** store audio blobs in the relational DB.
4. Verify downloaded `size` against the metadata `size`; on mismatch, retry then mark `failed`.
5. Advance status to `downloaded`.

### 8.2 Transcription

1. Worker selects `downloaded` recordings.
2. Send audio to a **speech-to-text provider** (provider TBD — decision recorded in §13 Phase 3; must support en-GB, telephony 8 kHz, diarisation of the two call legs).
3. Persist the transcript: full text, per-segment timestamps, speaker/diarisation labels, provider, model, language, confidence.
4. Advance status to `transcribed`.
5. **Idempotency & cost control:** never re-transcribe a recording whose audio checksum is unchanged; transcription is the most expensive step.

> **Audio format note:** the v1 API returns **WAV** via the `Accept` header. Transcode to a compressed format (e.g. Opus/MP3) for cheap long-term storage/playback if needed, but keep the original WAV (or its checksum) for evidential integrity per §12.

---

## 9. AI enrichment pipeline

Runs on `transcribed` records; produces the structured signal the ServiceOS views consume. **Provider:** the latest Claude model (per ServiceOS AI-model convention) via a server-side call; prompt/schema versioned.

**Pipeline stages (per call):**

1. **Normalise** — assemble transcript + CDR context (direction, duration, from/to, time, matched customer).
2. **Structured extraction** (single LLM call, JSON-schema-constrained output):
   - `intent` (e.g. no-heating, leak, quote query, annual service, complaint, chase)
   - `urgency` (low / med / high / emergency)
   - `sentiment` (score + label; flags "frustrated", "complaint", safeguarding language)
   - `entities` (customer name, address, postcode, equipment/boiler refs, job/quote IDs)
   - `summary` (1–2 lines for the call list)
   - `next_best_action` + suggested owner (maps to Reception/Scheduling/Care agents)
   - `outcome_class` (booked, callback owed, resolved, unresolved, spam)
3. **Customer matching** — resolve `from`/`to` and extracted entities to a ServiceOS customer record (later module); until Customers exists, match on phone number only.
4. **Persist** enrichment row (versioned by prompt/model so re-runs are comparable).
5. **Guardrails** — enrichment is **advisory**: it never triggers outbound actions on its own (consistent with the "No silent automation" stance in the existing Agents view). It only populates views and queues suggestions.
6. Advance status to `enriched`.

**Re-processing:** enrichment is versioned; bumping the prompt/model version re-runs the pipeline without touching audio/transcription.

---

## 10. Proposed database tables

Relational schema (Postgres/Supabase-style shown; provider decided in the backend-foundation track, not here). Names indicative.

### `phone_accounts`
Connection config per Sipcentric account.
`id`, `sipcentric_customer_id`, `label`, `active`, `created_at`, `updated_at`
*(credentials live in the secret store, **not** this table.)*

### `calls` — CDR mirror
`id` (uuid) · `account_id` (fk) · `call_id` (unique, from API) · `linked_id` · `direction` · `from_number` · `to_number` · `scope` · `call_started` · `created` · `duration_seconds` · `outcome` · `cost` · `include_local` · `customer_id` (fk, nullable — set by enrichment) · `raw` (jsonb of original payload) · `synced_at`
**Unique:** `(account_id, call_id)`. **Index:** `call_started`, `linked_id`, `from_number`.

### `call_recordings` — recording metadata + audio pointer
`id` (uuid) · `account_id` (fk) · `recording_id` (unique, from API) · `call_id` (fk → calls.call_id) · `linked_id` · `direction` · `party_id` · `endpoint` · `started` · `created` · `size_bytes` · `storage_key` (R2 object key, nullable until downloaded) · `checksum` · `status` (`pending_download`/`downloaded`/`transcribed`/`enriched`/`failed`/`skipped`) · `raw` (jsonb) · `synced_at`
**Unique:** `(account_id, recording_id)`.

### `call_transcripts`
`id` · `recording_id` (fk) · `language` · `provider` · `model` · `confidence` · `text` · `segments` (jsonb: `[{start,end,speaker,text}]`) · `created_at`

### `call_enrichments`
`id` · `call_id` (fk) · `recording_id` (fk, nullable) · `intent` · `urgency` · `sentiment_score` · `sentiment_label` · `flags` (jsonb) · `entities` (jsonb) · `summary` · `next_best_action` · `suggested_owner` · `outcome_class` · `prompt_version` · `model` · `created_at`

### `phone_sync_runs` — observability / audit
`id` · `account_id` (fk) · `resource` (`calls`/`recordings`/`download`/`transcribe`/`enrich`) · `window_start` · `window_end` · `items_seen` · `items_upserted` · `rate_limit_remaining` · `status` · `error` · `started_at` · `finished_at`

**Relationships:** `calls 1—* call_recordings 1—1 call_transcripts`; `calls 1—* call_enrichments`. All FKs on-delete restrict; audio lives in R2, DB holds only pointers.

---

## 11. ServiceOS dashboard outputs

The module feeds existing surfaces (today rendered from mock data — see `src/routes/app.tsx`, `src/components/app/NewViews.tsx`). No new UI is built here; these are the **data contracts** those views will bind to.

| Surface (existing) | Consumes |
|---|---|
| **Calls & Comms** (`CommsHub`, `Calls`) | Live/recent call list: time, caller, direction, `intent`, `urgency`, `sentiment`, `summary`, recording playback link |
| **Voice Analytics** (Agents view) | Aggregate: calls analysed/day, sentiment distribution, coaching flags, first-call-resolution proxy |
| **Reception Agent** | Per-call `next_best_action` + suggested owner + route |
| **Recurring Issues panel** (`RecurringIssuesPanel`) | Clustered `intent`/`entities` over time (e.g. repeat leak calls per site) |
| **North Star / Company Health** | Comms pillar inputs: unanswered-rate, callback-owed count, complaint-risk signals |
| **Customers** (future) | Call history + sentiment timeline per matched customer |

**Playback:** UI requests audio from the ServiceOS proxy endpoint (§4), not Sipcentric directly.

---

## 12. Compliance / call recording notes

> Not legal advice. Drummond Heating operates in the UK; the module must be built to let the business meet its obligations. Confirm specifics with the business's DPO/legal before go-live.

- **Lawful basis & notification (UK GDPR / PECR):** callers must be informed that calls are recorded and why (pre-recording announcement / privacy notice). The module records **what** was said and stored; the business owns caller notification.
- **Purpose limitation:** recordings/transcripts are used for the stated purposes (service quality, dispute resolution, training, operational intelligence) only. Enrichment must not repurpose data beyond this.
- **Data minimisation & retention:** define a **retention period** for audio, transcripts, and enrichments (configurable per `phone_accounts`); auto-purge on expiry. Keep original audio checksum for integrity even after transcode.
- **Special-category & safeguarding:** transcripts may capture health/vulnerability info. Flag and restrict access; the sentiment stage explicitly surfaces safeguarding/threat language for human review (never auto-action).
- **Access control & audit:** recording playback and transcript access gated by ServiceOS auth and logged; `phone_sync_runs` gives an ingestion audit trail. Least-privilege on the Sipcentric service credential.
- **Data subject rights:** design tables so a caller/customer's records can be **found (by number), exported, and erased** on request — the phone-number index and per-record status support this.
- **Data location:** audio in R2 and any AI provider processing should sit in acceptable regions; record processor/sub-processor list (STT provider, LLM provider) for the ROPA.
- **Right to erasure vs. legal hold:** support suppression/hold flags so erasure doesn't destroy records under a legitimate retention obligation.

---

## 13. MVP implementation phases

Each phase is independently shippable and adds one link in the chain. Nothing here is built yet.

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0 — Foundations** | Secret storage, `phone_accounts`, Sipcentric client wrapper (Basic Auth, rate-limit-aware, pagination), `customerId` resolved. | Can authenticate and fetch one page of `/calls` server-side; secrets never in client bundle. |
| **1 — Call history sync** | `calls` table + incremental watermark sync + `phone_sync_runs` + backfill. | CDRs mirrored gap-free; re-runs are idempotent; rate-limit backoff verified. |
| **2 — Recording metadata sync** | `call_recordings` table + metadata sync + call↔recording linking. | Every recording linked to its CDR on `callId`; lifecycle status tracked. |
| **3 — Audio download + transcription** | R2 storage, throttled downloader, STT provider chosen, `call_transcripts`. | Recordings downloaded, checksum-verified, transcribed en-GB with diarisation; no re-transcribe on unchanged audio. |
| **4 — AI enrichment** | `call_enrichments` + schema-constrained LLM pipeline (versioned). | Each transcribed call yields intent/urgency/sentiment/summary/NBA; advisory-only; re-runnable by version. |
| **5 — Dashboard data contracts** | Server functions/queries exposing the outputs in §11 to existing views. | Calls & Comms / Voice Analytics render real data behind a flag, replacing mock arrays. |
| **6 — Compliance hardening** | Retention/purge jobs, access logging, erasure/export tooling, ROPA entries. | Retention enforced; audit + data-subject workflows demonstrable. |

**Suggested MVP cut line:** Phases 0–2 deliver a real, queryable call-history feed (the headline win) with recordings indexed but audio not yet processed — lowest cost, immediately useful, and de-risks the API integration before committing to STT/LLM spend in Phases 3–4.

---

## References

- Sipcentric PBX API v1 docs — <https://github.com/sipcentric/pbx-api-docs/blob/master/api/v1.md>
- Sipcentric PBX API docs index — <https://github.com/sipcentric/pbx-api-docs/blob/master/index.md>
- Simwood Developer portal — <https://developer.simwood.com/docs/direct/api/v1/>
- Nimvelo API v1 (legacy branding, same API) — <https://developer.nimvelo.com/api/v1/>

*API facts (base URL, endpoints, fields, rate limit, pagination, auth) are drawn from the above; the ServiceOS data model, sync/enrichment design, dashboard contracts, and phasing are proposals for review.*
