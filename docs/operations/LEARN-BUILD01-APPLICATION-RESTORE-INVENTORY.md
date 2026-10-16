# Build 01 application and Auth restore inventory

**16 October 2026 — preparation, not a full-service restore receipt.** The
isolated database/Auth/PostgREST rehearsal and the full Edge source-package
off-site copy prove distinct parts of recovery. Neither proves that an independently
recovered OpenFolk service can serve clients or resume ingestion.

At 20:48 UTC, a new stable, read-only LIVE source inventory captured **103**
active functions and **728** files (4,828,391 source bytes), including the
40-card `platform-worker` version 104. Manifest SHA-256
`f9dc270c53c5a964b436b70bed3d6da2b06f9810ea330ee45444b8c3de931da8`
and every retained file hash passed local verification. It was encrypted to
the existing public recovery recipient as a 6,022,776-byte local package,
SHA-256 `afc78ae97474bb2c4d0ce885aeff7fedf1c50098193c016b3f369fba35604bf7`.
The [exact approved off-site copy](LEARN-BUILD01-RUNTIME-2046-OFFSITE-REVIEW.md)
completed at 21:10 UTC. The separate Restore identity downloaded the stored
version and matched its bytes and hash. This package has not been decrypted,
and the full frontend/runtime/Auth restore remains unverified.

The same verified local source inventory was reconstructed into **103 separate
function trees** with all **728 files / 4,828,391 bytes** hash-checked again.
Separate trees preserve each deployed function's own `_shared` closure, since
shared file versions can differ across serving functions. This is local build
preparation only; no all-function bundle/startup or independently downloaded
source decryption has been claimed. The repeatable staging tool is
`scripts/backup/stage_reviewed_live_edge_sources.py`.

At 18:17 UTC, the LIVE `email-workspace-scheduled-sync` function advanced from
version 62 to 63 for bounded unattended mailbox-authority rechecks. The
17:07/17:20 source package below predates that release. It remains a verified
off-site snapshot, but **no longer represents every serving LIVE function**.
Prepare and independently copy a new exact inventory before calling the
application-source recovery input current. The repository TEST checkpoint
`ed581c7c` preserves the new scheduler source; it is not a substitute for
restoring the deployed runtime and configuration.

At 19:09 UTC, LIVE `platform-worker` advanced to version 100 for a bounded
older Email retry. The 18:29 archive below predates it. A fresh stable
read-only inventory completed at 19:13 UTC: 103 active functions, 728 files and
4,827,520 source bytes, including worker v100. It was packaged locally into
6,022,776 encrypted bytes with SHA-256
`7cbc837e8e183ceace76cbd5312524c10c0a7f4c10f7dfc1cb1712cbd6e96fac`.
The copy and separate Restore download are [prepared for exact review](LEARN-BUILD01-RUNTIME-1911-OFFSITE-REVIEW.md),
not yet performed. The one-route isolated recovery proof remains valid for its
archived route, but it is not a full current service restore.

At 18:29 UTC, a stable read-only LIVE archive captured 103 functions and
728 source files, including that version 63 scheduler. Its manifest and every
file hash passed local packaging to the existing public recovery recipient.
The resulting 6,022,776-byte age ciphertext has SHA-256
`796eb3f9ee44e2f233ca244d8fed1f0a2463d266cb74e8c774d7e7aaa73e5a0a`.
It is still **local only**; the distinct exact off-site copy awaits approval.
[Exact prepared review](LEARN-BUILD01-RUNTIME-1828-OFFSITE-REVIEW.md).

At 18:43 UTC, the exact five archived files for serving
`learn-launch-status` version 10 were reconstructed and hash-checked against
that manifest. The pinned local Edge runtime image bundled them after fetching
the source's pinned public `esm.sh` dependency. A fully network-disabled bundle
failed because that dependency is not inside the source package. The resulting
bundle started in a disposable container with no network, host ports,
production credentials or production data. OPTIONS returned HTTP 200 and a
synthetic POST without configuration returned HTTP 503 `config_error`; cleanup
removed the container. This proves source reconstruction, bundle/startup and a
fail-closed boundary for one route. It does **not** prove authenticated reads,
frontend startup, 103-function rebuild, secret recovery or capture restart.
[Sanitised isolated startup receipt](evidence/learn-build01-isolated-edge-startup-2026-10-16.json).

At 18:57 UTC, an opt-in combined drill restored the independently checked
database archive and started isolated Auth, PostgREST, a pinned local gateway,
and that exact archived Edge route. A newly created synthetic user logged in,
the gateway verified the user and tenant REST boundary, and the Edge route
returned tenant-scoped LEARN status with nonempty Phone and Email counts.
Unassigned and cross-tenant card reads remained isolated; an operator read was
audited and denied after the synthetic grant was revoked. All five disposable
containers were removed. The gateway has no external network or host port, and
no real user or production write was involved. This is meaningful application
service recovery evidence, but it covers **one** archived route, a new synthetic
signing key and a local archive; it does not establish the full frontend,
all 103 functions, real runtime-secret restoration or source restart.
[Sanitised combined receipt](evidence/learn-build01-isolated-auth-edge-recovery-2026-10-16.json).

