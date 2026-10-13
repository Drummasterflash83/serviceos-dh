# Voicemail independent backup extension — first copy and independent file restore verified

## Current evidence — 13 October, 15:23 BST

All 255 audio files (13,800,699 bytes) and 255 original emails (23,622,647
bytes) from the fixed retained inventory have verified immutable manifests in
the approved existing London backup destination. Source revisions and destination
bytes were rechecked. Existing credentials, protection and permissions were reused.

The separate read-only Restore identity independently downloaded one matched pair
(139,356 bytes), verified both hashes and decoded 25.344 seconds of audio without
accessing Supabase. Temporary private files were removed. Human listening and the
isolated database relationship comparison remain unverified. The independently
restored database snapshots identified so far predate these imports, so file
recovery alone does not prove complete service recovery. Daily voicemail backup
coverage is still not configured; new arrivals are outside this fixed inventory.

Evidence: [first independent copy and restore](evidence/learn-voicemail-independent-copy-2026-10-13.json).

## Original proposal and implementation history

The following describes the earlier gap and design; the current evidence above
supersedes its pending-copy statements.

The independent recording backup currently covers only `phone-recordings`.
`scripts/backup/recording-backup-source.mjs` fixes that bucket and reconciles
`phone_recordings.storage_path`; the daily wrapper uses that adapter. Database
snapshots retain voicemail rows but do not contain Supabase Storage object bytes.
Therefore the 255 verified voicemail/source pairs are **not yet proven recoverable
from the independent AWS backup**. Live playback and database restore do not close
this gap.

## Minimal extension within the existing destination

Reuse the existing OpenFolk London bucket
`openfolk-drummonds-recordings-235099643372-eu-west-2` and its exact Drummonds
`tenants/00000000-0000-0000-0000-000000000001/` prefix. Reuse the scoped Writer and
Restore identities already in Keychain. The retained CloudFormation policy permits
objects beneath that prefix; no new destination, identity, key, permission,
retention setting or deletion ability is required by this design. Verify the live
policy, principal and bucket protection before a transfer, as the current adapter
does. Do not expand source scope to other tenants or buckets.

Add a voicemail-specific source adapter for precisely these two private buckets:

- `receptionist-voicemails`: reconcile published `receptionist_voicemails` and
  `receptionist_voicemail_intakes`. Expected key is
  `tenant/mailbox/intake`; verify intake `audio_sha256` and `audio_bytes` as well
  as Storage version, ETag, length and streamed bytes.
- `learn-voicemail-sources`: reconcile `receptionist_voicemail_sources`. Expected
  key is `tenant/intake/source.eml`; verify `raw_sha256` and `raw_bytes` plus the
  same Storage metadata and streaming guards. These files contain complete
  original signed notification emails; treat them as private source documents.

Keep the existing recursive whole-tenant inventory and two-pass reconciliation:
include orphan or partially prepared objects as retained evidence, report their
state separately, and never silently discard them because a published row is
missing. Conversely, a published row without its expected object must fail
complete-backup acceptance. Initial inventory should confirm actual object count
and bytes; 255 pairs imply 510 referenced files, not proof that total object
inventory is exactly 510.

Extend backup identity with an explicit allowlisted `sourceBucket` for new
voicemail entries. Include it in the source digest, receipt, restore manifest and
adapter admission. **Leave legacy phone entry serialization unchanged** so every
existing phone digest, receipt and restore remains valid. Do not merely change the
hardcoded source bucket: current identity loses bucket provenance and could
confuse matching paths across buckets. Run each bucket as a separate inventory and
retain a combined report identifying all three buckets and their coverage.

Reuse existing S3 conditional immutable writes, versioned checksum verification,
30-day governance retention, encrypted receipt/manifest handling, bounded transfer
and independent Restore-role verification. No raw email or audio belongs in Git,
stdout, user-facing diagnostics or unprotected local files. Keep source credentials
in memory and out of AWS objects. Preserve the existing local private temporary
file and cleanup rules when streaming verification needs disk.

## Verification and rollout

Before any real copy, test legacy receipt compatibility; equal paths in different
buckets producing distinct identities; tenant/bucket/path rejection; missing and
orphan objects; partial preparation; changed revisions; SHA/length mismatches;
interrupted copies and idempotent recovery; retention and denied-delete checks.
Then prepare an exact bounded inventory and first transfer, using existing scoped
credentials and destination. Independently download with the Restore identity,
verify raw/audio hashes against an isolated database restore, and play at least
one restored recording while retaining its original signed email. Do not publish
restored files or change production source rows.

Only after the first copy and restore are verified, add these two inventories to
the existing daily local cycle, with one aggregate health result that becomes
incomplete if any bucket fails. Preserve the current schedule and lock semantics;
the Mac still needs to be awake. Record initial counts/bytes, per-bucket last
complete backup, restore evidence and observed recovery point. Until then show
**voicemail independent backup pending**, even if phone backups are healthy.

