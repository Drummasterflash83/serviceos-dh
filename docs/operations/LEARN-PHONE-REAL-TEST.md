# Drummonds real phone TEST acceptance — prepared, not executed

Run `8178fbed-a35c-4de6-9228-2f4ea5279da6` targets only Supabase TEST
`saatxzwxvdvqevbnskxy`, existing Drummonds tenant
`f8c114fa-fee7-4983-8970-f6e7f5fd3129`, and verified Birchills account `3950`.
Chris already approved the existing provider credential in TEST. This next scope
includes copying real recording audio into TEST, which needs his decision under
the launch goal's requirement to approve a new recording destination.

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
`replay`, `download`, `pause` and `inspect`. Mutation modes require the exact run ID
in `LEARN_REAL_PHONE_APPROVED_RUN` after Chris's approval is recorded. Prepare and
inspect are read-only. The private journal is
`.verification-results/phone-real-test-20261012.json`; never recreate it or replay
an operation marked pending. Inspect its exact sync run before further action.

A separate review must reconcile this run's proven additions with the Commusoft
supervisor's saved preservation inventory after that supervisor stops; never
blindly replace its baseline or write its live journal while it is running.
