# LEARN data recovery coverage

## Approved scope and account ownership — 11 October 2026

Chris approved the backup setup and initial recording copy, then clarified that
there is no existing AWS account and the account should belong to **OpenFolk**.
This supersedes the Drummonds-owned account assumption in the original proposal
below. The approval covers the described private encrypted recording backup,
daily copies, 30-day governance protection, monthly restore checks and cost basis;
it does not approve unrelated production changes. Chris/OpenFolk controls billing,
MFA and recovery access. Keep Drummonds data isolated in its own backup bucket and
scoped runtime permissions; never mix future clients into this recording inventory.

**Recommended implementation remains AWS S3 in London (`eu-west-2`), under an
OpenFolk-owned AWS account.** Chris also has an existing Cloudflare account for
OpenFolk, so its R2 alternative was checked against current official documentation:

- R2 offers an EU jurisdiction, but no listed UK/London jurisdiction; a Western
  Europe location hint is explicitly best effort, not a residency guarantee.
  [Data location](https://developers.cloudflare.com/r2/reference/data-location/).
- R2 bucket locks can prevent overwrite/deletion for a period, but administrators
  can remove the rules. S3 versioning and S3 Object Lock configuration APIs are
  not supported by R2; substituting it would require a different version-retention
  design and an explicit location decision, not simply changing the S3 endpoint.
  [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/) and
  [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
- Its Standard free allowance is 10 GB-month, 1 million write-class operations
  and 10 million read-class operations per month. This inventory could fit within
  unused allowance, but existing account usage, execution and source egress still
  need to be counted. Price alone does not close the recovery requirements.
  [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

No additional approval of the same AWS recording-copy scope is needed. Chris has now completed OpenFolk AWS account signup. The account name and ID
were verified in Arc and the console was switched from Stockholm to London.
The security-credentials page now confirms **MFA (1)** and no root access keys. The
console reports a **Free plan ending 11 April 2027 or when credits run out**.
Chris completed owner MFA and signed in through the in-app browser. Chris will move to the paid plan later; the Free
plan is not an immediate setup blocker unless an actual service restriction is
encountered. The transition must happen before free access ends for dependable
ongoing backups. The agent did not change owner authentication or billing.

The approved London foundation was created on 11 October at **07:55:12 UTC**.
CloudFormation deployment validations passed and all five resources reached
`CREATE_COMPLETE`. Direct S3 console readback confirms London, all four public
access blocks, bucket-owner-enforced ownership, SSE-S3 encryption, versioning,
and enabled 30-day GOVERNANCE default retention. The bucket policy enforces TLS,
explicit AES256 encryption and conditional create-only writes. No lifecycle
expiration rule exists. Both writer and restore policies have **zero attachments**;
no runner identity, credential or new access grant was created.

The monthly account-wide US$5 actual-cost alert exists. Its recipient
`chris@openfolk.ai` is **pending email verification**; AWS says notifications cannot
be delivered until that verification completes. It is not a spending cap.
The previous browser file chooser failure was resolved using Template studio;
the saved editor JSON matched the prepared template before execution. AWS also
created a template-storage bucket/object. No recordings or secrets were uploaded
with the template. The recording bucket remains empty. Scoped runtime access,
real copying, schedules and isolated restore remain unfinished.
[Cloud evidence](evidence/learn-recording-backup-foundation-aws-2026-10-11.json).
Account/resource identifiers and screenshots are retained in ignored private
runtime evidence. Cloudflare infrastructure and OpenFolk hosting are unchanged.

## Local backup implementation — 11 October 2026

The [backup foundation](../../infrastructure/recording-backup/README.md) now includes
an account/region-bound CloudFormation template and a streamed copy/restore core.
The template defines the private London bucket, versioning, 30-day governance
retention, create-only writes, separate **unattached** writer/restore policies and
an AWS account-wide US$5 alert (not a cap, excluding Supabase costs). CloudFormation
schema lint passes. The foundation is now deployed as described above; no policy
attachment or new cloud access was created.

Eleven synthetic tests pass for streamed SHA-256 copy, exact-version readback,
private isolated restore, changed-source/corrupt-byte rejection, lost upload and
journal acknowledgement recovery, and whole-inventory completion. Manifest
recovery retains its original scope/time; it does not claim current source coverage.
The official AWS SDK destination and encrypted S3 journal are now implemented;
eight additional synthetic HTTP tests exercise real SDK signing, serialization
and response parsing across copy, receipt, manifest and isolated restore (19
combined tests pass). The scoped Supabase source adapter now recursively inventories the tenant
root (including unreferenced folders), compares two complete listings and recording
reference passes, and checks object revision, ETag, size and links around reads.
The full source → AWS SDK → manifest → isolated restore path passes synthetic
tests (28 combined). One real Drummonds object passed a bounded metadata-only
probe against database and Storage API, with no audio download.
The complete real metadata inventory subsequently verified all 2,888 objects and
all 2,882 recording-row file links, with six unlinked objects retained. Private
inventory/reconciliation files and bounded copy checkpoints are implemented;
The durable local command now saves atomic disk checkpoints and attempt status,
resumes from verified receipts, loads only the proposed Writer Keychain credential
and pins its exact AWS principal. Thirty-nine local tests pass; the command has
not been activated. [Runner evidence](evidence/learn-recording-runner-local-2026-10-11.json).
AWS transfer acceptance, daily scheduling, operator monitoring,
real copies, playback and database restore remain unfinished.
[Inventory and batch evidence](evidence/learn-recording-inventory-and-batch-2026-10-11.json).
[Source evidence](evidence/learn-recording-backup-source-local-2026-10-11.json). [SDK evidence](evidence/learn-recording-backup-s3-local-2026-10-11.json). Initial source reads can reuse existing authorised credentials in memory inside
the trusted local/ServiceOS environment; they must never be exported to AWS. Any
new source access or production runtime deployment remains behind its applicable
approval boundary.
[Local evidence](evidence/learn-recording-backup-local-2026-10-11.json).

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
At this earlier proposal stage no AWS resources existed. See the current
foundation deployment above; scheduling and recording copies remain outstanding.

## Original costed implementation proposal — now approved with OpenFolk ownership

Use one private S3 Standard bucket in a **Drummonds-owned AWS account**, London,
with SSE-S3 encryption, blocked public access, versioning and a 30-day default
Object Lock **governance** period on new versions. Chris/Drummonds retains billing,
MFA-protected account recovery and the recovery-administrator role. OpenFolk
operates the scheduled backup and reports failures; it is not the sole recovery
owner. AWS documents that Object Lock cannot later be disabled on that bucket.
Governance bypass is reserved for the recovery administrator, never the backup
worker. No automatic object deletion or source-deletion mirroring is proposed;
agree the long-term business retention policy before adding expiry rules. The
30-day lock is deletion protection for each newly written version, not a promise
that old unchanged versions remain continuously locked.

### Cost basis, checked 11 October 2026

The AWS public **London** price lists give first-tier Standard storage at
US$0.024/GiB-month, PUT/LIST at US$0.0053 per 1,000 and GET/HEAD at US$0.0042 per
10,000. The measured 0.560 GiB therefore costs about **US$0.0134/month** to store.
One initial PUT plus verification GET for each of 2,888 objects costs about
**US$0.0165**, excluding execution and transfers.

The following is a planning month with headroom, not measured usage:

| Component | Assumption | Estimated USD/month |
|---|---|---:|
| S3 storage | 2 GiB including versions/manifests | 0.048 |
| S3 writes/lists | 10,000 requests | 0.053 |
| S3 reads/checks | 100,000 requests | 0.042 |
| Lambda runner | 10,000 GiB-seconds, 100 invocations | 0.167 |
| Secrets Manager | One scoped source-access credential, 100 reads | 0.401 |
| Supabase outbound transfer | 2 GB, assuming quota already exhausted | 0.180 |
| Scheduling, monitoring and restore-transfer contingency | Planning allowance, not a quoted tariff | 1.000 |
| **Planning total** | Before tax, without free-tier credits | **1.89** |

Propose a **US$5 monthly budget alert** for this recording-backup subsystem.
This is not a hard spending cap or guaranteed bill. Keep retained backups if the
alert fires; investigate growth/retries and obtain approval before an architectural
expansion. Excluded: the existing Supabase plan, development/support effort, any
new database restore environment and optional customer-managed KMS keys. Runtime
duration is unmeasured; update the estimate after the first successful backup.

[Reproducible estimate and price-list versions](evidence/learn-recording-backup-estimate-2026-10-11.json).
Run `node scripts/verify/learn-recording-backup-estimate.mjs` for the saved-rate
calculation, or add `--refresh-public-prices` to read current public price lists.
Sources: [S3 pricing and binary units](https://aws.amazon.com/s3/pricing/),
[London S3 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-west-2/index.json),
[Lambda](https://aws.amazon.com/lambda/pricing/),
[Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/),
[Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
[Object Lock considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

### Operation and recovery contract

1. First capture a private manifest of all Drummonds recording objects, including
   the six-object difference from the recording-row count; reconcile it rather
   than dropping unreferenced files. Bind entries to tenant, source path/version,
   metadata size and recording references. Do not store these details in GitHub.
2. Copy the initial set, then new/changed objects daily using an independent
   resumable runner. Proposed target: a completed backup no more than 24 hours
   behind successfully retained source data; a missed/failed daily run alerts
   OpenFolk. This recovery-point target must be proven, not inferred from a timer.
3. Keep AWS write access confined to this backup bucket/prefix, with no delete,
   retention-bypass, policy-change or account-administration permissions. Use a
   separate restore identity. Source access must be restricted to Drummonds'
   approved recording inventory and reads. Do not copy a production-wide Supabase
   service-role credential into the backup account. Prepare and review the scoped
   source-read mechanism before enabling the runner; any production code/permission
   change remains subject to the separate production release approval.
4. Stream bytes over TLS, compute a SHA-256 digest, record the destination version
   and verify a downloaded destination copy against that digest. Recheck source
   metadata after the read; quarantine changed/failed objects and report partial
   coverage. Never advance a completed manifest past an unverified object.
5. Publish only aggregate progress, oldest outstanding item age, last verified
   backup and last restore-test time to OpenFolk. Exclude source paths, signed URLs,
   credentials, audio and customer identities from operational logs.
6. Perform the first isolated restore before calling backup coverage verified,
   then repeat monthly. Restore recorded versions to an isolated private target,
   check all manifest digests and database references and play representative
   recordings. Keep existing failed/short audio marked as failures. Disable all
   capture, email delivery and external-provider actions in the recovery target.
7. Propose a four-hour recording-recovery target after authorised recovery starts,
   subject to the rehearsal. It is not a whole-application recovery guarantee.
   Retain the database recovery-point reference alongside the manifest; resolve
   timing differences explicitly. A file copy is not an atomic database snapshot.

**Approval received:** the setup and recording copy are approved, with an
OpenFolk-owned account replacing the original Drummonds-owned assumption.
The OpenFolk account and private London foundation now exist (see current evidence
above). Scoped runtime access, credentials, schedules and recording copies remain
unconfigured. Database restore pricing and acceptance remain a
separate launch requirement. Approval of this proposal does not approve unrelated
production changes.

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
