# Build 01 LIVE runtime refresh: exact off-site source copy for review

**Prepared 16 October 2026; not uploaded or approved as a new copy.** The
previously approved London object remains retained, but it covers the older
102-function inventory. The current read-only source inventory contains 103
active functions and 727 files, including the current worker and signed Slack
Events route. [Sanitised local receipt](evidence/learn-build01-live-runtime-refresh-1707-2026-10-16.json).

| Item | Exact prepared value |
| --- | --- |
| Local ciphertext | `.verification-results/build01-live-edge-source-2026-10-16-1705.age` |
| Bytes and SHA-256 | `6,012,536`; `e0c3cbdb8ff2fded1ab5cf879806f8b580a1278f07bfc513290ca3ccab7b2f17` |
| Source manifest SHA-256 | `aae49320a450de450ce56e8b6f8e781cfade9b51bace8d0934edc149beb8cbfc` |
| Encryption | age X25519 to the existing public ServiceOS recovery recipient; local mode `0600` |
| Destination | Existing private AWS London bucket `openfolk-serviceos-database-235099643372-eu-west-2` |
| Exact object key | `projects/tgbnakbxwcqjeimygroz/objects/120b1e3083e80b80e7d623867c1066e782f85a52b7e70c6a8879939245c9833e/e0c3cbdb8ff2fded1ab5cf879806f8b580a1278f07bfc513290ca3ccab7b2f17` |
| Proposed verification | Recheck local mode, bytes and hash; create-only upload with the existing scoped Writer identity; download that object version with the separate Restore identity; match its bytes and hash |

The first hash in the key is SHA-256 of
`serviceos-live-edge-source-package/1:` followed by the source manifest hash;
the second is the ciphertext hash. The upload must recheck the destination's
privacy, TLS, server-side encryption, bucket versioning and 30-day governance
retention before writing, as in the previously approved source copy. The new object is distinct and
requires fresh authorization before upload. No production database write,
source-provider request, Slack message or deployment is part of the copy.

This preserves **source**, not an Auth key, runtime secret values, frontend
configuration or a working recovered service. Decrypting with escrow and
rebuilding the isolated application remain separate recovery checks.
