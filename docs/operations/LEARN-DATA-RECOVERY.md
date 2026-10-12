# LEARN data recovery coverage

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

**12 October — complete archive recording metadata recovered.** The retained
06:37 UTC snapshot restored into an offline container; all 1,594,994 native rows,
711 operational rows, catalog/RLS and extensions matched. Its 2,883 recording
references were extracted to private local evidence, the six original files
stayed unchanged, and the container was removed after 66.73 seconds. This run did
not repeat Vault decryption or contact production/AWS.

The fresh daily file scan observed 2,893 files and 2,887 references with no missing
pointers; its destination verification is still running. An explicit archived
coverage comparison now supports a later manifest while reporting additional
references as absent from the database snapshot. Strict exact-reference checks
remain unchanged for existing callers. All 85 backup tests pass. The prepared
`node scripts/backup/check-complete-database-audio.mjs --check-complete-archive`
command waits for a successful daily result, uses only the separate Restore
identity, checks the downloaded manifest, restores one bounded linked file and
removes temporary audio after decoding. Its actual fresh AWS/audio result remains
unverified. [Local archive evidence](evidence/learn-complete-archive-recording-links-2026-10-12.json).

The remaining independent database destination, key escrow, access, cost and
restore sequence are specified in the
[database backup proposal](../../infrastructure/database-backup/README.md).
Its infrastructure is validated locally; activation, package/transfer verification
and dependable recurrence remain incomplete. No new destination has received data.

## Complete native capture, restore and Vault check — 12 October, latest state

The 06:37:26 UTC snapshot completed export at 06:44:21 UTC: 197,303,039 bytes,
SHA-256 `bdb6be1f2cb934247949d6443305550888e6b4e62f5c55dac419a432616bd3db`.
Both operational pg_net tables were captured using native COPY in the same
read-only snapshot. The prior archives and diagnostic partial file remain intact.
No production source writes, external upload or schedule changes occurred.

A fresh offline restore matched all 1,594,994 archived rows across 299 data tables
and five sequence values, plus 711 rows in the two supplemental operational tables
and their separately observed nontransactional sequence. Every inventoried physical
table is covered; table ownership/RLS flags and extension versions match. All
2,883 recording references resolve to restored Storage metadata. Readers without
actor context see zero emails/recordings. The container was removed after 67.18
seconds; this is a measured database rehearsal, not a full-service recovery time.

All **16 archived Vault secrets** also decrypted in a second disposable offline
restore and matched live keyed aggregate comparisons. Encrypted rows matched too.
The key came from Supabase's [documented read-only key endpoint](https://supabase.com/docs/reference/api/v1-get-pgsodium-config)
and travelled through stdin into the private container file. It was not put in
host files, command arguments, Docker environment metadata or reports; no decrypted
values were persisted. The container was removed. A synthetic rehearsal separately
proves correct-key recovery, wrong-key rejection and absent key material in Docker
metadata. Initial source comparison attempts encountered the restricted query
role's Vault denial; the existing administrator then performed the comparison
inside an explicit READ ONLY transaction. No permission or credential was changed.

Production stayed healthy throughout capture. Post-export checks confirm the
short-lived CLI credential expired, no CLI sessions/export containers remain and
role membership is unchanged. The earlier three-minute diagnostic captured
50,032,640 bytes before its limit; it was never accepted as a complete backup.
The successful run used a 30-minute maximum and three-minute no-progress cutoff.

Still open: independently stored database backups and root-key escrow; actual
Auth/application/runtime recovery; controlled capture resumption; recording-byte
coverage for newly arriving files and voicemail; dependable daily operation.
This does not repeat a live aggregate row scan: fidelity is archive-to-restored
rows, with source inventory coverage verified. Storage metadata is not file bytes.
[Sanitised acceptance evidence](evidence/learn-complete-database-recovery-2026-10-12.json).

## Latest capture attempt — 12 October 2026, 01:21 UTC

The separate complete-capture-v2 attempt is stopped, not running or accepted.
Its 01:10:44 read-only snapshot captured 2,434 `net._http_response` rows and zero
`net.http_request_queue` rows in a private 2,674,825-byte native COPY supplement.
The native dump emitted zero bytes. Management SQL returned HTTP 544 while the
dump was pending; the agent stopped its dump container and the runner removed
both clients. Auth health was observed unhealthy afterward. The cause is not
established; temporal overlap does not establish a specific resource failure.