The original scope above is retained for review. The local implementation and
current remaining gates are recorded below. No production reads or AWS writes
have been performed by this extension.

## Local implementation and exact first-transfer boundaries

The local adapter and core now implement the proposed bucket identity, reference,
checksum and restoration guards. Nine voicemail tests cover unchanged legacy
identity serialization, two-bucket separation, retained orphans, explicit missing
objects, published-path mismatch, prepared intake, source checksum substitution,
private storage and independent byte-exact restore for both buckets. The existing
phone source/core, AWS transport and restore tests also passed (47 total tests
across those suites, including the nine new cases). No actual source or AWS
request was used in this testing.

The prepared read-only command is:

```sh
node scripts/backup/inventory-drummonds-voicemails.mjs --drummonds-voicemail-metadata-only
```

It checks the existing production project and credential fingerprint in memory,
inventories only the two named buckets beneath the Drummonds tenant prefix, and
retains metadata under private `.verification-results/voicemail-inventory-*`
directories. It caps each bucket at 5,000 metadata requests (10,000 total) and
a 20-minute overall deadline. Its transport rejects object downloads and all
non-metadata requests. Any failed bound or changed inventory fails the run rather
than claiming completeness. Only aggregate counts, bytes and hashes reach stdout.
At the adapter preparation checkpoint this command had not yet run. The later
production inventory result is recorded below.

The first-transfer executor must pin both resulting inventory files and their
SHA-256 values, the source adapter hashes, this exact project/tenant and the
existing AWS destination identity. Scope is exactly those two inventories, with
a hard review ceiling of **1,000 objects and 1 GiB combined**, additionally
bounded to **100 objects and 256 MiB per invocation**. Actual transfer count and
bytes must equal the smaller observed inventories; these ceilings do not
authorise copying undiscovered files. Pause and re-review if inventory exceeds
these caps, either bucket is missing or public, any published reference is
missing, any prepared state is unresolved, or source metadata changes. No
deletions, overwrites, auto-expiry, IAM changes, new keys or schedule changes.

After read-only inventory supplies exact counts/hashes, prepare the guarded
copy/finalize runner and independent Restore-role selection before executing
anything. Reconcile every entry and full retained manifest; restore both a raw
original and its matching audio, compare source hashes against an isolated
database, and decode/play only audio. The existing audio-only restore CLI should
not be used blindly on `.eml` content: the generic core restore already preserves
`sourceBucket` and byte hashes, so the operational wrapper must select validation
by bucket. Private local restored artifacts must be removed after verification
or retained explicitly as protected evidence.

A fresh provider arrival during inventory may change the non-atomic observation.
Stop/re-inventory with new exact fingerprints; do not broaden an already-reviewed
transfer by quietly substituting new data. Independent voicemail recovery remains
**pending real copy, full reconciliation and restore**, and daily voicemail
coverage remains unconfigured.

## Read-only production inventory completed — 13 October, 13:34 UTC

The authorised metadata-only inventory has now completed. It found exactly
**255 audio files (13,800,699 bytes)** and **255 original signed email files
(23,622,647 bytes)**: **510 objects, 37,423,346 bytes combined**, approximately
35.7 MiB. Both independently stable inventories match the same 255 intake IDs,
with no missing files, unreferenced objects, null pointers or prepared audio
intakes. The observation ran from 13:32:46 to 13:34:40 UTC and used 1,582 bounded
source metadata requests plus three management reads. No source content was
downloaded, no source records changed, and no AWS request occurred.

The exact first-transfer proposal is retained privately at
`.verification-results/voicemail-backup-first-transfer-plan-20261013.json`, SHA-256
`002a089d745a6d76982586da80faaf87479e6d1d97a26e97e29693ffee927ae3`.
It pins both inventory/reconciliation files and the source implementation, the
existing approved destination, exactly 510 objects and 37,423,346 source bytes,
and bounded 100-object/256-MiB invocations. The subsequently prepared transfer/finalisation wrapper is recorded below and
still needs root review before any AWS copy. The independent copy and restore remain pending.

Each inventory used matching recursive listings and reference passes. No changes
were observed during either pass. Ongoing capture is not stopped: arrivals after
these observations belong to a new inventory, while selected entries must retain
the exact pinned revision, checksum and references before and after copying.
A changed selected source fails verification; never quietly replace a reviewed
manifest or claim it covers later arrivals.

Sanitised result:
`docs/operations/evidence/learn-voicemail-backup-inventory-2026-10-13.json`.
The additional batch/runner/daily regression suites passed 14 tests, giving
61 passing tests across the reviewed adapter and orchestration checks.

## Guarded execution prepared; no copy performed

