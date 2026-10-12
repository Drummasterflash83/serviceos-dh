# Production recovery connection

The certificate here is a **public CA certificate**, not a credential or private
key. It was downloaded over verified HTTPS from the URL configured in the
[official Supabase dashboard](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json):

`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

SHA-256: `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`.
Its validity ends on 26 April 2031. Review an official replacement before that
date or when Supabase changes its certificate chain. Do not disable CA/hostname
verification to work around a failure.

`scripts/backup/verify-production-database-login.mjs` is a narrowly scoped
preflight for production project `tgbnakbxwcqjeimygroz`. It uses the existing
Supabase CLI login in macOS Keychain and the installed pinned PostgreSQL 17.6
image. The temporary database credential has `postgres` privileges; the query
session explicitly starts a read-only transaction. Startup `PGOPTIONS` were
ignored by the hosted pooler in the verified run. It is not a least-privilege
backup role.

The preflight refuses a missing or differently configured CLI database role.
It also refuses an active credential unless the journal proves it came from
the specific, completed prior metadata-check attempt. Its one refresh request may renew production authentication for the
provider-returned short duration. It does not reset the owner password, change
role membership or network bans, write customer data, or download a backup.
No secret appears in command arguments, Docker configuration, logs, or the
report. A completed client exits and is removed; password expiration is checked
separately because it does not terminate pre-existing sessions.

The completed 12 October run verified client-to-pooler TLS and read-only SQL.
The PostgreSQL `pg_stat_ssl` field separately reported no TLS on the pooler's
upstream connection. Do not conflate these two boundaries or claim both were
encrypted. The later native export/restore result is described below.

Private journals under `.verification-results/database-login-preflight/` use
exclusive creation. **Do not remove an existing journal merely to retry.** Read
the outcome and current role metadata first. A `refresh_requested` state with no
response is ambiguous and must not trigger another automatic refresh. Completed
attempts are retained; a later reviewed run must use a separate journal.

See [the recovery runbook](../../docs/operations/LEARN-DATA-RECOVERY.md). Passing
this connection check is not a database restore, recording restore, or release
approval. Export, restore, integrity and application checks are separate gates.

## Native archive and offline restore

The real 12 October production archive restored in a disposable local database.
See the [result and remaining gaps](../../docs/operations/evidence/learn-real-native-restore-2026-10-12.json).

- `export-production-database.mjs` pins production, refreshes its existing temporary
  CLI login and uses a verified TLS client/read-only snapshot. Archive and comparison
  files stay private. Native COPY handling for pg_net's omitted table data is
  prepared, but that improvement has not yet run against production.
- `restore_production_database.py` validates the archive digest, recreates role
  metadata without role passwords and restores into a new offline container
  matching production. An incomplete source comparison is reported explicitly.
- `verify_database_native_restore.py` exercises native archive/COPY restore with
  synthetic tenant records, an active cron job and a queued HTTP request. Neither
  scheduled action runs: all worker slots, cron launch and networking are disabled.

Completed runs retain exclusive private journals. Do not remove markers to rerun
them. A new capture needs a reviewed new run directory, bounded production load,
complete comparison evidence and separate credential/session cleanup. The local
archive is not the independently retained backup service. Vault decryption,
external audio recovery and application resumption remain separate requirements.

## Combined audio check

`restore_production_database.py --combined-audio` extracts recording/object/call/
transcript links from the actual offline restore into a private checkpoint.
`check-restored-database-audio.mjs` compares them with the existing AWS manifest,
validates and decodes one linked file using the Restore identity, and removes its
temporary audio. The 12 October audio phase resumed from unchanged metadata after
the initial selector found all database durations null. Its successful result is
recorded separately from the stopped attempt.

All 2,882 references matched; one file was downloaded and decoded. These are
different database/file snapshot times, not an atomic recovery point. The scripts
do not invoke production, create accounts, load the Writer credential or send
recordings to another service. See the
[combined evidence](../../docs/operations/evidence/learn-combined-database-audio-restore-2026-10-12.json).

## Offline archive-content comparison

`restore_production_database.py --compare-native` has a separate exclusive
`restore-native-comparison-started` journal. The completed 12 October run must not
be repeated by deleting its marker. It verifies the archive digest, restores into
the existing offline boundary, then compares original `pg_restore --data-only`
COPY output with a fresh `pg_dump --data-only` of that restored database.

`native_copy_fingerprints.py` streams opaque native row bytes, sorts per-row SHA-256
hashes within each table (preserving duplicates), and compares table names, column
order, row counts, hashes and sequence values. It rejects unknown framing,
truncation, duplicate tables and exceeded bounds. SQL-looking row content remains
data and is never executed by this parser. Raw row output is not logged or saved;
hash/count metadata stays in private ignored files. PostgreSQL stderr is privately
drained and discarded, with safe fixed failure messages.

All 299 archived tables/1,591,576 rows and five sequence values matched. A real
synthetic native restore also passed and a deliberately altered row was rejected.
This proves restoration fidelity to the archive without another production scan;
it cannot establish capture of the two omitted pg_net tables or recover Vault's
external encryption key. See the
[sanitized evidence](../../docs/operations/evidence/learn-native-archive-comparison-2026-10-12.json).

## Capture with omitted operational tables included

The separately journaled `--export-complete-capture-v2` run uses
`.verification-results/production-database-complete-capture-v2-2026-10-12`.
It captures the two pg_net tables through native COPY with an explicit column
inventory inside the same read-only snapshot as the archive. The queue sequence
is recorded separately and explicitly remains nontransactional. It skips the
expensive live aggregate fingerprint pass; fidelity is verified offline.

`restore_production_database.py --complete-capture-v2` verifies both file digests,
compares all native archive rows, applies and compares both supplemental tables,
and checks that the union covers every physical table in the source inventory.
It does not run restored jobs or queued HTTP requests. Synthetic verification
covers actual queued data and rejects tampering in both ordinary and pg_net rows.
Vault decryption and application/Auth startup remain separate acceptance gates.

After export, `check-production-recovery-cleanup.mjs --check-complete-capture-v2`
reads only health, CLI expiration/membership/session counts and local export
container counts. Each observation is retained separately. A healthy query is
not proof of credential expiration: inspect `cliExpired` and `cliExpiresAt`.
No automatic credential refresh, reset, session termination or mutation retry is
performed by this check. Completed/uncertain run directories must never be removed
to retry; inspect the specific stage and authoritative process state first.

**Actual v2 outcome:** stopped after the native dump emitted zero bytes and
Management SQL timed out. Both clients were removed. The two operational tables
were captured, but there is no complete matching native archive. SQL cleanup and
Auth health subsequently passed without a restart. Diagnose the health/connection
issue before a new capture. Do not retry the retained v2 directory or combine
its supplement with the earlier archive as if they shared one snapshot.
[Attempt evidence](../../docs/operations/evidence/learn-complete-capture-attempt-2026-10-12.json).

Provider diagnostics used the documented [service-health endpoint](https://supabase.com/docs/reference/api/v1-get-services-health),
[metrics endpoint](https://supabase.com/docs/reference/api/v1-scrape-project-metrics)
and [bounded log queries](https://supabase.com/docs/guides/observability/advanced-log-filtering).
Project-level `ACTIVE_HEALTHY` alone did not establish Auth health; query the named
service and verify actual database access separately.
