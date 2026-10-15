# Independent ServiceOS database backup — first copy and restore verified

12 October 2026. The approved London CloudFormation stack reached
`CREATE_COMPLETE` at 09:28 UTC. The separate Writer and Restore identities each
have one approved key, verified in their separate Mac Keychain entries and in
the existing Openfolk ServiceOS note in 1Password. Rotation is due **10 January
2027**. The dedicated age recovery key and existing Vault root key were saved
and read back from that note at 09:20 UTC; existing note contents were preserved.

The retained 06:37 UTC production snapshot was encrypted into **198,018,440
bytes**, uploaded with AES256 server-side encryption and 30-day governance
retention, then downloaded by the separate Restore identity. With keys retrieved
again from 1Password, the downloaded package restored in an offline container:
**1,594,994 native rows, 711 operational rows, 16 Vault secrets and 2,883 recording
relationships** verified. Catalog/RLS, extensions and original package hashes
matched; the container and active lock were removed. No production data changed.
[Sanitised acceptance evidence](../../docs/operations/evidence/learn-independent-database-recovery-2026-10-12.json).

This verifies one independent database snapshot and its recovery route alongside
the separately established recordings backup. **Daily database scheduling,
missed-run monitoring and full application/service recovery remain incomplete.**
The initial approval creates no recurring database schedule. The implementation
and remaining operating requirements are described below.

## Exact proposed destination and contents

| Item | Proposed value |
| --- | --- |
| Owner/account | OpenFolk, AWS `235099643372` |
| Region | London, `eu-west-2`, enforced by template rule |
| Bucket | `openfolk-serviceos-database-235099643372-eu-west-2` |
| Allowed project prefix | `projects/tgbnakbxwcqjeimygroz/` |
| Initial snapshot | Production, 12 October 06:37:26 UTC; completed 06:44:21 UTC |
| Measured base payload | 197,954,785 bytes, about 198 MB, before packaging/encryption |
| Initial copy bound | One complete encrypted snapshot package, maximum 1 GiB; oversize fails without truncation |
| Recovery keys | A concealed structured recovery field in the existing Openfolk ServiceOS note; never in S3, Git or reports |

This is a **whole-project** recovery archive, not a tenant-filtered export. It
contains customer communications, contacts, authentication state, encrypted Vault
records and legacy credential-bearing database rows. It must remain restricted
to OpenFolk recovery operators. Future tenants in this production project would
also be included; the archive must never be offered as a client-download feature.

Package the matching native `database.dump`, `net-tables.sql`, source inventory,
export report, restore evidence and a private manifest containing exact file
lengths/hashes, snapshot ID, source revision, pinned restore image, format version
and recipient identifier. Additional evidence is small but must be included in
the final measured size. Do not substitute a partial or older archive, combine
snapshots, or upload plaintext manifests revealing source records.

The export includes Storage metadata, not recording/file bytes. Keep the existing
audio backup and its manifests linked to the database snapshot; reconcile the
new 2,883rd recording and voicemail coverage separately. Supabase configuration,
Auth service settings, application deployment and external provider credentials
also need their own recovery inventory; this package does not prove full-service
recovery.

## Encryption and keys

