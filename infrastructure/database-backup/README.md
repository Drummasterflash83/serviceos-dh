# Independent ServiceOS database backup — approved, not activated

12 October 2026. Chris has approved the described destination, scoped access,
key escrow and bounded first copy/restore. The separate 1Password CLI integration
decision remains pending; no resources, keys or database copy have been created.

This is the remaining database recovery work, alongside the
already established recordings bucket. The native database and all 16 Vault
secrets have passed a local restore. No independent database upload, database
backup identity, key escrow or recurring database runner is established yet.

The foundation template is prepared and locally validated. Real age encryption,
strict package recovery and the AWS SDK transfer protocol pass a combined
synthetic round trip. The existing real snapshot passes package admission only;
it has not been encrypted or uploaded. The encrypted package now also passes a
full synthetic PostgreSQL/Vault restore through the stdin-only recovery command.
The supervised operator runner and exact-item 1Password adapter now pass local
synthetic checks. Live access, escrow, infrastructure provisioning and the first
real copy still require the distinct approvals and verification below. **This document is not an approval or
evidence that an independent database backup exists.**

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

## 1Password access preparation — awaiting access decision

On 12 October, the desktop app was unlocked and the **Openfolk ServiceOS** item
was visible in the Allkin Group Ltd account. Its CLI page showed **Enable
integration**, so the CLI integration was not enabled. No item contents were
retrieved or changed during this check.

The official stable macOS arm64 CLI **2.40.0** is prepared only at
`/private/tmp/serviceos-op-2.40.0/op`. Signature verification passed:
`com.1password.op`, Developer ID Application **AgileBits Inc. (2BUA8C4S2C)**,
Apple certificate chain. Binary SHA-256:
`7dff93952c49d25133c8a2487ab7072e656368d4e7089f055f119bc8d1066ae2`.
Only version/help commands have run; no authenticated account request has occurred.
Distribution: [official release history](https://app-updates.agilebits.com/product_history/CLI2).

An explicit request to enable the CLI route is pending. As documented by
[1Password](https://www.1password.dev/cli/app-integration-security), terminal
authorisation is account-wide, not restricted technically to the named item.
Scripts must target only Openfolk ServiceOS, fail on ambiguous identity and keep
all secret-bearing command output inside protected processes. The owner must
complete biometric authentication; do not bypass that prompt. Sessions expire
after inactivity or when the app locks, so this is suitable for supervised key
setup/recovery, not a dependable unattended daily key source.

For a subsequent separately approved escrow write, use an in-memory JSON template
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

## Supervised initial-copy commands — prepared, not run against real services

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

The proposed combined approval will also cover one key per new machine user,
stored separately in this Mac's Keychain as
`OpenFolk.ServiceOS.DatabaseBackup.Writer` and
`OpenFolk.ServiceOS.DatabaseBackup.Restore`, account `235099643372`, with recovery
copies in the specified 1Password note. Record issue time and rotation due within
90 days. Do not expand or reuse the recordings identities. No Supabase service
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