At 01:19:16 SQL health passed, existing CLI membership remained unchanged, the
temporary password was expired, and zero CLI sessions/local export containers
remained. At 01:21:22 Auth was healthy. No restart, credential reset, new grants,
production data writes or external upload occurred. Error logs remain private.
The original archive's size and SHA-256 were rechecked and are unchanged.

Do not merge the later supplemental rows with the older archive and claim one
consistent snapshot. The revised path is synthetically verified, including exact
restoration and tamper detection for both operational tables, but no complete
real second capture or restore exists. Diagnose connection/service-health
degradation before preparing any new run; retain the stopped journal and files.
[Sanitized evidence](evidence/learn-complete-capture-attempt-2026-10-12.json).

## Latest database recovery state — 12 October 2026, 01:05 UTC

The existing native archive was restored again into a fresh offline database.
Streaming PostgreSQL COPY comparison matched **all 1,591,576 archived rows across
299 tables and five sequence values**. Row contents, duplicates, table identity
and column order are compared; physical row order is ignored. Source rows remain
opaque in memory and only private hash/count metadata is retained. The archive's
SHA-256, all 302 table definitions' ownership/RLS flags and extension versions
also passed. Unauthenticated-context readers returned zero retained inputs and
all 2,882 recording paths resolved. The disposable database was removed.

Five parser tests and a separate actual synthetic archive/restore verify the
comparison, including rejection of a deliberately altered row. This run made no
production requests or external uploads. It took 65.89 seconds, which is an
offline verification time, not a full-service recovery-time commitment.

**Scope:** archive-to-restored-row fidelity is verified. The original source
fingerprint pass remains incomplete; the archive omits two operational pg_net
tables. This does not prove complete source capture, Vault decryption, application/
Auth restart, controlled capture resumption or durable independent database backup
operation. The earlier independent-audio sample proved all manifest relationships
and one fully decoded recording at separate snapshot times.
[Comparison evidence](evidence/learn-native-archive-comparison-2026-10-12.json).

## Latest recording recurrence state — 11 October 2026, 11:53 UTC

The revised daily runner completed a fresh observed inventory: all **2,888 files /
601,004,261 bytes**, 2,882 recording references, no missing pointers, and six
unlinked objects retained. All exact AWS versions and both source comparisons
passed. No audio was recopied; 20,288 source requests were used. The immutable
manifest covers the non-atomic inventory observed at 11:38:55 UTC.

The **09:00 local daily follow-up is ACTIVE**, includes the monthly restore-due
check and was read back after activation. Manual execution is verified; no
scheduled execution has yet occurred. This arrangement needs the Mac and Codex
running. Dependable host operation, operator-facing monitoring, isolated database
restore and combined database/audio relationship recovery are still open.
The separate real 81-second restore/check passed at 11:42 UTC with automatic
audio removal; the next monthly check is due by 11 November.

[Daily verification and schedule evidence](evidence/learn-recording-daily-verified-2026-10-11.json)
and [operating procedure](LEARN-RECORDING-DAILY.md). Earlier milestones below retain
their historical scope; this section records the latest recurrence state.

## Email source history — TEST release 071, 11 October, 20:50 UTC

`public.learn_email_source_versions` retains the complete previous email row
before source changes. It is private communication content: include it with the
database backup and isolated restore, never with public evidence or in GitHub.
This table is separate from recording audio and is not protected by the S3 audio
copy. The TEST release inventory now covers 124 datasets, including this archive;
installation preserved all 123 pre-existing datasets and hosted HTTP acceptance
preserved all 124. Production does not yet have this migration.

Database recovery acceptance must restore source versions alongside tenants,
email accounts, messages and their relationships, then compare source IDs, counts
and content fingerprints within the isolated environment. Confirm archive RLS,
ACLs and the source-update trigger survive restoration. Do not expose restored
message bodies in verification output. Preserve the archive on application
rollback; never remove retained source versions to downgrade the worker.

This is a recovery requirement and verified preservation inventory, **not an
actual database restore claim**. The real database restore remains open pending
secure recovery credentials. The hosted synthetic check proves two retained
versions through draft, unavailable and sent states only.
[Source-history evidence](evidence/learn-email-mailbox-changes-2026-10-11.json).

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
expiration rule exists. The foundation originally left both policies unattached;
the separately approved access setup below now binds them to dedicated identities.

