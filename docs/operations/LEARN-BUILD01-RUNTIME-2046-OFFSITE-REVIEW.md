# Build 01 LIVE Edge runtime source: exact current-worker copy review

**Prepared and copied 16 October 2026.** The exact approved create-only Writer
upload completed at 21:10:50 UTC. The separate Restore identity downloaded the
stored object version and verified its 6,022,776 bytes and SHA-256. See the
[sanitised copy receipt](evidence/learn-build01-runtime-2046-offsite-copy-2026-10-16.json).

A stable, read-only LIVE inventory completed at 20:48:20 UTC with 103 active
Edge functions and 728 source files (4,828,391 source bytes). It includes
`platform-worker` version 104, which runs the bounded 40-card continuation,
and the current Email and signed Slack Events functions. The function list was
unchanged before and after download. Every file's bytes and SHA-256 are pinned
by the private manifest with SHA-256
`f9dc270c53c5a964b436b70bed3d6da2b06f9810ea330ee45444b8c3de931da8`.

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-2046.age` |
| Bytes and SHA-256 | `6,022,776`; `afc78ae97474bb2c4d0ce885aeff7fedf1c50098193c016b3f369fba35604bf7` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; local mode `0600` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/57b2d97692c211f09a10c1503d71329a89ee03f0e5b0da5afeb7e63fb8c35927/afc78ae97474bb2c4d0ce885aeff7fedf1c50098193c016b3f369fba35604bf7` |
| Planned check | Create-only upload through the scoped Writer identity, then download that stored version through the separate Restore identity and compare bytes and SHA-256 |

The first key digest is SHA-256 of `serviceos-live-edge-source-package/1:`
followed by the manifest digest; the second is the ciphertext digest. The
exact-copy code rechecks the private bucket, TLS, encryption, versioning and
30-day governance retention before writing. This package supersedes the 19:11
source package after the card-worker release. No production data, source
provider, Slack or deployment write is involved. This source package has no
runtime secret values, Auth signing material or frontend configuration, so
its off-site retention alone does not prove complete application recovery.
