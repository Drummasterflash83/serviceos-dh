# Build 01 LIVE Edge runtime source: current exact off-site copy review

**Prepared locally on 16 October 2026; upload and independent download are not yet authorized or performed for this exact package.**

The read-only LIVE inventory completed at 18:29:41 UTC with 103 active Edge
functions and 728 source files (4,827,289 source bytes). The function list was
unchanged before and after download. It includes
`email-workspace-scheduled-sync` version 63, released after the prior off-site
package. Each downloaded file and its size and SHA-256 are pinned by the
private manifest, whose SHA-256 is
`ba8cfeca045cd82c8aab5027a958ba2e91cecdb2ff32b4b9ed7437a7e1eb6dc5`.

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-1828.age` |
| Bytes and SHA-256 | `6,022,776`; `796eb3f9ee44e2f233ca244d8fed1f0a2463d266cb74e8c774d7e7aaa73e5a0a` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; local mode `0600` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/58dc9f5d80110646fcd4d7f7922541cd7f1c28b9e1bfafcaf084ebe72e7bb6ce/796eb3f9ee44e2f233ca244d8fed1f0a2463d266cb74e8c774d7e7aaa73e5a0a` |
| Planned check | Create-only upload through the existing scoped Writer identity, then download the stored version through the separate Restore identity and compare bytes and SHA-256 |

The first digest in the key is SHA-256 of
`serviceos-live-edge-source-package/1:` followed by the manifest digest; the
second is the ciphertext digest. The exact-copy code rechecks private bucket,
TLS, encryption, versioning and 30-day governance retention before writing.
This object is distinct from the earlier approved package. No production
database write, provider request, Slack write or deployment is part of the
copy. The source package still lacks runtime secret values, Auth signing
material and frontend configuration; copying it does not prove service recovery.