The monthly account-wide US$5 actual-cost alert exists. Its recipient
`chris@openfolk.ai` is **pending email verification**; AWS says notifications cannot
be delivered until that verification completes. It is not a spending cap.
The previous browser file chooser failure was resolved using Template studio;
the saved editor JSON matched the prepared template before execution. AWS also
created a template-storage bucket/object. No recordings or secrets were uploaded
with the template. The separate access activation and first recording copy are
now verified as described below. Full-manifest audio restore subsequently passed;
scheduled operation and isolated database recovery remain unfinished.
[Cloud evidence](evidence/learn-recording-backup-foundation-aws-2026-10-11.json).
Account/resource identifiers and screenshots are retained in ignored private
runtime evidence. Cloudflare infrastructure and OpenFolk hosting are unchanged.

## Scoped access and first real transfer — 11 October 2026

Chris explicitly approved the prepared Writer/Restore identities and one key each.
The access stack completed at **08:35:18 UTC**. Each identity has its exact scoped
policy as both direct policy and permissions boundary, no console access and one
active key. Keys are stored in separate Mac login Keychain entries; private
transfer files were removed after exact readback. Rotate by **9 January 2027**.

Both keys passed live STS identity/account checks and S3 protection inspection:
London, private bucket, TLS, AES256, versioning, 30-day GOVERNANCE retention and
conditional writes. The first bounded recording copy verified **108,870 bytes**
against the source and pinned destination version. The complete **2,888-object /
601,004,261-byte** inventory has completed its bounded copy pass. The sequential
finalizer hit its 30-minute deadline at 10:29:51 UTC. Its failure evidence and
completed copy checkpoint are retained; that attempt did not confirm a full manifest.
The revised finalizer, covered by 44 passing backup tests, checks at most four
objects concurrently, then rechecks source metadata before writing its immutable
manifest. Any failure drains active checks and prevents manifest publication.
The revised finalizer completed at **10:39:30 UTC**: all 2,888 pinned S3 versions
and 601,004,261 bytes passed exact byte hashing and both source comparisons. The
immutable full-inventory manifest was saved; no audio upload was repeated. A
Restore-only rehearsal then selected the original recording through that manifest,
recovered 108,870 bytes, retained its one recording reference and decoded 66.96
seconds in 1.135 seconds. Temporary audio was removed. This test made no
Supabase/provider calls and did not perform human listening or database recovery.
[Full inventory and restore evidence](evidence/learn-recording-inventory-restore-2026-10-11.json).
This proves the explicitly observed inventory; files arriving later need subsequent
runs. Recurrence, monitoring and database restore are still required for completion. No source records,
files or permissions were modified. At **08:46:46 UTC**, an independent receipt-only
rehearsal using the Restore key recovered the first exact S3 version, verified
all 108,870 bytes and decoded **66.96 seconds** of real audio. It retained one
recording reference, made no source-provider calls and removed temporary audio.
Human listening and database relationship recovery were not performed. Full
inventory revalidation and manifest-based restore subsequently passed as described
above; daily scheduling, operator monitoring and isolated database recovery remain required.
[First restore evidence](evidence/learn-recording-initial-restore-live-2026-10-11.json).
[Live access evidence](evidence/learn-recording-access-live-2026-10-11.json).

