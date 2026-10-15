# Daily independent database source access — reviewed candidate

Status: **prepared, not activated**. This file does not grant permission to
create a production login or turn on a schedule.

The 15 October read-only production preflight found 421 physical user tables,
398 using RLS, no large objects and no `serviceos_backup_reader` role. The
existing manual exporter refreshes a temporary `cli_login_postgres` login with
postgres privileges through the Management API. That flow is useful for a
supervised checkpoint but is not a suitable unattended source credential.

[Supabase's backup-role guidance](https://supabase.com/docs/guides/troubleshooting/pg_dump-fails-with-query-would-be-affected-by-row-level-security-policy-1d5783)
explains that a complete `pg_dump` of RLS tables needs `BYPASSRLS` plus
`pg_read_all_data`. That grants broad visibility across this whole production
project, including Auth and encrypted Vault rows. `default_transaction_read_only`
is a safeguard, **not an immutable read-only privilege**: the role can change its
session setting and may inherit writes through `PUBLIC` functions. This new
standing access must be reviewed as a specific access expansion before use.

The candidate is one login named `serviceos_backup_reader`, with `LOGIN`,
`BYPASSRLS`, `pg_read_all_data`, no superuser/createdb/createrole/replication
privileges, a time-limited randomly generated password and
`default_transaction_read_only=on`. It must have no membership in `postgres`
or application operator roles. Its password belongs only in the narrowly
scoped daily runtime's secret store; a local rehearsal may use the exact
`OpenFolk.ServiceOS.DatabaseSource.Reader` Keychain item for project
`tgbnakbxwcqjeimygroz`. Never put it in Git, command arguments, logs, or a
general Codex/1Password service account.

The prepared `--export-unattended-daily` runner pins the project and TLS host,
uses the dedicated login directly, verifies `current_user`, `session_user` and
`transaction_read_only=on`, takes one consistent read-only snapshot, and uses
native `pg_dump` without `SET ROLE postgres`. It makes no Management API
credential refresh. A fresh daily output must pass an isolated native restore
before public-key encryption and independent copy; the recovery key is used
only for a separate restore drill. The real existing 10:04 UTC snapshot was
successfully packaged in this keyless daily format locally on 15 October;
that is a package-format test, not a fresh daily export or off-site acceptance.

Activation requires a reviewed role/secret change, a reliable host and missed
success alarm, a TEST rehearsal of the full source-to-restore chain, and a
separate LIVE release with exact access, source and recovery evidence. No
production login, new secret, schedule, object transfer, or source write was
created by this candidate. Until those gates pass, daily independent backup is
**not accepted**. Supabase's own daily backup is a separate provider-managed
recovery layer and does not prove this independent export.