`scripts/backup/voicemail-backup-execution.mjs` now validates the exact plan, source
hashes, both private inventories/reconciliations, destination and paired intake
coverage before credentials are loaded. It reuses the existing bounded disk
checkpoint runner for copy/finalisation, adds a global operation lock and durable
private journal, and inspects source/destination protection on each invocation.
Three offline orchestration tests passed: bounded copy/finalisation and
independent paired restore; incomplete-copy/changed-source/invalid-selection
rejection; and failed audio decode cleanup without a false success report.
The exact production plan loaded successfully offline with zero network requests.

The private entry point is
`.verification-results/run-voicemail-backup-first-20261013.mjs`, controlled by
`.verification-results/voicemail-backup-first-execution-20261013.json`. It requires
that manifest's exact reviewed SHA through
`SERVICEOS_APPROVED_VOICEMAIL_BACKUP_EXECUTION`. Commands are `copy raw`,
`copy audio`, `finalize raw`, `finalize audio`, and `restore-pair`. Each copy
invocation processes at most 100 selected files (three invocations per bucket for
this inventory), followed by one explicit whole-inventory finalisation per
bucket. Lost replies are reconciled through immutable receipts and disk
checkpoints, never treated as complete coverage. The paired restore is pinned
to two matching selected objects and refuses an existing successful restore
journal without review.

Copy/finalise load only the existing scoped Writer key. Paired restore loads only
the separate Restore key and makes no Supabase request. It verifies complete
manifest identities, exact chosen raw/audio hashes and bytes, decodes audio only,
and removes both temporary private files on success or failure. It preserves a
metadata-only receipt and explicitly leaves human listening and isolated-database
comparison unverified. Daily voicemail scheduling is unchanged. No actual AWS
copy, source download or restore has run at this preparation checkpoint.

Sanitised execution preparation:
`docs/operations/evidence/learn-voicemail-backup-execution-preparation-2026-10-13.json`.

### Independent database relationship comparison — 13 October, after file restore

The existing independently downloaded database snapshot was restored again into a fresh, network-disabled container, with no ports/mounts, cron execution disabled and no worker slots. The archive SHA-256 remained `009c3236c3f73fe686c4a0f99e988c7c47776c0fa7b11c619d1fc6bf672f057e` (201,420,792 bytes). No migrations or seed rows were applied; the disposable container was removed.

That snapshot was observed at **13 October 00:16:29 UTC**, before the voicemail import. It has no voicemail intake/source tables, and the selected pair's message and both storage-object rows are also absent. Therefore this is **not a completed independent database relationship recovery**. A post-import database snapshot, independently downloaded and restored, is still required to verify the intake → source → message → private storage relationships. Restoring synthetic rows or today's local execution journals into the old snapshot would not establish that proof.

The completed Restore-only paired-file receipt matches the exact pinned inventory selection: both original-email and audio hashes/sizes agree; audio decodes to **25.344 seconds**; no production source was accessed during file restore, and restored private files were removed. Decoding does not establish human listening or application recovery.

Local-only comparison evidence: `.verification-results/voicemail-independent-database-comparison-v2-20261013/report.json`. The earlier attempt failed before Docker creation because system Python 3.9 lacks `hashlib.file_digest`; its receipt is retained separately. The corrected runner uses bounded streaming hashing. Four synthetic tests cover every relationship field, missing snapshot rows, mismatched tenant/intake pairing, and changed restore hashes/size/identity/source-access/decode claims.

### Fresh independent relationship recovery verified — 13 October, 16:39 BST

The post-import snapshot from **14:27:12 UTC** was encrypted, copied to the
approved London database bucket, downloaded using the separate Restore identity
and restored without production access. Recovery verified 1,726,602 native rows,
2,652 operational rows, 18 Vault secrets and 2,977 recording relationships.
The encrypted object contains 294,441,336 bytes; the underlying database archive
is 291,316,647 bytes, SHA-256
`185354036d21576770808d831fe971f4bb43d149bbd6148e58dadde6b4e14c3a`.

The actual restored snapshot then passed all five selected voicemail links:
intake, retained email source, voicemail message, raw storage and audio storage.
Both independently restored files match the selected pair and the audio decodes
to 25.344 seconds. No migrations or synthetic rows were added; both disposable
containers were removed. This supersedes the earlier missing-relationship result
for the old snapshot. Human listening and full application recovery remain open.
Later arrivals are outside the fixed snapshot and file inventories; recurring
voicemail/database backup and scheduled-run acceptance remain unfinished.

Sanitised evidence: [independent recovery](evidence/learn-independent-recovery-2026-10-13.json).
Private final receipt: `.verification-results/database-backup-3c0b2419-f200-4425-bba2-ad947953f14e/verified-7f51d0ae-0264-4bef-bcab-4420574cf107.json`.
Private relationship comparison: `.verification-results/voicemail-independent-postimport-comparison-20261013/report.json`.
