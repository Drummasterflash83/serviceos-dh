# Build 01 LIVE runtime source: exact off-site copy for review

**Prepared 16 October 2026; no upload has occurred.** This review describes
one encrypted application-source object. The earlier approval for an exact
database copy and the standing database backup schedule do not authorize this
separate application archive.

## Exact copy

| Item | Reviewed value |
| --- | --- |
| Source | Retained read-only LIVE Edge source inventory: 102 active functions, 720 source files |
| Local encrypted file | `.verification-results/build01-live-edge-source-20261016.age` (private mode `0600`) |
| Bytes | `5,971,576` |
| SHA-256 | `40f3d703e9febd5c2e93f5ec5491b4423e763a3bc808e7539dfd7233343f3ec5` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; no decryption key in the package or repository |
| Destination account/region | AWS `235099643372`, London `eu-west-2` |
| Existing private bucket | `openfolk-serviceos-database-235099643372-eu-west-2` |
| Proposed exact object key | `projects/tgbnakbxwcqjeimygroz/objects/53aa68e95de4ec1e1a298ed1a835589083c51a58e0934fce4a8d2ba3bd4462c1/40f3d703e9febd5c2e93f5ec5491b4423e763a3bc808e7539dfd7233343f3ec5` |
| Storage controls | TLS; AES256 server-side encryption; versioning; create-only write; 30-day governance retention |
| Access | Existing separate scoped Writer uploads and verifies; Restore independently downloads and hashes the exact object version |

The local package was built only after all source hashes and the saved LIVE
inventory were rechecked. Its age header, byte count and SHA-256 were rechecked
after packaging. The exact-source proof is in
[the package receipt](evidence/learn-build01-live-runtime-package-2026-10-16.json).
The first digest in the key identifies this fixed runtime package descriptor;
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