The monthly check mode subsequently passed at **11:42:41 UTC**: a median-size
referenced recording from that verified manifest restored 131,685 bytes and
decoded 81 seconds. Its temporary audio was automatically removed and separately
confirmed absent; private evidence retained the original record reference. This
used only the existing Restore identity and made no Supabase requests or AWS
writes. All 56 local backup checks pass. The next monthly check is due by
11 November; the daily follow-up now includes this due check, with scheduled
execution still unverified. See the
[monthly procedure](LEARN-RECORDING-DAILY.md#monthly-restore-check) and
[sanitized evidence](evidence/learn-recording-monthly-check-2026-10-11.json).

## Local backup implementation — 11 October 2026

The [backup foundation](../../infrastructure/recording-backup/README.md) now includes
an account/region-bound CloudFormation template and a streamed copy/restore core.
The template defines the private London bucket, versioning, 30-day governance
retention, create-only writes, separate **unattached** writer/restore policies and
an AWS account-wide US$5 alert (not a cap, excluding Supabase costs). CloudFormation
schema lint passes. The separate approved access stack now binds the policies
and keys as described above.

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
resumes from verified receipts, loads only the approved Writer Keychain credential
and pins its exact AWS principal. Thirty-nine local tests passed before the
first live copy. [Runner evidence](evidence/learn-recording-runner-local-2026-10-11.json).
A separate Restore-only command now recovers an exact S3 version without accessing
Supabase, retains record-link evidence privately and checks local audio decoding.
The suite passes 43 tests, including a real macOS decode of synthetic WAV audio.
The complete observed inventory and one full-manifest-selected Drummonds
restore/decode subsequently passed at 10:40 UTC; database recovery remains unverified.
[Restore command evidence](evidence/learn-recording-restore-local-2026-10-11.json).
Daily scheduling, operator monitoring, broader representative playback coverage
and database restore remain unfinished.
[Inventory and batch evidence](evidence/learn-recording-inventory-and-batch-2026-10-11.json).
[Source evidence](evidence/learn-recording-backup-source-local-2026-10-11.json). [SDK evidence](evidence/learn-recording-backup-s3-local-2026-10-11.json). Initial source reads can reuse existing authorised credentials in memory inside
the trusted local/ServiceOS environment; they must never be exported to AWS. Any
new source access or production runtime deployment remains behind its applicable
approval boundary.
[Local evidence](evidence/learn-recording-backup-local-2026-10-11.json).

## Verified observation — 11 October 2026

### Combined database/audio recovery — 12 October, 00:53 UTC

The real archive was restored again into the tested offline PostgreSQL environment.
Its recording/object/call/transcript metadata was retained privately before the
disposable database was removed. All 2,882 recording references match the AWS
manifest by tenant, recording ID, object ID, path, byte size and storage version.
The manifest has 2,888 objects, retaining six unreferenced files. The database
snapshot is from 12 October 00:25:21 UTC and the file inventory from 11 October
11:38:55 UTC; agreement does not make them atomic snapshots.

One selected object with a restored call and transcript was downloaded using only
the approved AWS Restore identity. Manifest, exact S3 version, encryption/retention
metadata and SHA-256 validation passed. Its 108,870 bytes fully decoded to 66.96
seconds of 8 kHz mono audio. Temporary recording/decoded output were removed. No
production/provider credential, request, write or permission change occurred.
Human listening and signed-in application playback remain unverified.

The first selector stopped because all stored recording durations are null. The
audio stage resumed from the unchanged private metadata-file SHA-256, selecting
by bounded size and existing call/transcript links. Missing duration stayed unknown,
not zero, and nothing was written back to production. Direct provider-call matches
exist for 1,474 recordings and transcript relationships for all 2,882. This check
does not assess linked-ID fallback and does not prove the other recordings orphaned.

Five reconciliation tests reject changed versions/sizes, swapped files, wrong
tenants, duplicate IDs and incomplete references. The actual AWS/restore path
passed. Exclusive private checkpoints retain the initial stopped selection and
successful resumed audio stage separately. Do not remove markers or rewrite those
journals to hide an earlier outcome.

The one-sample combined database/audio rehearsal is verified. Complete source
comparison, the omitted network-extension tables, Vault decryption, application
startup and durable independent database backups remain open.
[Sanitized evidence](evidence/learn-combined-database-audio-restore-2026-10-12.json).

### Real native database restore — 12 October, 00:44 UTC

**Actual production records restored locally; full service recovery is not yet
accepted.** A native custom-format pg_dump completed against a read-only
repeatable-read snapshot observed at 00:25:21 UTC. The archive is 196,872,981 bytes,
SHA-256 `b76d652209ac62cf901b388a4defe3a3a839694a0252b36c8e2887a25c02efbd`.
It remains in an ignored mode-0700 local recovery directory with mode-0600 files;
it was not uploaded to GitHub or an independent backup destination.

The archive restored without ignored SQL errors into a fresh container using
production's exact PostgreSQL 17.6.1.141 image. Role attributes/memberships were
recreated locally without database-role passwords. All 302 table definitions'
owner/RLS flags and extension versions matched. Restored counts: 18,598 emails,
4,328 calls, 2,882 recordings, 2,882 transcript rows, 3,170 cards and zero canonical
jobs. Every recording path resolves to restored Storage metadata. No-actor reads
returned zero emails/recordings. Counts describe this restored snapshot, not
complete historical provider coverage.

The source comparison pass hit a statement timeout after the archive completed.
It did not finish the source fingerprint baseline; no all-row equality claim is
made. Management SQL temporarily returned HTTP 544/timeouts, then recovered.
At 00:44:25 UTC health passed, the temporary credential was expired, no CLI sessions
remained, and all export/restore containers were absent. Review production load
before repeating a full fingerprint scan. The exporter now checkpoints completed
comparisons and the current table privately instead of losing that evidence on
failure.

The archive has 299 table-data entries. It omits `net._http_response` and
`net.http_request_queue`; the partitioned `realtime.messages` parent has no separate
physical rows. Explicit pg_dump table selection also omits these extension-owned
rows. The supplemental attempt stopped before credential refresh when Management
SQL timed out. Future export code uses native COPY in the same snapshot for both
tables and records the queue sequence separately (sequences are non-transactional).
**That improved production capture has not run.** This archive's two omissions
remain explicit.

pg_net requires preloading to restore its schema. The destination now loads
`pg_cron,pg_net`, but sets `max_worker_processes=0`, keeps cron launch disabled,
points pg_net at an absent database, and retains Docker network `none`, no mounts
or ports and disabled logs. Synthetic tests prove restored active cron/queued HTTP
work does not run. The existing isolation suite also passes tenant RLS, cross-tenant
foreign keys, failure redaction and cleanup. The real restore/checks took 53.24
seconds; that is not a full-service recovery-time measurement.

Remaining: complete source comparison and network-table capture; Vault root-key
and decryption recovery; matching and playing independently restored audio against
this database; application/Auth startup and controlled capture resumption; and
independently retained encrypted database backups with scheduled restore checks.
[Sanitized evidence](evidence/learn-real-native-restore-2026-10-12.json).

### Recovery authentication investigation — 12 October 2026

**00:19 UTC: authenticated read-only production connection verified.** The
existing CLI role was refreshed for 300 seconds, with unchanged membership.
Explicit `BEGIN READ ONLY; SET LOCAL ROLE postgres` returned effective user
`postgres`, session user `cli_login_postgres`, and `transaction_read_only=on`.
The disposable client exited and was removed. The final credential's recorded
expiry is 00:24:19 UTC; expiration and remaining sessions must be checked
separately. The owner password was neither recovered nor reset. This removes
the need to wait for 1Password before preparing a native database export, but
does not prove that a complete export or restore will succeed.
[Sanitized evidence](evidence/learn-production-recovery-login-2026-10-12.json).

Two findings affect the next export: this pooler ignored startup `PGOPTIONS`, so
the runner must establish read-only transaction settings explicitly and verify
them; and `pg_stat_ssl` reported `false` for the pooler-to-database connection.
Client-to-pooler TLS passed libpq `verify-full` with the official root certificate.
Do not report this as proof of encrypted transport on both hops. No TLS or
network settings were changed. Prefer a verified direct endpoint for a stronger
end-to-end transport check if this host can reach it.

The authoritative direct endpoint resolves only to IPv6 from this Mac; its
credential-free connection attempt returned `EHOSTUNREACH`. No direct database
login was sent. At 00:20:36 UTC, readback found zero probe database sessions and
zero client containers. The credential was still within its five-minute lifetime,
with its unchanged `postgres` membership and recorded 00:24:19 UTC expiry. Do not
call it expired until a later readback verifies that fact.

The forgotten owner database password is not necessarily the only recovery path.
The installed official Supabase CLI v2.40.7 refreshes an expiring
`cli_login_postgres` credential through `POST /cli/login-role` with
`read_only: false` when no database password is supplied. Production already had
this role with `postgres` membership; its previous password expired on 2 October.
This is privileged authentication, even when the intended SQL is read-only.
Never describe the credential itself as read-only. Do not automatically create a
missing role, remove an IP ban, reset the owner's password, or drop a shared CLI
role as cleanup.

The narrow preflight in `scripts/backup/verify-production-database-login.mjs`
requires that exact existing role and its unchanged membership. It normally
requires expiry; the reviewed retry also recognises only its own completed
metadata-check attempt. It
refreshes once, keeps the password in memory/stdin, and opens only a bounded
read-only metadata query in a disposable client container. It does not export
customer records. Exclusive private journals prevent replay after an uncertain
request. Inspect a prior outcome before preparing another attempt.

At 00:12 UTC a refresh returned a 300-second credential, but the connection stopped
at TLS verification using the image's general CA bundle. No customer data was
read. Supabase's official dashboard links a dedicated root certificate. The copy
already in Downloads matches that download byte-for-byte (SHA-256
`700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`). A subsequent
credential-free PostgreSQL TLS handshake passed CA and hostname verification with
TLS 1.3. The preflight now pins this certificate and keeps `sslmode=verify-full`.
The subsequent explicit-transaction check above verifies authentication. An actual
production restore remains unproven; login or TLS success is not recoverability.

The read-only production inventory reports PostgreSQL 17.6 and about 1.75 GB of
database allocation. It includes 251 public tables, 27 auth tables, eight storage
tables and the migration-history table. `cron.job`, `cron.job_run_details`, both
cron sequences and `vault.secrets` are extension configuration objects. The
eventual native export must account for these and custom managed-schema policies;
an application-table-only dump is insufficient. Vault ciphertext alone does not
prove recovery of the encryption root key. Scheduler and network side effects
must remain disabled in the isolated restore destination.

Sources: [Supabase CLI-role lifecycle](https://supabase.com/docs/guides/troubleshooting/permission-denied-when-deleting-the-cli_login_postgres-role-808bae),
[installed CLI authentication implementation](https://github.com/supabase/cli/blob/v2.40.7/internal/utils/flags/db_url.go),
[Supabase TLS guidance](https://supabase.com/docs/guides/platform/ssl-enforcement),
and [official dashboard certificate URL](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

### Database credential recovery and 1Password handoff

Chris has authorised sorting out the forgotten production database password and
will save it in 1Password. The reset has **not** been performed or verified.
The production Database Settings page was opened in the in-app browser and
redirected to Supabase sign-in. Owner password entry and reset submission remain
with Chris; never request the password in chat.

Save an item named **OpenFolk — ServiceOS Production Database**, with project
`tgbnakbxwcqjeimygroz`, database `postgres`, direct username `postgres`, and the
new generated password. Store the verified connection parameters from the
dashboard's **Connect** panel in the same item. A session-pooler username differs
from the direct username, and its hostname must come from that panel. Do not
guess it. Record the reset date only after the dashboard confirms success.

The repository search of `src`, `supabase`, `scripts` and `infrastructure` found
no runtime references to the common direct-connection/password environment names;
only historical test commands use `DATABASE_URL`. This is a code observation,
not proof about every deployed secret or external consumer. Before relying on the
new credential, verify the intended connection and existing app/API health. API
credentials and database connection credentials are separate mechanisms.

After Chris confirms the reset/save, arrange secure local access to that exact
1Password item, verify a read-only connection, then perform the isolated database
restore rehearsal. Do not recreate the Supabase project or restore over production.
Neither possession of the password nor a successful connection proves recoverability.

#### Password-manager check — 11 October, 13:40 UTC

Chris unlocked 1Password for this check. In the visible Allkin account, searching
Supabase found a dashboard login, not a database connection credential. Exact
production-project and `postgres` searches returned no results. The eight
ServiceOS matches listed application-named entries and an empty **Openfolk ServiceOS**
secure note; no database-specific item was identified. No password was revealed,
copied, changed or saved by this check.
This is a bounded search of the visible account, not proof that no credential
exists in another account or under unrelated names.

Chris subsequently requested new API keys be stored in **Openfolk ServiceOS**.
The service/environment scope is awaiting clarification; API keys must not be
mistaken for the database password needed by PostgreSQL restore. No new key or
password reset has been performed. The database owner reset/save handoff above
remains required unless an existing database credential is located.

Official references checked 11 October:
[database password reset](https://supabase.com/docs/guides/troubleshooting/how-do-i-reset-my-supabase-database-password-oTs5sB)
and [connection methods and parameters](https://supabase.com/docs/guides/database/connecting-to-postgres).

### Isolated logical-restore destination — 11 October, 13:51 UTC

**Local synthetic acceptance only. No production or retained TEST database was
exported or restored.** The reusable destination in
`scripts/backup/database_restore_sandbox.py` creates a fresh, disposable official
Supabase PostgreSQL 17 container. It accepts reviewed private SQL files in order;
it has no source URL or existing-target option. The cached image is resolved to an
immutable image ID before launch; this run used
`sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518`.

Before any restore it verifies Docker network `none`, zero host mounts/ports,
no extra capabilities or privileged mode, private process/IPC namespaces and no
Docker log capture. PostgreSQL starts with only `pg_cron` preloaded and
`cron.launch_active_jobs=off`; listeners are restricted to container loopback.
Those settings are checked again after each SQL file. No Edge Function, application
worker or hosted scheduler is started. Do not attach the container to a network,
enable other background workers or change its server settings during a rehearsal.

The actual separate source-to-target `pg_dump`/SQL restore passed row fingerprints,
recording pointers and retained failed/pending transcript states, composite
customer/tenant foreign keys and RLS tests for two tenants and missing tenant
context. An active every-second cron entry and its sequence were exported and
restored while its effects and run history remained empty. This caught a real
export omission: `pg_dump --data-only --schema cron` did not include the
extension-owned `cron.job` data on this image. Explicit table and sequence selection
did. The eventual real export must inventory extension configuration rather than
assuming a selected schema includes all of it.

An invalid SQL restore also stopped immediately, withheld raw SQL/error contents
and removed the partial destination. All rehearsal containers and temporary SQL
files were removed. [Sanitized evidence](evidence/learn-database-restore-isolation-2026-10-11.json).
Reproduce using `python3 scripts/backup/verify_database_restore_isolation.py`;
Docker and the already-installed image are required. This command is entirely
synthetic and does not need provider credentials.

For the real rehearsal, call `RestoreSandbox` as a context manager, apply the
reviewed role/schema/data/history files with `restore_sql_files`, and perform the
source-baseline/relationship checks before leaving that context. SQL files must
be private regular files (0600), not symlinks. Successful file-load receipts record
bytes and SHA-256 only. Any SQL failure stops the run; do not skip failing statements
to produce a green result. Ordinary errors and interrupts clean up the exact
run-labelled target. A killed host/process can leave a container: identify it by
the `serviceos-db-recovery-` name and matching
`ai.openfolk.serviceos.database-recovery` label before removing it. Never run a
blanket Docker prune as cleanup.

**Still required:** securely obtain database access; acquire a real consistent
backup and its private comparison baseline; reconcile roles, platform schemas,
extensions, migration history and encrypted Vault/key dependencies; restore actual
retained data; compare IDs, relationships and recording manifest digests; and
verify application/auth behaviour and controlled resumption separately. The
synthetic fixture is not the full ServiceOS schema, a physical-backup restore,
proof of Vault decryptability or a measured production recovery time.
Supabase's [logical backup/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
and pg_cron's [scheduler settings](https://github.com/citusdata/pg_cron#extension-settings)
remain the reference; the isolation runner does not replace those compatibility
and recovery checks.

### Backup metadata observation

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

## Original independent recording-backup proposal — implementation underway

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
backup verified**, and **restore verified**. All 2,888 objects in the explicitly
observed inventory and one manifest-selected audio restore/decode are verified.
Subsequent arrivals, scheduled coverage and isolated database recovery remain unverified.

### Voicemail buckets — TEST acceptance, 11 October 22:20 UTC

TEST release 073 now contains private `receptionist-voicemails` and
`learn-voicemail-sources` buckets. Two synthetic acceptance files (132,695 bytes
total) are retained under `ce730001-aaaa-4000-8000-000000000001`; there are no
corresponding tenant, route or voicemail rows. Hosted byte/hash readback and
anonymous/public denial pass. This is not independent backup or restore evidence.
Before real voicemail activation, extend the approved source/audio inventory and
backup/restore acceptance to these buckets and their intake/source/publication
relationships. No customer voicemail files have been imported by this TEST release.
See [hosted evidence](evidence/learn-voicemail-hosted-test-2026-10-11.json).


### Published synthetic voicemail — TEST, 11 October 22:52 UTC

A second synthetic audio/original-email pair (132,695 bytes) now has linked intake,
source, mailbox, queue and private-message records in archived fixture
`ce740001-aaaa-4000-8000-000000000001`. Both hosted file hashes match and all 136 prior
datasets are preserved. The route and account are disabled; no login or mailbox
access was granted. These two new files plus the earlier unlinked acceptance pair
are TEST evidence only. Neither this publication nor the earlier byte check proves
independent backup/restore of the voicemail buckets. Real voicemail activation still
requires source/audio inventory, retention and a restore that preserves private
access and these relationships. [Evidence](evidence/learn-voicemail-queue-import-2026-10-11.json).
