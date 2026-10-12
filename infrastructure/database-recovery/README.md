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
encrypted. A native export and offline restore have not yet been executed.

Private journals under `.verification-results/database-login-preflight/` use
exclusive creation. **Do not remove an existing journal merely to retry.** Read
the outcome and current role metadata first. A `refresh_requested` state with no
response is ambiguous and must not trigger another automatic refresh. Completed
attempts are retained; a later reviewed run must use a separate journal.

See [the recovery runbook](../../docs/operations/LEARN-DATA-RECOVERY.md). Passing
this connection check is not a database restore, recording restore, or release
approval. Actual database export and isolated restore still need their own
integrity, relationship and application checks.
