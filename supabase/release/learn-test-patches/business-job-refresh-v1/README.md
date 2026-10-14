# Job refresh TEST alignment — backend installed and verified; frontend pending

The TEST backend previously lacked LIVE's private Slack capture-proof tables and customer
job-context reader. align-context.sql adds that exact bounded read path and its
fenced attestation writer, with the existing restricted reader role restored after
maintenance. It does not manufacture proof for existing messages, change source
records, enable capture or call Slack.

apply-refresh.sql contains the same job-refresh source body as the LIVE candidate,
with TEST target guards. Its prerequisites include the aligned context helper. The
unrelated document-withholding helper is absent on TEST and is not a dependency of
this feature, so the TEST wrapper does not require it. No effective job reader is
skipped. TEST's older Slack classifier/storage/runtime remain unchanged by alignment;
this is not full connector parity or historical capture acceptance.

Both packages and their empty-installation rollbacks passed isolated rehearsal.
Installation was verified at 21:52 UTC on 13 October: all nine expected function
definitions/access checks match, role memberships are restored, and all 78,378 rows
across sixteen preserved tables match. All four new ledgers/proof tables are empty.
Do not replay installation. Matching frontend and signed-in feature acceptance are
still pending before this can satisfy the production release gate.
The metadata-only baseline is recorded privately; no credentials or customer rows
are in this package. manifest.json pins sources, target and outstanding checks.
