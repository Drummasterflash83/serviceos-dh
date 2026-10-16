# Build 01 LIVE runtime source: exact off-site copy for review

**Prepared 16 October 2026; no upload has occurred.** This review describes
one encrypted application-source object. The earlier approval for an exact
database copy and the standing database backup schedule do not authorize this
separate application archive.

## Exact copy

| Item | Reviewed value |
| --- | --- |
| Source | Retained read-only LIVE Edge source inventory completed 06:30:22 UTC: 102 active functions, 721 source files, including `platform-worker` v93 |
| Local encrypted file | `.verification-results/build01-live-edge-source-2026-10-16-0630.age` (private mode `0600`) |
| Bytes | `5,971,576` |
| SHA-256 | `4aa6f7ae538077530caa09cd8509b173dc60b97f28dc14e4ccea7d59665b335c` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; no decryption key in the package or repository |
| Destination account/region | AWS `235099643372`, London `eu-west-2` |
| Existing private bucket | `openfolk-serviceos-database-235099643372-eu-west-2` |
| Proposed exact object key | `projects/tgbnakbxwcqjeimygroz/objects/c384ec8d4be8f271445b68e273197e13bdeaa1655e389f2ef058f88f8b242ab9/4aa6f7ae538077530caa09cd8509b173dc60b97f28dc14e4ccea7d59665b335c` |
| Storage controls | TLS; AES256 server-side encryption; versioning; create-only write; 30-day governance retention |
| Access | Existing separate scoped Writer uploads and verifies; Restore independently downloads and hashes the exact object version |

The local package was built only after all source hashes and the saved LIVE
inventory were rechecked. Its age header, byte count and SHA-256 were rechecked
after packaging. The exact-source proof is in
[the package receipt](evidence/learn-build01-live-runtime-package-2026-10-16.json).
The first digest in the key is SHA-256 of `serviceos-live-edge-source-package/1:` followed by the pinned source manifest SHA-256 (`fb1e539b009757b4f17ca55715d8ba254f52fe11202ab52eae50b7fdfc845ca4`);
the second is the encrypted file hash. The existing AWS access policy covers
this project prefix, but using its identities
for application source is a new purpose requiring explicit approval.

After approval, recheck the local file size, hash, mode and age header; inspect
the bucket's current privacy and retention controls; create the object only if
absent; verify its returned version and SHA-256; download that version through
the separate Restore identity; and verify the downloaded byte count and hash.
The [in-memory source verifier](../../scripts/backup/verify_live_runtime_package.py)
can then take one escrow identity through stdin and confirm all 102 function
sources against the pinned manifest without writing the key or source files.
Keep the receipt private and record only sanitized metadata in the tracker. If
any check fails, report that off-site copy is unverified and retain the local
file. Do not overwrite or delete an existing object.

This copy would prove independent retention of encrypted Edge **source**, not
application recovery. A subsequent isolated rehearsal still needs to decrypt
the retrieved package with the escrow key, rebuild and deploy the function
set, restore frontend/runtime configuration and Auth/operator access, and show
controlled capture resumption. The package has no runtime secrets or original
non-exportable Auth signing key. No production database, provider, Slack or
other source write is part of this proposed copy.
