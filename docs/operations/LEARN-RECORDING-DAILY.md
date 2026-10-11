# Drummonds daily recording backup operations

Status on 11 October 2026: implemented; 53 local backup checks pass. First real
repeat run started at 11:22 UTC and remains in progress. Recurrence is **not yet
enabled**. Initial coverage of the explicitly observed 2,888 files and a separate
manifest-selected restore already passed; this repeat run has not yet proven
fresh coverage. Database restore remains separate and incomplete.

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
per run, four concurrent operations and a one-hour deadline. Exceeding a limit
fails visibly; it never silently truncates coverage. Missing source files and
recordings without storage pointers are separate capture/reconciliation gaps.
Later arrivals require a later run. The inventory remains non-atomic and does
not establish database consistency, transcription quality or universal playback.

## Private state and failure handling

`.verification-results/recording-daily/` is private mode 0700; JSON journals are
mode 0600, checked for ownership and symlinks. It contains no saved credentials.
Inventories and reconciliation files contain private source paths and record
references: never print or commit them. Only aggregate reports may enter Git.
The initial live verification started before the source-reconciliation summary
was added to the local result; that summary addition is locally tested but is
not evidence of the running process's loaded version.

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