Use the maintained [age tool](https://github.com/FiloSottile/age), pinned and
verified from its official distribution. Generate a dedicated X25519 recipient
and private identity for database recovery. The writer receives the public
recipient only; encryption does not require retaining the decryption key on a
daily runner. S3 additionally requires AES256 server-side encryption.

The implemented package adapter pins the Darwin arm64 age **v1.3.2** executable
to SHA-256 `4012dfc2725883beafb710894af4f599b7a94f8c8e0f51f02cc96ab8df33915e`.
The official release archive is
[age-v1.3.2-darwin-arm64.tar.gz](https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-darwin-arm64.tar.gz),
18,106,798 bytes, SHA-256
`e2020b073c44f692685a24d6abc378817eb81ffaaf49fd0531ef8565f767f2f5`.
This was compared with the official GitHub release metadata over HTTPS; a Sigsum
transparency proof has not been verified. The local test binaries are in
`/private/tmp/serviceos-age-1.3.2/`; no system-wide installation was performed.
Prepare the same verified distribution there before running these tests on
another Mac. They fail rather than silently skip if it is absent. Other platform
binaries require their own reviewed pins.

`database_backup_package.py` copies six allowlisted snapshot files into private
temporary storage, validates the export/native-restore/Vault evidence, builds an
encrypted manifest with file hashes, and invokes the pinned age executable. It
publishes a new ciphertext file without replacing an existing file. Recovery
authenticates and hashes the ciphertext, permits only the exact flat file set,
and verifies the manifest and snapshot evidence before returning a directory.
Symlinks, traversal, duplicate/missing members, malformed or mixed snapshot
evidence, wrong keys, truncation and changed bytes are rejected. Temporary
plaintext staging exists only in private local directories and is removed on
normal success/failure; a host crash still needs local cleanup inspection.

`database-backup-transfer.mjs` verifies the local artifact, destination account
and controls, exact retained object version and downloaded ciphertext hash before
writing a completion receipt. A lost acknowledgement stops the run; a later retry
verifies the existing object. The fixed database S3 factory reuses the established
transport with a separate project binding and 1 GiB bound. Recording limits and
scope stay at their existing values. The package descriptor and transfer receipt
contain only project/snapshot bindings, public recipient, hashes and storage
version metadata; the source manifest remains inside the encrypted package.
Transfer success explicitly does not claim database restore acceptance.

`restore_database_package.py` accepts an encrypted package descriptor, the age
identity and Vault root key through stdin. It does not call Supabase or any secret
store. It verifies/extracts the package, then invokes the native database checker
with the supplied root key in a fresh offline container. Every archived COPY row,
sequence, table owner/RLS flag, extension version, operational supplement and
recording relationship is checked. Counting decrypted expressions forces Vault
to authenticate every secret; a wrong key fails. New verification files go into
a separate directory, and every original package file is rehashed afterward.
Keys and raw errors are not printed. Its result explicitly leaves independent
storage provenance, 1Password provenance and full application recovery unproven;
the outer operator workflow must supply those observations.

A separate regression restored the existing real archive with the new source/
evidence path separation: 1,594,994 native rows and 711 operational rows matched,
all six original files stayed unchanged, and the offline container was removed.
It used no recovery key and made no production connection; real Vault decryption
remains proven by the earlier rehearsal, not by this path-separation regression.

## 1Password access preparation — approved and enabled

On 12 October, the desktop app was unlocked and the **Openfolk ServiceOS** item
was visible in the Allkin Group Ltd account. Its CLI page showed **Enable
integration**, so the CLI integration was not enabled. No item contents were
retrieved or changed during this check.

The official stable macOS arm64 CLI **2.40.0** is prepared only at
`/private/tmp/serviceos-op-2.40.0/op`. Signature verification passed:
`com.1password.op`, Developer ID Application **AgileBits Inc. (2BUA8C4S2C)**,
Apple certificate chain. Binary SHA-256:
`7dff93952c49d25133c8a2487ab7072e656368d4e7089f055f119bc8d1066ae2`.
Authenticated exact-note reads and approved recovery writes have now succeeded.
Distribution: [official release history](https://app-updates.agilebits.com/product_history/CLI2).

Chris explicitly approved enabling the CLI route on 12 October. After native window-control errors, Chris enabled the setting; read-back confirmed
“Integrate with 1Password CLI” checked. Account metadata is readable; exact-note
authentication is verified after Chris completed Touch ID. As documented by
[1Password](https://www.1password.dev/cli/app-integration-security), terminal
authorisation is account-wide, not restricted technically to the named item.
Scripts must target only Openfolk ServiceOS, fail on ambiguous identity and keep
all secret-bearing command output inside protected processes. The owner must
complete biometric authentication; do not bypass that prompt. Sessions expire
after inactivity or when the app locks, so this is suitable for supervised key
setup/recovery, not a dependable unattended daily key source.

For the approved escrow write, use an in-memory JSON template
on stdin to `op item edit`; sensitive field assignments must never go into command
arguments. Preserve all existing fields and stop on conflicting prior recovery
values. The CLI warns that templates do not preserve passkeys: verify that the
target item has none before using this path. Read back the saved recovery fields
and prove decryption with those retrieved values. Do not accept an in-memory key
generated earlier as proof that 1Password saved it correctly.

Save the private age identity and the existing production pgsodium/Vault root key
as named values in the concealed **ServiceOS database recovery** field of
**Openfolk ServiceOS** in 1Password. Preserve the
existing note. Record the non-secret recipient and source-project binding in the
private manifest. Verify retrieval and decryption from the saved item, including
a wrong-key/tampered-package rejection, before accepting the upload. The root key
must match this snapshot's Vault rows. Do not rotate the production root key.

The root key can be read using Supabase's
[documented endpoint](https://supabase.com/docs/reference/api/v1-get-pgsodium-config).
The previous local rehearsal retrieved it from Supabase at restore time; that
does **not** establish recovery during a Supabase outage. Independent 1Password
retrieval is therefore required. Keys travel through protected process input,
not command arguments, environment variables, clipboard history or diagnostic
output. Any necessary temporary file must be private and removed afterward;
ordinary file deletion is not a guarantee of physical secure erasure.

### Verified recovery escrow — 12 October, 09:20 UTC

The saved concealed field was read back from the exact bound secure note. The
retrieved age identity derives the recorded recipient, and the retrieved Vault
root key matches the production configuration. Existing fields and metadata are
unchanged. No private key was printed or written to a plaintext host file.
[Sanitised evidence](../../docs/operations/evidence/learn-database-recovery-escrow-2026-10-12.json).

The first template attempt returned success but did not add a field. Read-back
caught it; exact-item inspection confirmed no recovery material had been saved.
A dry run isolated the cause: Node supplies a socket as child stdin on macOS,
which the CLI ignored as a template. The adapter now supplies an actual POSIX
pipe through a fixed `/bin/cat` pipeline. Arguments remain positional; secret JSON
stays on stdin. A six-test regression suite checks transport, preservation,
conflicts, uncertain writes and exact account/role binding. Use one persistent
terminal session for supervised CLI work to reduce repeated biometric prompts.

## Supervised initial-copy commands — first real run verified

`run-serviceos-database-backup.mjs` supports only the already retained production
snapshot specified above. It does not export fresh source data, create resources,
provision keys, save escrow values or schedule work. Those are distinct setup
steps. Use CloudFormation stack name **openfolk-serviceos-database-backup**;
credential validation requires its generated Writer/Restore principal names.

After the corresponding approvals and setup, create a 0600 binding file within
this checkout's 0700 `.verification-results` directory. It contains only the exact
1Password account, vault and item IDs plus the exact title, not secret values:

```json
{
  "accountId": "<26-character account ID>",
  "vaultId": "<26-character vault ID>",
  "itemId": "<26-character item ID>",
  "title": "Openfolk ServiceOS"
}
```

Resolve those IDs from the authorised account and named item; do not select a
similarly named item automatically. `onepassword-database-recovery.mjs` pins the
CLI binary and checks item identity, secure-note category and field uniqueness.
It rejects attachments/passkeys and conflicting existing recovery material.
`saveIfAbsent` accepts the dedicated age identity/recipient and existing Vault
root key in memory, sends JSON through stdin and verifies saved values and prior
fields afterward. An immediate pre-write re-read catches concurrent edits but
is not an atomic compare-and-swap guarantee: keep this item closed to concurrent
editing during setup. An uncertain write must be read back before retrying.
The adapter only handles the recovery-material field; save and verify the two
AWS machine credential recovery copies separately during approved provisioning.

Run from a clean, committed checkout, with the verified age and 1Password
binaries at the pinned paths, an approved authenticated desktop session, the
saved recovery field and the pinned offline PostgreSQL image available:

```sh
node scripts/backup/run-serviceos-database-backup.mjs --prepare-initial <new-run-uuid> .verification-results/database-escrow-binding.json
node scripts/backup/run-serviceos-database-backup.mjs --copy-and-restore-initial <same-run-uuid> .verification-results/database-escrow-binding.json
```

The first command reads escrow, packages/encrypts the retained snapshot and
performs a full offline database/Vault restore before recording preparation.
It creates a new private run directory and never overwrites a prior run. Recovery
keys are passed through stdin, not host files or arguments. The offline database
container temporarily needs its private root-key file and is removed afterward.
Plaintext database staging exists privately and is removed after a successful
preparation; failed preparation requires inspection and may retain evidence.

The second command requires that successful preparation, exact archive hash,
format and snapshot binding. It loads Writer from its dedicated Keychain item,
verifies upload/readback, closes Writer, loads the separate Restore item and
verifies a version-specific download. It reads recovery material from 1Password
again, then restores the downloaded package in an offline container. Only the
whitelisted restore summary is recorded as acceptance. Its result explicitly
leaves daily operation and full-service recovery unverified.

Each transfer has a ten-minute deadline and each Python recovery stage a
twenty-minute interrupt deadline. Failed attempts retain sanitised evidence. An
uncertain database restore retains `active.lock`; inspect the attempt report and
actual Docker container state, complete cleanup, and document the outcome before
removing that lock. Never delete a lock merely because it is old. Transfer-only
failures release the lock and can retry against the same immutable object.
Preserve earlier receipts and failed-run evidence. No command accepts a recovery
key as a CLI argument; never print CLI item contents or Keychain values.

If a copy and separate Restore download finish but the following 1Password
read is interrupted, retain that exact `receipt-<attempt>.json` and
`download-<attempt>.age`. After completing the normal desktop Touch ID prompt,
resume only that download with:

```sh
node scripts/backup/run-serviceos-database-backup.mjs --restore-downloaded-checkpoint <same-run-uuid> .verification-results/database-escrow-binding.json .verification-results/production-release-checkpoint-YYYYMMDD-name <failed-attempt-uuid>
```

The resume mode requires the prior failure to be at `escrow-readback`, checks the
immutable transfer receipt and exact downloaded ciphertext hash, rereads the
bound 1Password item, and performs a fresh offline restore. It makes no new
source export or S3 transfer. A failed or uncertain restore retains the lock
for inspection; a completed download alone is never a verified backup.

## Access created by activation

The reviewed [CloudFormation template](foundation.cloudformation.json) creates
one private bucket, its restrictive policy, two managed policies and two machine
users under `/serviceos/database-backup/`. Each user's policy is also its
permissions boundary. There is no console login, source-database access, new
Supabase grant, scheduler, network service, access key or automatic data transfer
in the template.

- **Writer:** inspect the bucket; list only the project prefix; create, read and
  verify project backup objects. No delete, retention changes, bypass or AWS
  administration. Use unique snapshot names and `If-None-Match: *` writes.
- **Restore:** inspect and list the same scope, then read selected retained
  versions. No writes, deletion, retention bypass or AWS administration.

Chris approved the combined setup and separately confirmed both keys at creation.
One key per new machine user is now stored and read back separately in this Mac's Keychain as
`OpenFolk.ServiceOS.DatabaseBackup.Writer` and
`OpenFolk.ServiceOS.DatabaseBackup.Restore`, account `235099643372`, with recovery
copies verified in the specified 1Password note. Writer was verified at 09:36 UTC
and Restore at 09:37 UTC on 12 October; both are due for rotation by 10 January
2027. Do not expand or reuse the recordings identities. No Supabase service
key, administrator token or recovery decryption key is placed in AWS.

## Retention, failure handling and rollback

The bucket blocks public access, enforces ownership, TLS and SSE-S3, enables
versioning and applies 30 days of GOVERNANCE Object Lock. The writer/restore
identities cannot bypass it. An appropriately privileged account administrator
can bypass governance; this is not compliance-mode immutability. See
[AWS Object Lock considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

There is **no automatic expiry or deletion**, including after day 30. Retain the
bucket and its policy on stack deletion/replacement. Any later pruning policy
needs a separate reviewed retention decision. Existing database archives,
recording backups and production data remain intact. On failed activation or
verification, stop the new runner, retire its keys and retain uploaded versions
for diagnosis; never claim success from a partial upload or unverified hash.

The runner must check account identity and bucket controls before every transfer,
use bounded requests and create-only writes, verify returned version/checksum
and retention, and publish a completion receipt last. If a retry encounters an
existing name, compare the exact stored version and checksum; never overwrite it.
S3 enforces server-side encryption but cannot verify age encryption: the runner
must enforce client encryption and verify the artifact before allowing upload.

## Cost and schedule

[Reproducible estimate](../../docs/operations/evidence/learn-database-backup-estimate-2026-10-12.json)
uses the freshly retrieved official London
[AWS S3 price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-west-2/index.json).
At a planning size of 256 MiB per daily snapshot:

- 30 retained snapshots: **US$0.18/month** storage run rate.
- 365 retained snapshots: **US$2.19/month** storage run rate, assuming no size growth.
- 1,000 PUT/LIST and 1,000 GET/HEAD operations: about **US$0.006/month**.
- Thirty new exports transfer about 8.05 GB from Supabase: up to **US$0.73** if
  all of that exceeds the shared quota, using its published
  [US$0.09/GB uncached rate](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

These are incremental planning figures before tax, not invoice totals or a cap.
Restore downloads, hosted runner/monitoring, existing subscriptions and support
are excluded. The initial copy uses the already completed local snapshot and
does not repeat its source egress. No unused quota or free credits are assumed.
Because nothing expires automatically, storage cost grows with retained copies
and source size. Reuse the existing account-wide US$5 alert; verify its delivery.
It is not a cap and also includes other AWS usage. Do not silently upgrade the
owner's AWS Free plan; account expiry/credits must be resolved before dependable
long-term operation is accepted.

Initial setup is one bounded upload and independent restore from this Mac. It
does not establish a dependable daily service. The target is a successful daily
snapshot, a last-success age alarm after 26 hours, and a monthly isolated restore.
A Mac/Codex schedule is an interim aid because sleep, logout and closed software
can stop it. Select and verify an unattended runtime and its narrowly scoped
source credential before counting daily operation complete. Do not silently
copy the existing Supabase administrator token into a hosted runner.

## Activation and acceptance sequence

1. Synthetic packaging/encryption/tamper and bounded SDK transfer checks now pass.
   The full offline database/Vault restore command is also verified synthetically.
   The supervised operator runner and recovery-material adapter also pass local
   synthetic checks. Present the combined storage/access/key-escrow/copy proposal
   for approval before activation. Do not deploy from this document alone.
2. Reconfirm account/region and empty-or-expected destination, show the resource
   change set, deploy the approved template, create only the two approved keys,
   and verify their allowed/denied scope. Save keys and recovery material safely.
3. Recheck native archive and supplement hashes against the successful restore
   evidence, encrypt the complete package locally and measure final bytes.
   Reject incomplete, mismatched or oversized packages.
4. Upload under a new snapshot prefix, verify exact object version, hash and
   retention, then write the completion receipt. Partial attempts are not backups.
5. Use the separate Restore identity to download from S3. Retrieve the keys from
   1Password, verify the encrypted package and all contained files, and restore
   in a fresh network-isolated container with no host mounts, published ports,
   active cron or network workers. Do not contact Supabase to recover the key.
6. Repeat full COPY-row, sequence, catalog/RLS, extension, operational supplement,
   Vault decryption and recording-metadata relationship checks. Compare against
   the saved snapshot evidence. Keep actual source values out of reports. Remove
   the restore container and private temporary key files afterward.
7. Record honest coverage and outstanding application/audio dependencies, then
   establish and observe the daily runtime and missed-run alert. Full application
   recovery and production LEARN promotion remain separate acceptance gates.

Local preparation checks:

```sh
node scripts/backup/database-backup-template.mjs --write-template
node --test scripts/backup/database-backup-template.test.mjs
cfn-lint infrastructure/database-backup/foundation.cloudformation.json
node scripts/verify/learn-database-backup-estimate.mjs
python3 -B -m unittest discover -s scripts/backup -p test_database_backup_package.py -v
python3 -B scripts/backup/verify_encrypted_database_restore.py
node --test scripts/backup/*.test.mjs
```

These checks make no real authenticated AWS requests. The transport tests use
the official SDK with fake credentials and an in-memory request handler; this
does not prove live IAM enforcement or S3 behaviour. `--refresh-public-prices` on the
estimate reads public AWS pricing only. They do not prove deployed IAM policy
behaviour, 1Password recovery or independent S3 database restore acceptance.
The Python tests do use the real pinned age implementation for encryption,
authentication, tamper rejection and byte-preserving local recovery.

## Explicit release checkpoints — 13 October

The original initial-snapshot commands retain their fixed archive. Release work
can now name a fresh private checkpoint explicitly, without overwriting an earlier
export or creating a recurring schedule:

```sh
node scripts/backup/export-production-database.mjs --export-release-checkpoint .verification-results/production-release-checkpoint-20261013-prelaunch
node scripts/backup/check-production-vault-recovery.mjs --verify-release-checkpoint .verification-results/production-release-checkpoint-20261013-prelaunch
```

Run the native offline restore between these two commands, passing the checkpoint
as both `source_root` and `evidence_root` to
`restore_production_database.run(compare_native=True, ...)`. All physical-table,
operational supplement, catalog and source-binding checks still apply. Vault
verification reads the existing key only into memory and passes it by stdin to
the offline container; it does not write keys or plaintext secrets into reports.

After both checks pass, the supervised runner accepts `--prepare-checkpoint` and
`--copy-and-restore-checkpoint` with four arguments: mode, a fresh UUID, the existing
private 1Password binding path, and the exact relative checkpoint path. Preparation
requires the committed source revision and verified archive, and reads the existing
recovery material from 1Password. Copy uses the same private London destination,
separate Writer/Restore identities and 1 GiB maximum, with an explicit archive
length/hash bound to the preparation. It downloads and restores that exact new
snapshot; it cannot silently substitute the original initial archive. An uncertain
restore retains its inspection lock. No keys, resources or schedules are created.

For an active source, Vault ciphertext may change after the export snapshot.
`check-production-vault-recovery.mjs` first tests equality with current LIVE
Vault. If it differs, a checkpoint can still pass only when LIVE records an
update after the snapshot, archived and restored `vault.secrets` COPY fingerprints
match, and every archived secret decrypts in the isolated container. Its report
then says `all_archived_vault_secrets_decrypt_and_match_archive` and explicitly
records that later-LIVE equality was not proven. The package gate accepts that
scoped result; it rejects an unexplained mismatch, incomplete decryption or
unbound snapshot. A new local snapshot still needs independent copy and restore.

The first release checkpoint (13 October 00:16 UTC) exported 201,420,792 bytes
and passed the native, operational-table and Vault restore checks. Its recording
versions and references match the already verified audio inventory. The runner's
ten tests pass, including mismatched archive and invalid path rejection. The fresh
encrypted off-site copy and independent restore remain pending the existing
1Password recovery material; this local proof does not claim those steps passed.
[Checkpoint evidence](../../docs/operations/evidence/learn-production-release-checkpoint-2026-10-13.json).

### Release checkpoint independent restore — 13 October

The 00:16 UTC checkpoint has now been encrypted, copied to the approved private
London bucket, downloaded using the separate Restore identity, and restored in an
isolated container. Its 1,617,988 native rows, 2,652 operational rows, 2,944 recording
relationships and 16 Vault secrets verified. The container was removed. This does
not establish daily database backups or include later production changes.

The existing local binding file is
`.verification-results/database-backup-onepassword-binding.json`; the earlier
`database-escrow-binding.json` commands are examples, not an existing local file.
Routine unattended backup encryption should need only the public recipient and
scoped Writer access. Private recovery material belongs in a separate restore
workflow. The public recipient is now pinned in
`infrastructure/database-backup/public-recipient.json`. For an already exported,
locally restored and Vault-verified checkpoint, the separate
`scripts/backup/run-public-database-backup.mjs` runner has `--prepare-checkpoint`
and `--copy-checkpoint` stages. These stages encrypt with the public recipient,
then use the existing scoped Writer and Restore identities to verify the
off-site ciphertext and independent download. They never read the private
recovery key or claim that this new package has been restored. Its actual daily
schedule, alerting and a fresh real-provider run still need acceptance.

A later `--restore-copy-checkpoint` drill takes the exact copy attempt ID and
the existing private 1Password binding path. It validates that download and
receipt before asking for one private-key read, then runs the isolated database
and Vault restore. It makes no new provider export or off-site transfer. The
routine copy stage can therefore run without a private-key unlock while
recovery remains supervised. A fresh daily source export, reliable runtime and
alert still have separate acceptance gates.

The new daily package format (`serviceos-database-package/2`) accepts an
export whose native archive, operational supplement, catalog and every archived
COPY row have already passed an offline restore. It carries matching archived
and restored Vault ciphertext fingerprints, then defers actual Vault
decryption to the supervised restore. Its `--prepare-daily`, `--copy-daily` and
`--restore-copy-daily` modes now have an approved, installed dedicated source
identity for a one-off live rehearsal. A dependable hosted runtime and schedule
are still pending. No routine step reads
the recovery key or claims Vault decryption. See
[daily source access](DAILY-SOURCE-ACCESS.md) for the exact boundary.
The `run-daily-database-backup.mjs --run-once` runner binds the
export, isolated native restore, public-key encryption and independently
downloaded copy into one attempt. It stops on an unconfirmed stage and records
an inspection-required failure; it does not retry source or copy actions.
There is no installed schedule or age alert yet. Chris approved the standing
backup access and existing private London destination on 15 October. A
successful one-off copy would still leave supervised
Vault decryption and full application/Auth recovery unverified.

The supervised recovery runner now reads 1Password only once, after the
downloaded ciphertext is verified, and a failed desktop authorisation does not
trigger another Touch ID prompt in the same run. Stopping a Python restore
forwards interruption so the isolated container can clean up. The 15 October
interrupted drill was inspected: its offline container and decrypted working
copy were removed; the original encrypted object and download remain intact.

### Database object transfer deadline — 13 October

The post-voicemail encrypted package is 294,441,336 bytes. Its first copy attempt
ended around the previous shared 120-second absolute request limit, reporting
only `s3_request_unconfirmed`. A subsequent exact, read-only destination check
found no object. The old generic receipt cannot establish whether the request
hit that absolute deadline, a socket timeout, or another transport failure.

The fixed database transport now allows **eight minutes per object upload or
complete streamed download**, within the supervisor's ten-minute role lifetime.
Database metadata/receipt calls and recording-object transfers retain two-minute
limits. Connection timeout remains ten seconds and idle-socket timeout remains
two minutes. No configurable destination, additional bytes, multipart upload,
automatic retry, IAM change, key change or schedule has been introduced.

Failures expose only fixed classifications: `s3_request_deadline_exceeded`,
`s3_request_cancelled`, `s3_transport_timeout`, or the existing bounded stream
codes. Provider exception messages, headers and private object paths are not
included. A timeout still means an uncertain operation; it never proves absence.
The existing retry path checks the exact immutable object before deciding whether
to copy and retains conditional `If-None-Match: *`, hash, version and receipt gates.

The 27 targeted synthetic transport/runner checks pass, including database-only
budget selection, unchanged metadata/recording limits, cancellation and deadline
stream cleanup, single-attempt conditional uploads, unknown acknowledgement
recovery, and invalid destination/size/hash rejection. No real upload was performed
as part of this change; live retry remains a separate supervised operation.
