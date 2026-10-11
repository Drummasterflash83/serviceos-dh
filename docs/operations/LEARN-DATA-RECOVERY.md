# LEARN data recovery coverage

## Verified observation — 11 October 2026

The read-only Supabase Management API observation completed at 02:25:54 UTC.
Each project identity was checked before its fixed GET backup-list request.
The existing CLI login stayed in process memory. No credentials, backup download
URLs, customer payloads or backup IDs appear in the public evidence.

| Environment | Observed database backup metadata | Restore evidence |
|---|---|---|
| Production `tgbnakbxwcqjeimygroz` | Eight physical backups marked `COMPLETED`; inserted dates 4–11 October, newest 11 October 00:32:06.770 UTC. WAL-G enabled, PITR disabled. | No isolated restore performed or verified in this build. |
| TEST `saatxzwxvdvqevbnskxy` | Empty backup list; WAL-G enabled, PITR disabled. | No recoverable database backup established by this response. |

Both responses provided no usable physical recovery-window timestamps. Listed
backup insertion times are provider metadata, not a claimed transaction cutoff,
guaranteed recovery point or ongoing retention policy. Eight observed entries do
not establish that eight days will always be retained. An empty TEST list is not
proof that every possible external backup is absent.

[Sanitized observation](evidence/learn-backup-metadata-2026-10-11.json).
The separate [source inventory](LEARN-SOURCE-PRESERVATION.md) verifies retained
IDs/pointers and storage metadata against a prior baseline. Neither observation
is itself a backup.

## What each layer covers

- GitHub TEST checkpoints retain source code, migration/release packages and
  sanitized evidence. They exclude customer data, runtime credentials and private
  manifests. Pushed code cannot reconstruct the retained Drummonds TEST import.
- Supabase database backups cover database state. Their documented scope excludes
  Storage object bytes, so the audio files need independent backup coverage.
- The current recording inventory confirms 2,882 recording references match
  stored objects. It neither copies those bytes nor proves playable audio.
- Provider retrieval is a possible recovery route only after its access,
  retention, identifiers and returned content have been verified. Do not treat
  the Birchill origin as an unlimited or already-tested backup.

See Supabase's official [database backup scope](https://supabase.com/docs/guides/platform/backups)
and [read-only backup-list endpoint](https://supabase.com/docs/reference/api/v1-list-all-backups).
These were checked on 11 October. No restore, plan change, backup configuration
change or audio download was performed during this observation.

## Proposed independent recording backup — not configured

The 11 October 06:07 UTC read-only production metadata audit measured 2,888
Drummonds recording objects totalling 601,004,261 bytes (about 601 MB / 0.560 GiB).
Every inventoried object has a known metadata size. The 1,516 objects created in
the previous 30 days total 312,897,776 bytes; this can include backfill and is not
a forecast. No file bytes were downloaded or checksummed. The next proposal step
is a current region-specific total-cost estimate and agreed retention/recovery
targets. [Aggregate evidence](evidence/learn-launch-baseline-2026-10-11.json).

On 11 October Chris confirmed that no separate recorded-call backup destination
exists and asked for a recommendation. Proposed destination: a Drummonds-owned AWS
account with a private S3 Standard bucket in Europe (London), `eu-west-2`, separate
from production application administration. This is a proposal, not authorization
to provision paid infrastructure or copy recordings.

- Block public access, require encrypted transport, use server-side encryption,
  MFA for account owners and narrowly scoped backup/restore identities. Keep
  account recovery under Drummonds' control; production runtime credentials must
  not be able to delete backup versions or bypass retention.
- Enable versioning and propose 30-day Object Lock governance protection for new
  backup versions. Confirm this recovery window separately from the business
  retention policy before applying it. Governance bypass belongs only to a
  separate recovery administrator; do not use irreversible compliance-mode
  retention without an established requirement.
- Copy existing recordings once, then new/changed objects daily, without mirroring
  source deletions. Keep encrypted private manifests with object versions, sizes,
  digests and database references. Record source changes during each run rather
  than claiming an atomic database/file snapshot.
- Verify copied bytes, rehearse an isolated restore and representative playback,
  then repeat restore checks monthly. Report last successful backup, coverage,
  failures and last restore test in OpenFolk with actionable operator diagnostics.
- Size the initial inventory and daily growth before quoting costs. Include old
  versions, S3 requests, source egress, backup execution and restore traffic as
  well as storage. Initial metadata volume is measured above; monthly budget and
  reliable ongoing growth are not established yet.

Official sources checked on 11 October: [London S3 region](https://docs.aws.amazon.com/general/latest/gr/s3.html),
[encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html),
[Object Lock modes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)
and [pricing components](https://aws.amazon.com/s3/pricing/).
No AWS resource, backup schedule or recording copy has been created.

## Remaining recovery work

1. Identify the existing approved encrypted backup destination and its recovery
   owner. Confirm which environments/data it covers, retention and acceptable
   data-loss/recovery-time targets. If none exists, prepare a concrete proposal
   with volume, storage cost, encryption-key custody and access before copying
   production recordings. No destination or retention target is assumed here.
2. Inventory recording bytes and capture a versioned manifest of object paths,
   sizes and cryptographic digests in private storage. Preserve older versions
   and record failures; do not mirror source deletions into the recovery copy.
   Relate the object manifest to a database recovery point. A live copy is not
   automatically consistent with a database backup taken earlier.
3. Establish database recovery coverage for retained TEST imports as well as
   production. Re-running migrations recovers schema, not imported records,
   mapping decisions, approvals, history or queued-work checkpoints.
4. Rehearse recovery into an isolated destination. Before loading data, prevent
   schedulers/workers, email delivery and provider calls from running, and ensure
   production credentials cannot be exercised. Do not restore over the current
   production or retained TEST project as a rehearsal.
5. Compare restored source IDs, relationship integrity, transcript states and
   recording pointers with the chosen private baseline. Match each restored
   object to its expected byte digest and test representative audio playback.
   Include failed/short recordings as retained failures, not fabricated repairs.
6. Verify authentication/tenant isolation, source history, runtime configuration
   and controlled credential recovery separately. Do not presume a restored
   database also restores deployed functions, file bytes, external OAuth grants
   or usable Vault credentials. Prove key availability without exposing secrets.
7. Record restore duration, the actual recovery point, missing/unverified data and
   the steps needed to resume capture. Resume workers only after an explicit
   environment check and acceptance; retain the recovery evidence privately.

These steps are acceptance requirements, not completed work. Launch reporting
must distinguish **records preserved**, **database backups listed**, **recording
backup verified**, and **restore verified**. The last two remain unverified.
