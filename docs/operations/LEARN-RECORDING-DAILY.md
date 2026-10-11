# Drummonds daily recording backup operations

Status on 11 October 2026: implemented; 56 local backup checks pass. First real
repeat run started at 11:22 UTC and failed during the final source comparison
when its 20,000-request ceiling was reached. All 2,888 destination byte checks
passed, but no fresh successful manifest was claimed. The earlier complete
inventory and manifest-selected restore remain verified. Recurrence is **not yet
enabled**. A revised live repeat started at 11:38:53 UTC; its terminal result is
pending. Database restore remains separate
and incomplete. [Failure and fix](evidence/learn-recording-daily-first-attempt-2026-10-11.json).

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
summary. The revised run includes that summary and records source-request usage;
its live outcome remains to be verified.

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

The next monthly rehearsal is due by **11 November 2026**. After recurrence is
enabled, its daily follow-up must also inspect the latest successful private
restore evidence and perform this check when due. Successful means decoded,
hash-verified, record reference retained and temporary audio confirmed removed;
use the recorded `checkedAt`, never a file modification time. A future date or
missing/unreadable evidence needs review. Retain an aggregate dated result.
This is one sampled file's decodability and record reference, not human listening,
a full database restore or proof that every recording is intelligible.

## Recurrence and launch limit

After the first repeat run is verified, configure one daily follow-up in this
chat at 09:00 Europe/London using Codex's automation tool. There is currently no
matching recording-backup automation. Test the scheduled instruction manually:
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
