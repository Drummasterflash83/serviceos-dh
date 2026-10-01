# Phone recovery increment, 1 October 2026

## Evidence

Read-only production query found four recordings each with 70 failed transcription
attempts in 24 hours. Every error was flattened to `openai_error` / HTTP 400.
One recording's provider metadata says 125 bytes; that is a diagnostic clue, not
proof of the exact audio problem. The other three were around 2.5–3 MB. Do not
assume a universal codec or file-size cause without examining classified results.
The live selector ignored failure history and repeatedly selected the oldest rows.

## Changes

- Provider errors mapped to safe categories without logging arbitrary provider
  text, filenames, transcripts or credentials. Store provider HTTP status and actual
  stored audio byte length. Existing API key/model/provider remain unchanged.
- Per-recording retry: 1/5/15/60 minute cooldown; after five consecutive pipeline
  failures at the current stage, hold for review. Known permanent errors hold
  immediately. Recent in-progress runs are not selected by the drainer.
- Default batch stays five: up to four ready records from the last 24 hours,
  one oldest historical record, spare slots filled from either lane. No schedule,
  batch-size or concurrency increase. Batch size one prioritises fresh work.
- Original audio and failure history retained. Held rows remain in backlog and
  unresolved-failure totals, not falsely marked complete. Operator-only readiness
  RPC explains what is ready, cooling down, in progress or needs review.
- A successful explicit correction attempt resets the hold. Retry via the existing
  tenant-authorised pipeline after fixing the cause; do not clear audit history.

This is not a new per-recording atomic lease. Direct background processing and
manual invocation can still race; dedicated per-recording claims remain a follow-up.
Historical backfill spending requires a ceiling before any bulk/manual run.

## Tests and release

Node classifier tests use mocked error bodies, with no paid API calls. Pure SQL
assertions cover new work, cooldown, stage changes, exhausted attempts, terminal
audio errors, active/abandoned runs and recovery. Validate migration and assertions
inside a rolled-back transaction first. Compile the selector against the real
schema without starting any processing.

Deploy only this migration, `phone-transcribe-recording`, `platform-worker` and
`phone-process-pending`. Do not apply unrelated pending migrations. Register the
exact applied migration in the normal Supabase history. The last two functions
share the changed worker handler. No frontend or Emma provider setting change.

Post-release: verify migration history and readiness breakdown, show that held
recordings no longer fill the selected batch, and observe a normal scheduled run
advancing other records. Do not equate this fix with an empty backlog or an
end-to-end launch acceptance. Sustained latency, email recovery and exact audio
repair still require proof.

Rollback: restore the previous `phone_select_pending` definition from migration
20260711120000 and redeploy previous function sources. Readiness/helper functions
are additive and can remain unused. Restoring the old selector also restores the
poison-record retry risk; normally prefer pausing that one processing job over
silently accepting repeated failed calls. Do not change call routing.
