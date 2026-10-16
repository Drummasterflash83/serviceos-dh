# Build 01 application and Auth restore inventory

**16 October 2026 — preparation, not a full-service restore receipt.** The
isolated database/Auth/PostgREST rehearsal and the full Edge source-package
round trip prove distinct parts of recovery. Neither proves that an independently
recovered OpenFolk service can serve clients or resume ingestion.

## Components that must agree

| Component | Preserved or verified input | Still required for full recovery |
| --- | --- | --- |
| Database and Vault | Encrypted independent snapshot; isolated native restore and Vault comparison | Restore from a current off-site version and reconcile its point in time with file/object backups |
| Auth and tenant access | Offline Auth and PostgREST boot with a new synthetic signing key; fresh synthetic login, tenant RLS and audited operator grant/revocation passed | Recover the supported real-user login path, reset sessions if the non-exportable original signing key is unavailable, and check operator routes through the recovered application |
| Edge functions | 102 LIVE function sources and 720 files retained; every file survived a disposable-key encrypt/decrypt round trip | Independently retain and retrieve the exact encrypted archive; rebuild/deploy all activated functions with their verified flags and secret references; exercise real routes in an isolated service |
| Frontend | Vercel builds from Git `main`; four LIVE aliases and protected LEARN/Drummonds view checked at `0266c7f7` | Restore a pinned Git revision to an isolated Vercel target with its production-equivalent public configuration, then test login, client cards and operator paths before any alias switch |
| Runtime configuration | Static source scan found 56 literal Edge environment names plus 18 dynamic lookups across the 102 function archives; the frontend references `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ENABLE_SIGNUP` | Independently inventory actual configured names, non-exportable and dynamic-name references, escrow/restore secret values through an approved channel, and verify each recovered function's access without printing values |
| Capture and files | Separate recording/voicemail manifests and database-reference restore checks exist | Match the chosen database point to its corresponding file inventory; keep dispatchers paused until scopes, cursors and credentials are verified; resume one bounded source at a time and prove new data reaches the correct tenant/card |

The static Edge name count is a source-code observation only. It does not say
that all 56 names are configured or required in LIVE, nor that the 18 dynamic
lookups represent 18 distinct secrets. Several dynamic names come from saved
workspace/provider configuration. No secret values were read or saved for this
inventory. The LIVE Slack Events receiver is still default-off in TEST and is
outside the 102-function LIVE archive.

At 04:23 UTC on 16 October, a separate read-only LIVE secret-metadata readback
found 54 configured names. Of 53 literal source names that are not platform-
injected, 42 appear in that inventory and 11 do not. This is an exact name
comparison, not a claim that the 11 are all required: some guarded features
have a fallback or are inactive. The 18 dynamic lookups still need binding
analysis. Only names and metadata digests were handled; no plaintext values
were printed or saved. [Sanitised name readback](evidence/learn-build01-runtime-secret-name-readback-2026-10-16.json).

An acceptance rehearsal must start from independently retrieved ciphertext and
document the exact database, file, source and Git revisions. It must use an
isolated service, private networking and disposable recipients where feasible,
then verify client isolation, operator audit, card/source fidelity and a
controlled capture restart. A successful byte copy or source compile must not
be labelled full application recovery. Neither this inventory nor the existing
database rehearsal authorizes production failover or a source-provider write.
