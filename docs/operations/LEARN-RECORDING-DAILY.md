# Drummonds daily recording backup operations

**14 October, 14:08 UTC — fresh combined manual backup verified.**
The existing supervisor completed its fifth invocation at 14:08:44.137 UTC,
checking **3,024 phone files / 631,519,326 bytes**, **255 original voicemail emails /
23,622,647 bytes** and **255 audio files / 13,800,699 bytes**. All 255 voicemail
pairs and 3,018 phone recording references reconcile. No missing references or
null pointers exist in the observed inventories; six unreferenced phone files
remain retained. This is **3,534 files / 668,942,672 bytes** in total.

The final run copied one new phone file / 888,805 bytes and reused 3,533 verified
receipts, including files safely retained during earlier failed attempts. Every
stored byte check and final source comparison passed before immutable manifests
and the aggregate were published. It used 27,241 of 100,000 source requests,
completed within the original one-hour limit and recorded zero read retries.
The exact tested source hashes match. Terminal completion and private journals
were read back; health reports `observed_inventory_verified / within_daily_window`
and the phone lock is released. [Sanitised acceptance](evidence/learn-communication-daily-2026-10-14.json).

Coverage is the observed non-atomic inventories beginning at 13:50:46 UTC,
not subsequent arrivals, a consistent database snapshot or full application/Auth
recovery. This was a manual invocation; unattended operation and human listening
remain unverified. The existing schedule, approved credentials and runner remain.

**14 October — interrupted-read recovery:** four earlier manual invocations
stopped on AWS request/stream or source-read failures and preserved the previous
successful aggregate. The third checked all 3,023 observed phone-file bytes before
its source recheck failed; the fourth stopped during inventory at 13:10:50 UTC.
Their terminal outcomes, journals and prior aggregate remain private. A full
source-only diagnostic subsequently passed, justifying the final recovery above.
No failed or partial run was relabelled as success.

All **142 backup checks** pass. The fixed communication runtime permits at most
three transient read attempts for AWS metadata/journals/byte verification and
source metadata JSON under the same deadlines, lock and budgets. Partial JSON is
discarded; each retried byte check starts a fresh full hash of the pinned version.
Credential failures, denied access, redirects, invalid JSON, changed source/version,
wrong size/digest, cancellation and persistent failures remain failures. Uploads
remain single-attempt; unknown writes require later receipt/readback recovery.
The successful live invocation used zero retries, so actual live recovery from
an interruption is not inferred from that run. [Current follow-up](evidence/learn-build01-followup-2026-10-14.json).

**14 October — bounded recovery of changing inventories:** the existing daily
runner now makes at most three complete inventory observations when the exact
`source_inventory_changed` guard fires. Each attempt is journalled. The same lease,
ports, one-hour deadline and shared source-request budget remain in force; both
complete listing/reference comparisons are still required. Identity, byte,
credential, transport and budget failures do not trigger these inventory retries.
Thirty targeted source/daily/supervisor checks pass, including persistent instability,
shared-budget exhaustion, cancellation and preservation of prior success.

A manual combined run at 11:35 UTC obtained a stable inventory, then stopped on
`s3_transport_timeout` at 11:40:32 UTC. Its terminal result and failure journal are
retained. Read-only inspection subsequently verified the existing destination's
account/privacy/encryption/retention/write safeguards. Recovery started at 11:59:23
UTC using the same approved runner and receipt protocol. Its terminal stream failure is recorded above;
no fresh backup success or unattended operation is claimed by that invocation. The existing schedule
was not changed and no second runner was created.
[Current Build 01 follow-up](evidence/learn-build01-followup-2026-10-14.json).


**13 October, 16:29 UTC — combined phone and voicemail backup verified.**
The fixed three-bucket supervisor verified 2,990 phone files / 624,547,986 bytes,
255 original voicemail emails / 23,622,647 bytes and 255 voicemail audio files /
13,800,699 bytes. All 255 email/audio pairs reconcile; there are no missing file
references or null pointers. Six unreferenced phone files remain retained.
Forty new phone files / 8,484,120 bytes were copied; all 510 voicemail files reused
existing receipts and passed byte verification. The run used 27,384 of 100,000
source requests and terminated successfully under its original execution handle.

The AWS-only monthly voicemail check then restored one matched pair (115,826
bytes), decoded 20.448 seconds of audio and confirmed temporary-file removal.
It used only the existing Restore identity and no production source credential.
The next voicemail check is due 13 November at 16:29:50 UTC. The existing phone
monthly procedure remains independently required.

The existing 09:00 local follow-up was updated and read back: same chat, cadence
and ACTIVE status; it now uses the combined daily command and includes both monthly
checks. This is verified manual execution and an updated schedule, not proof of
unattended operation. The Mac and desktop app must remain available.
[Aggregate acceptance evidence](evidence/learn-communication-daily-2026-10-13.json).

### Current combined commands (supersede phone-only daily commands below)

