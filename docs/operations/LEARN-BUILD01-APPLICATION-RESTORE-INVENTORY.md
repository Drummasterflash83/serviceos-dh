# Build 01 application and Auth restore inventory

**16 October 2026 — preparation, not a full-service restore receipt.** The
isolated database/Auth/PostgREST rehearsal and the full Edge source-package
off-site copy prove distinct parts of recovery. Neither proves that an independently
recovered OpenFolk service can serve clients or resume ingestion.

At 18:17 UTC, the LIVE `email-workspace-scheduled-sync` function advanced from
version 62 to 63 for bounded unattended mailbox-authority rechecks. The
17:07/17:20 source package below predates that release. It remains a verified
off-site snapshot, but **no longer represents every serving LIVE function**.
Prepare and independently copy a new exact inventory before calling the
application-source recovery input current. The repository TEST checkpoint
`ed581c7c` preserves the new scheduler source; it is not a substitute for
restoring the deployed runtime and configuration.

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
| Edge functions | The earlier 102-function, 721-file package was copied, downloaded and decrypted with its manifest verified. The current 103-function, 727-file LIVE package was independently copied and downloaded with matching bytes and SHA-256. | Decrypt the current package with escrow, rebuild/deploy all activated functions with their verified flags and secret references, and exercise real routes in an isolated service |
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
