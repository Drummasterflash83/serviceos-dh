# Slack source-review patch

Prepared only. This additive release retains exactly the observed undocumented `welcome_party` subtype as `source_needs_review`, never as conversation or inferred system activity. SQL installation neither retries failed pages nor enables capture.

`apply.sql` is the reproducible guarded transaction for production maintenance as the existing `postgres` owner. Set `serviceos.release_target` and `serviceos.release_sha256` to the manifest values before applying. It verifies all nine prior function definitions and their owner/ACL, then verifies the exact resulting definitions before commit. It needs no temporary or permanent role grant. Do not apply the numbered migration separately and then replay this envelope.

Install SQL first, publish matching immutable Slack/platform artifacts second, and use the existing logged exact-page recovery control only after reviewed readback. Previous runtime stays conservative while SQL is being installed. The welcome-only runtime preserves the voicemail, source-replay and structural diagnostics closures.

`rollback.sql` restores the prior four function bodies only when no held welcome_party source exists and no Slack page lease is running. It refuses rollback after retention: keep the additive classifier and durable reader, and revert the runtime if needed. Never remove retained sources or reinterpret held sources as activity to force rollback.

Private deployment plans hold current environment fingerprints and immutable runtime artifacts; they are excluded from Git. Their exact source hashes bind to this manifest. No plan or journal is replayed after an uncertain outcome; reconcile read-only first.
