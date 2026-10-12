# Drummonds real phone TEST acceptance — capture, replay and copy verified

Run `8178fbed-a35c-4de6-9228-2f4ea5279da6` targets only Supabase TEST
`saatxzwxvdvqevbnskxy`, existing Drummonds tenant
`f8c114fa-fee7-4983-8970-f6e7f5fd3129`, and verified Birchills account `3950`.
Chris approved the existing provider credential in TEST and, on 12 October,
explicitly approved this bounded capture and one real recording copy into TEST.
The approval covers only the scope below. Capture, metadata replay and one audio
copy have now passed; broader acceptance remains open. The approval does not
authorise paid AI processing or production promotion.

## Observed result — 12 October

- One real call and one recording record imported from the fixed window. All four
  metadata runs (initial capture and one replay) completed their selected windows.
- Replay retained the same two source identities and count. One 417,425-byte
  recording was copied into the unchanged private TEST bucket; the pinned download
  runtime verified its stored readback hash before completing the attempt.
- Phone capture and the new registry are disabled. Five sync runs succeeded;
  there are no transcripts, AI results, new users/grants or production changes.
- All 194 protected datasets preserve their original rows. The stopped Commusoft
  journal was reconciled only for the exact reviewed phone additions, retaining
  its earlier hashes and a separate audit record.
- Chris's existing signed-in operator loaded this recording and opened its audio
  player. Three exact controller receipts and one audio-access receipt were
  verified; original audit rows are unchanged. **Actual playback has not started.**
  Automatic approval review requires separate permission to listen to the real
  conversation; that question is pending. Opening the player is not playback proof.

The initial call was rejected with `401 internal_auth_mismatch` before a sync run
or provider request. The runner omitted the existing internal-key header. A
single guarded recovery confirmed all six source/run tables were still empty,
verified the existing key digest and supplied that header. No key was created,
replaced or given a new destination. Unknown outcomes cannot use this recovery.

[Sanitised acceptance evidence](evidence/learn-phone-real-test-2026-10-12.json).

## Concrete scope

- Register this provider account only in the existing Drummonds TEST tenant;
  create no user, operator grant, credential or provider permission.
- Temporarily enable its Phone switch and registry. Read the fixed window
  **12 October 2026, 10:00–10:15 UTC**, at most 20 calls and 20 recording records.
- Repeat that metadata window once to check existing source identities survive
  replay. Each recording import explicitly sets `process_new_recordings: false`;
  no automatic audio download, transcription or AI analysis starts.
- Copy at most one recording whose reported size fits the existing **private,
  WAV-only, 1 MiB TEST bucket**. The provider response reader has a separate
  **64 MiB hard download bound**; the bucket still rejects oversized storage.
  If no recording qualifies, stop and report the limitation rather than enlarge
  storage or silently select another window.
- Importers allow at most 50 provider pages each. Two metadata passes plus one
  audio download therefore have a worst-case ceiling of **201 read-only provider
  requests**. There is no automatic replay after an uncertain acknowledgement.
- Use the existing server credential in memory. Keep provider responses and
  recording references private; public evidence contains counts and outcomes.
- Pause the Phone switch and disable this new registry after each stage, including
  errors. Retain the imported records/audio and execution evidence. No schedules
  are created. Existing TEST operator access can then verify retained playback.

No provider writes, paid AI requests, production changes, new access grants or
source-history deletions are included. This bounded sample will not establish
complete historical coverage, voicemail coverage, card enrichment or V1 launch.

## Prepared and verified

The read-only prepare/inspect at 13:04 UTC confirmed an active target tenant with
Phone off; zero calls, recordings, audio, transcripts or AI results; no phone
worker or active cron schedule; and all 194 protected datasets matching. The plan
pins all three endpoint identities and records a private before-state. Other
clients and existing source rows remain covered by aggregate preservation checks;
new target phone rows are allowed only because their initial inventory is empty.
Commusoft's separately approved concurrent append scope remains as documented.

The recording importer previously launched the pipeline automatically on success.
TEST version 9 now accepts an explicit metadata-only option, while omitted/true
keeps existing behaviour. Its ten downloaded executable files match the reviewed
source. Seventy-three local handler checks, three downloaded behaviour checks and
strict endpoint TypeScript checks pass. Deployment preserved all 194 datasets,
other endpoints and SQL definitions, and activated no connection.

Runner: `scripts/verify/learn-phone-real-test.mjs`. Modes are `prepare`, `capture`,
`resume-capture`, `replay`, `download`, `pause` and `inspect`. Mutation modes require the exact run ID
in `LEARN_REAL_PHONE_APPROVED_RUN` after Chris's approval is recorded. Prepare and
inspect are read-only. The private journal is
`.verification-results/phone-real-test-20261012.json`; never recreate it or replay
an operation marked pending. Inspect its exact sync run before further action.

The exact phone additions and subsequent operator audio-access receipt have been
reconciled with the stopped Commusoft supervisor. The original baselines remain
in its private journal. Do not repeat these reconciliations, blindly replace a
baseline, or write a supervisor's journal while it is running.
