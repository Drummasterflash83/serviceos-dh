# Independent ServiceOS database backup — proposed, not activated

12 October 2026. This is the remaining database recovery work, alongside the
already established recordings bucket. The native database and all 16 Vault
secrets have passed a local restore. No independent database upload, database
backup identity, key escrow or recurring database runner is established yet.

The foundation template is prepared and locally validated. Packaging, encryption,
transfer and independent restore still need executable verification before the
combined activation request is presented. **This document is not an approval or
evidence that a backup exists.**

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
| Recovery keys | Separate fields in the existing Openfolk ServiceOS 1Password note; never in S3, Git or reports |

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

Save the private age identity and the existing production pgsodium/Vault root key
in separate labelled fields in **Openfolk ServiceOS** in 1Password. Preserve the
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

1. Complete synthetic packaging/encryption/tamper tests and bounded transfer
   verification, then present the exact combined storage/access/key-escrow/copy
   proposal for approval. Do not deploy from this document alone.
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
```

These checks make no authenticated AWS requests. `--refresh-public-prices` on the
estimate reads public AWS pricing only. They do not prove deployed IAM policy
behaviour, 1Password recovery, encryption correctness or S3 restore acceptance.