At 17:07 UTC, a fresh read-only LIVE inventory retained the current **103**
active Edge functions and **727** source files, including the newly released
worker and signed Slack Events receiver. The exact source hashes and stable
function inventory were checked, then the package was age-encrypted locally
to the existing public recovery recipient at mode `0600`. Its SHA-256 is
`e0c3cbdb8ff2fded1ab5cf879806f8b580a1278f07bfc513290ca3ccab7b2f17`.
At 17:20 UTC, this exact newer package was copied to the existing private
London bucket and downloaded by the separate Restore identity. Its 6,012,536
bytes and SHA-256 matched. Escrow decryption of this **newer** package remains
unverified; the prior 102-function package was decrypted at 08:07 UTC.
[Sanitised refresh receipt](evidence/learn-build01-live-runtime-refresh-1707-2026-10-16.json)
and [off-site copy receipt](evidence/learn-build01-live-runtime-refresh-offsite-copy-2026-10-16.json).

## Components that must agree

| Component | Preserved or verified input | Still required for full recovery |
| --- | --- | --- |
| Database and Vault | Encrypted independent snapshot; isolated native restore and Vault comparison | Restore from a current off-site version and reconcile its point in time with file/object backups |
| Auth and tenant access | Offline Auth and PostgREST boot with a new synthetic signing key; fresh synthetic login, tenant RLS and audited operator grant/revocation passed | Recover the supported real-user login path, reset sessions if the non-exportable original signing key is unavailable, and check operator routes through the recovered application |
| Edge functions | The earlier 102-function, 721-file package was copied, downloaded and decrypted with its manifest verified. The current 103-function, 728-file v104 package is encrypted, copied off site and independently downloaded with matching bytes/hash. One archived route passes an isolated authenticated tenant read. | Decrypt/rebuild all activated functions with their verified flags and secret references and exercise their required routes in an isolated service |
| Frontend | Vercel builds from Git `main`; the four LIVE aliases and protected LEARN/Drummonds view were checked at `0266c7f7`. The later Slack handoff UI revision `ecfa0aa4` passed both TEST and LIVE Git/Vercel build statuses. | Verify the later signed-in LIVE UI, then restore a pinned Git revision to an isolated Vercel target with its production-equivalent public configuration and test login, client cards and operator paths before any alias switch |
| Runtime configuration | Static source scan found 56 literal Edge environment names plus 18 dynamic lookups across the 102 function archives; the frontend references `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ENABLE_SIGNUP` | Independently inventory actual configured names, non-exportable and dynamic-name references, escrow/restore secret values through an approved channel, and verify each recovered function's access without printing values |
| Capture and files | Separate recording/voicemail manifests and database-reference restore checks exist | Match the chosen database point to its corresponding file inventory; keep dispatchers paused until scopes, cursors and credentials are verified; resume one bounded source at a time and prove new data reaches the correct tenant/card |

The static Edge name count came from the earlier 720-file inventory and is a
source-code observation only. It does not say
that all 56 names are configured or required in LIVE, nor that the 18 dynamic
lookups represent 18 distinct secrets. Several dynamic names come from saved
workspace/provider configuration. No secret values were read or saved for this
inventory. The LIVE Slack Events receiver is active for the approved public-
channel roster and is included in the newer 103-function LIVE archive. It
remains default-off in TEST outside bounded synthetic verification.

At 07:11 UTC the earlier 721-file encrypted source package was independently
retained and downloaded. Its separate Restore readback matched the exact
5,971,576 bytes and SHA-256; [the sanitized receipt](evidence/learn-build01-live-runtime-offsite-copy-2026-10-16.json)
records the fixed object and retention controls. A single 1Password escrow
read for in-memory decrypt initially expired. A fresh owner-approved Touch ID
read at about 08:07 UTC succeeded: the downloaded object's 721 files and 102
function entries matched the decrypted source manifest, with no key persistence
or source extraction to disk. [Decryption receipt](evidence/learn-build01-live-runtime-decrypt-2026-10-16.json).
Function startup and end-to-end application recovery remain unverified.

At 04:23 UTC on 16 October, a separate read-only LIVE secret-metadata readback
found 54 configured names. Of 53 literal source names that are not platform-
injected, 42 appear in that inventory and 11 do not. This is an exact name
comparison, not a claim that the 11 are all required: some guarded features
have a fallback or are inactive. The 18 dynamic lookups still need binding
analysis. Only names and metadata digests were handled; no plaintext values
were printed or saved. At 04:26 UTC, a read-only tenant-scoped binding check
found one Drummonds workspace with two distinct dynamic secret names; both are
configured. None of the generic `PROVIDER_OAUTH_*` names is configured, while
the current tenant's provider connections contain no active OAuth-mode row.
The seven constructed OAuth lookups in two functions therefore remain an
inactive generic-framework recovery path, not an observed active-connection
failure. This narrows the dynamic-name inventory without proving secret value
recovery. [Sanitised name readback](evidence/learn-build01-runtime-secret-name-readback-2026-10-16.json).

At 04:30 UTC, a fresh read-only LIVE function-list comparison matched all 102
retained slug/version/JWT-flag triples exactly; 42 functions require gateway JWT
verification and 60 do not. This pins deploy flags and shows the saved source
inventory was still current at that moment. It does not prove a recovered
runtime can start or authenticate a user.

An acceptance rehearsal must start from independently retrieved ciphertext and
document the exact database, file, source and Git revisions. It must use an
isolated service, private networking and disposable recipients where feasible,
then verify client isolation, operator audit, card/source fidelity and a
controlled capture restart. A successful byte copy or source compile must not
be labelled full application recovery. Neither this inventory nor the existing
database rehearsal authorizes production failover or a source-provider write.
