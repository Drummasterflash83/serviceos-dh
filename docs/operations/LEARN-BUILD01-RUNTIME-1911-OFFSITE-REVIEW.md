# Build 01 LIVE Edge runtime source: exact post-retry release copy review

**Prepared locally on 16 October 2026. No upload or independent download has run for this exact package.**

The read-only LIVE inventory completed at 19:13:40 UTC with 103 active Edge
functions and 728 source files (4,827,520 source bytes). The function list was
unchanged before and after download. It includes `platform-worker` version 100,
released after the 18:29 package, and `email-workspace-scheduled-sync` version
63. Each file's bytes and SHA-256 are pinned by the private manifest, SHA-256
`40890c5db26d91e71597990c4cecc6d1f5521ddb47563a2925bbb5f8fd31c88b`.

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-1911.age` |
| Bytes and SHA-256 | `6,022,776`; `7cbc837e8e183ceace76cbd5312524c10c0a7f4c10f7dfc1cb1712cbd6e96fac` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; local mode `0600` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/e89ec35412a8709eadf63142873c204a1369659e7f48717d3def8eccc56f84ed/7cbc837e8e183ceace76cbd5312524c10c0a7f4c10f7dfc1cb1712cbd6e96fac` |
| Planned check | Create-only upload through the scoped Writer identity, then download the stored version through the separate Restore identity and compare bytes and SHA-256 |

The first key digest is SHA-256 of `serviceos-live-edge-source-package/1:`
followed by the manifest digest; the second is the ciphertext digest. The
exact-copy code rechecks the private bucket, TLS, encryption, versioning and
30-day governance retention before writing. This review **supersedes the
unanswered 18:29 copy request** because that package predates the LIVE worker
release. The copy does not write production data, contact providers, change
Slack or deploy code. The source package lacks runtime secret values, Auth
signing material and frontend configuration; copying it is one recovery input,
not full service recovery.