```sh
node scripts/backup/run-drummonds-communication-backups.mjs --health
node scripts/backup/run-drummonds-communication-backups.mjs --run-drummonds-daily
node scripts/backup/run-drummonds-voicemail-monthly-restore.mjs --health
node scripts/backup/run-drummonds-voicemail-monthly-restore.mjs --check-drummonds
```

The daily supervisor covers only `phone-recordings`, `learn-voicemail-sources`
and `receptionist-voicemails` for the existing Drummonds tenant and approved London
bucket. The 400-new-object/256 MiB and 100,000-request limits are shared across all
three stages. The phone daily lock also protects the combined run; never launch
both commands. Check the original process handle before considering stale-lock
recovery. An incomplete stage preserves the previous successful aggregate.

The monthly voicemail command requires a verified aggregate no older than 30
hours, matching immutable manifests and complete pair coverage. It selects a
bounded pair and rotates away from the previous sample where possible. A separate
lock is acquired before credentials; cleanup must pass before success is saved.
Inspect `.verification-results/voicemail-monthly-restore/last-success.json` and
use its actual `checkedAt`, not file modification time. A failed check does not
refresh success. The existing phone monthly command below remains unchanged.

The following dated entries retain earlier phone-only history.

**12 October, 08:30–08:31 UTC — fresh recording backup and linked restore verified.**
The retried manual daily run verified **2,893 files / 602,476,551 bytes**, including
**five newly copied files / 1,472,290 bytes** and all **2,887 recording references**.
No references lacked a file or storage pointer; six unlinked files remain retained.
The immutable manifest covers the non-atomic 08:14 UTC inventory, not later arrivals.
It used 20,396 of 100,000 permitted source requests and removed its lock.

The separate Restore identity then read that AWS manifest without Supabase access,
matched every **2,883 reference in the 06:37 UTC restored database**, and disclosed
four additional references absent from that earlier snapshot. A recording absent
from the older rehearsal snapshot was restored: 47,705 bytes, one linked call and
one transcript, **29.32 seconds decoded**; temporary audio removal was confirmed.
Human listening was not performed. This is file/archived-reference recovery, not
an atomic full-service restore. The run was manual; dependable scheduled operation
remains unproven. [Fresh backup and recovery evidence](evidence/learn-recording-refresh-recovery-2026-10-12.json).

**12 October update:** the manual daily follow-up at 08:05 UTC stopped at
08:11:32 UTC because source listings or references changed during inventory. It
used 2,934 source requests, saved no inventory, retained the previous successful
manifest and removed its lock. The scan now checks metadata in batches of at most
four, draining each batch before propagating failure; both complete before/after
comparisons remain mandatory. All 83 backup tests pass. A live retry is still
required. [Failure and candidate evidence](evidence/learn-recording-inventory-concurrency-2026-10-12.json).

Status on 11 October 2026: the corrected real daily run **succeeded at 11:53:07
UTC**, verifying 2,888 files / 601,004,261 bytes and all 2,882 recording references.
Six unlinked objects were retained; there were no missing file references or null
recording pointers. No audio was uploaded again. The new immutable manifest
covers the non-atomic inventory observed at 11:38:55 UTC, not later arrivals.
The run used 20,288 of its 100,000 source requests, released its lock and reports
`observed_inventory_verified`. All 56 local backup checks pass.
[Verified run](evidence/learn-recording-daily-verified-2026-10-11.json).

The daily follow-up is now **ACTIVE** at 09:00 local time on this Mac, with monthly
restore-due checks. No scheduled execution has yet occurred; this is a verified
manual run and an enabled schedule. Database restore, dependable operational host
availability and operator-facing monitoring remain incomplete.

The first repeat failed at 11:36 UTC after reaching its 20,000-request ceiling in
the final source comparison. It did not publish a successful manifest or replace
earlier verified coverage. [Failure and fix](evidence/learn-recording-daily-first-attempt-2026-10-11.json).

## Scope and execution

Use the existing approved Writer identity from this Mac's Keychain and the existing
OpenFolk London bucket. The source is production project `tgbnakbxwcqjeimygroz`,
Drummonds tenant `00000000-0000-0000-0000-000000000001`, retained recording files only.
No source writes, new access, deletions or configuration changes occur.

From the ServiceOS checkout:

```sh
node scripts/backup/run-drummonds-recording-daily.mjs --run-drummonds-daily
node scripts/backup/run-drummonds-recording-daily.mjs --health
```

Each run obtains a fresh complete metadata inventory and recording-reference
reconciliation, saved privately before copying. It discovers existing immutable
receipts with at most four requests active. Missing receipts trigger the existing
verified copy protocol; unchanged files are not uploaded again. Every file in the
observed inventory is then checked against its exact stored AWS version and full
byte digest, with source identities checked before and after verification. Only
then may a new immutable remote manifest support a successful inventory result.

