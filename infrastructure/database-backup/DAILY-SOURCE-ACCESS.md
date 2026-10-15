# Daily independent database source access

Status on 15 October 2026: **dedicated production reader installed and tested;
daily schedule not activated**. Chris approved this standing access, including
whole-project Auth and encrypted Vault reads, for the narrowly scoped daily
runner. The approved runtime still needs a reliable host, missed-success alarm
and full source-to-off-site rehearsal before daily operation can be accepted.

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
standing access was approved as a specific access expansion before installation.

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

The role was created only after TEST and LIVE rollback rehearsals. LIVE readback
confirmed `LOGIN`, `BYPASSRLS`, `pg_read_all_data`, no administrator/role-creation
privileges, and `default_transaction_read_only=on`. A direct TLS login proved
read access to `auth.users` and `vault.secrets` without reading any customer
rows. Its generated password was stored and read back through the exact local
Keychain item via Security.framework stdin, without a biometric prompt, command
argument, log or Git file. This local item is for the first live rehearsal;
the hosted runtime must receive its own scoped secret before scheduling.

A fresh live source export began at 15:44 UTC on 15 October. It must complete
its isolated native restore, public-key encryption, off-site copy and independent
download before this attempt counts. The separate recovery-key restore, reliable
host, 26-hour missed-success alarm and sustained schedule remain open. Daily
independent backup is **not accepted** yet. Supabase's provider-managed daily
backup is a separate recovery layer and does not prove this independent export.
