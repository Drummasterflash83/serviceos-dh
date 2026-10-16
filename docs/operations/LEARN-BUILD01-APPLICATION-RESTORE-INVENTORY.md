# Build 01 application and Auth restore inventory

**16 October 2026 — preparation, not a full-service restore receipt.** The
isolated database/Auth/PostgREST rehearsal and the full Edge source-package
off-site copy prove distinct parts of recovery. Neither proves that an independently
recovered OpenFolk service can serve clients or resume ingestion.

## Components that must agree

| Component | Preserved or verified input | Still required for full recovery |
| --- | --- | --- |
| Database and Vault | Encrypted independent snapshot; isolated native restore and Vault comparison | Restore from a current off-site version and reconcile its point in time with file/object backups |
| Auth and tenant access | Offline Auth and PostgREST boot with a new synthetic signing key; fresh synthetic login, tenant RLS and audited operator grant/revocation passed | Recover the supported real-user login path, reset sessions if the non-exportable original signing key is unavailable, and check operator routes through the recovered application |
| Edge functions | 102 LIVE function sources and 721 files retained in the 06:30 UTC package; the exact age-encrypted package was copied to the existing private London bucket and independently downloaded by the Restore identity with matching bytes and SHA-256; 04:30 UTC metadata readback matched the prior 102-function inventory's slug/version/JWT flags (42 JWT-on, 60 JWT-off) | Decrypt the downloaded package through escrow, rebuild/deploy all activated functions with their verified flags and secret references, and exercise real routes in an isolated service |
| Frontend | Vercel builds from Git `main`; four LIVE aliases and protected LEARN/Drummonds view checked at `0266c7f7` | Restore a pinned Git revision to an isolated Vercel target with its production-equivalent public configuration, then test login, client cards and operator paths before any alias switch |
| Runtime configuration | Static source scan found 56 literal Edge environment names plus 18 dynamic lookups across the 102 function archives; the frontend references `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ENABLE_SIGNUP` | Independently inventory actual configured names, non-exportable and dynamic-name references, escrow/restore secret values through an approved channel, and verify each recovered function's access without printing values |
| Capture and files | Separate recording/voicemail manifests and database-reference restore checks exist | Match the chosen database point to its corresponding file inventory; keep dispatchers paused until scopes, cursors and credentials are verified; resume one bounded source at a time and prove new data reaches the correct tenant/card |

The static Edge name count came from the earlier 720-file inventory and is a
source-code observation only. It does not say
that all 56 names are configured or required in LIVE, nor that the 18 dynamic
lookups represent 18 distinct secrets. Several dynamic names come from saved
workspace/provider configuration. No secret values were read or saved for this
inventory. The LIVE Slack Events receiver is still default-off in TEST and is
outside the 102-function LIVE archive.

At 07:11 UTC the newer 721-file encrypted source package was independently
retained and downloaded. Its separate Restore readback matched the exact
5,971,576 bytes and SHA-256; [the sanitized receipt](evidence/learn-build01-live-runtime-offsite-copy-2026-10-16.json)
records the fixed object and retention controls. A single 1Password escrow
read for in-memory decrypt did not complete, so decryption of the downloaded
object and function startup remain unverified.

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