Limits are 10,000 inventory objects, 400 objects/256 MiB of newly considered audio
per run, four concurrent operations, 100,000 source requests across inventory,
copying and both verification passes, and a one-hour deadline. This includes
per-file reference pagination rather than counting only storage metadata calls.
The separate initial-copy CLI retains its 20,000-request ceiling. Exceeding a limit
fails visibly; it never silently truncates coverage. Missing source files and
recordings without storage pointers are separate capture/reconciliation gaps.
Later arrivals require a later run. The inventory remains non-atomic and does
not establish database consistency, transcription quality or universal playback.

## Private state and failure handling

`.verification-results/recording-daily/` is private mode 0700; JSON journals are
mode 0600, checked for ownership and symlinks. It contains no saved credentials.
Inventories and reconciliation files contain private source paths and record
references: never print or commit them. Only aggregate reports may enter Git.
The failed first repeat loaded an earlier wrapper without the source-reconciliation
summary. The successful revised run includes that summary and source-request usage.

`last-success.json` changes only after manifest verification. A later failure
updates `last-attempt.json` while preserving the earlier success. `--health`
distinguishes missing verification, failed attempts, an unconfirmed long run,
and an inventory older than 30 hours. Healthy means **observed file inventory
verified**, never a complete system backup or database restore.

A global `daily.lock` prevents overlapping daily runners. Never infer liveness
from a lock or journal alone. Inspect the confirmed execution handle and process
identity. Continue waiting for a live run; never restart on an observation timeout.
If the exact process is terminal or missing, inspect its private journal and any
remote manifest before removing an abandoned lock. Never clear a live lock.
A new run can safely discover existing create-only receipts after a lost reply;
it must still verify bytes and cannot inherit a previous run's freshness.

Credentials errors need repair at their secure source; do not fall back to root,
create replacement permissions, rotate unrelated keys or export source keys.
The Writer and Restore keys remain separate. Use the existing Restore runner for
monthly isolated checks and keep temporary restored audio private and removed
once verified.

## Monthly restore check

The approved monthly check uses the separate Restore identity and **AWS only**.
Choose one non-empty, referenced object at most 8 MiB from the private inventory
matching the latest verified daily manifest. A median-size eligible object is a
repeatable sample. Do not use an in-progress or failed inventory as proof of a
saved manifest. The restore command independently validates the remote manifest
and exact selected object/version before accepting bytes.

```sh
node scripts/backup/run-drummonds-recording-restore.mjs --check-drummonds RUN_UUID OBJECT_UUID
```

Substitute the matching inventory run and selected object IDs locally; never put
private inventory paths or recording references into reports. The check command
rejects empty and oversized selections, restores one file, verifies its hash,
decodes it and removes temporary audio automatically. Only private evidence and
an aggregate report remain. Failed decoding still removes the temporary file but
returns an unsuccessful command result; a failed decode must not refresh the
last successful restore date. The existing `--restore-drummonds` mode deliberately
retains its restored file for a separately requested recovery.

At **11:42:41 UTC on 11 October**, this check recovered 131,685 bytes from the
previously verified manifest, decoded 81 seconds, retained one recording link,
and removed temporary audio. Separate filesystem inspection confirmed the audio
directory was absent and evidence remained private (0600). The 56-test suite
covers removal after both successful and failed decoding and rejects out-of-limit
selections before retrieval. [Real check](evidence/learn-recording-monthly-check-2026-10-11.json).

The next monthly rehearsal is due by **11 November 2026**. The active daily
follow-up must also inspect the latest successful private
restore evidence and perform this check when due. Successful means decoded,
hash-verified, record reference retained and temporary audio confirmed removed;
use the recorded `checkedAt`, never a file modification time. A future date or
missing/unreadable evidence needs review. Retain an aggregate dated result.
This is one sampled file's decodability and record reference, not human listening,
a full database restore or proof that every recording is intelligible.

## Recurrence and launch limit

A daily follow-up was created through Codex's automation tool at 11:46 UTC and
activated after successful verification at 11:53 UTC:
`drummonds-recording-backup-and-recovery-checks`, attached to this chat, **ACTIVE**,
scheduled for 09:00 local time (Europe/London on this Mac). The saved status was
read back. It includes the monthly restore-due check. No scheduled execution has
occurred. Update this existing follow-up instead of creating a duplicate. The
scheduled procedure has been exercised manually:
read health, inspect any active process before starting, run only the fixed
command above, wait for terminal evidence, then report aggregates. Stay quiet
when no meaningful condition changes; report new failures, overdue coverage,
recovery and required action. Do not send Slack or email messages.

This uses local files and Mac Keychain access, so it needs this computer powered
on and the desktop app running. This is an initial local operational arrangement,
not an always-on managed production worker. Launch still needs dependable host
availability and operator-facing monitoring to be accepted. Moving execution to
an always-on host, storing source credentials elsewhere, or creating additional
cloud access requires a concrete reviewed configuration and applicable approval.

Official scheduling behaviour:
[OpenAI scheduled tasks documentation](https://learn.chatgpt.com/docs/automations?surface=app).
