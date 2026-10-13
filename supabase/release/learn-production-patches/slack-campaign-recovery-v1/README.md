# Exact Slack campaign recovery patch

Prepared only. Apply before the matching worker runtime and operator UI. This is
an additive patch after the source-replay release; it is not a numbered release
package and must not be silently inserted into an already-published package.

Set the reviewed `serviceos.release_target` and `serviceos.release_sha256` to the
manifest project and source hash, using existing postgres maintenance authority.
`apply.sql` checks exact prior definitions and ACLs before the transaction. It
creates two private immutable tables and narrow helper functions, and patches
only the existing campaign dispatcher and job-authority check.

No membership change, access grant to a user, credential, scheduled job, import or
provider request is created. The authenticated recovery reader uses existing
logged controls. Service diagnostics require the active worker lease and a
charged campaign dispatch; they contain structural labels only.

`rollback.sql` refuses active recovery jobs, restores the exact two previous
functions, and revokes the new helper/reader access. It retains requests,
diagnostics, source records and checkpoints. Restore the exact prior worker
artifacts as a separate reviewed runtime rollback.

Operational scope and acceptance: `docs/operations/LEARN-SLACK-CAMPAIGN-RECOVERY.md`.
