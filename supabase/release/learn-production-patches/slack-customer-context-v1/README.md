# Slack customer-context production patch

This is the exact reviewed additive patch, outside the numbered historical release ledger. It follows packages 001–024 and the installed throughput, campaign-priority and voicemail-discovery patches. It does not replace those packages. The migration source and all three SQL files are pinned in `manifest.json`.

The first apply failed atomically with SQLSTATE 42501 because the management `postgres` role cannot inherit the restricted communication-reader owner. Readback proved both new tables and functions absent and the original reader unchanged. The original failed journal remains retained privately. The corrected apply was verified on 13 October 2026; never blindly replay it. Its preflight rejects existing proof storage and any original function/ACL drift.

## Maintenance authority

Immediately around the existing-reader replacement, the deployment transaction uses `postgres`'s existing ADMIN OPTION to create a separate self-grant: INHERIT true, ADMIN false, SET false. It removes only the grant made by `postgres`, leaving the original `supabase_admin` membership untouched. The transaction checks every membership against its exact starting value before commit. No permanent role access, client assignment or function ACL expansion is introduced by this maintenance step. New helper/writer permissions are the reviewed additive migration permissions.

The complete schema rehearsal used both session and current user `postgres`, reproduced the original failure, and verified application, injected failure while the temporary grant exists, late failure, exact membership restoration and reader rollback. Existing reader/context journeys and all 1,591,580 archived COPY rows/seven sequences passed.

## Application contract

First verify the manifest and source with:

```sh
node scripts/verify/learn-slack-customer-context-release.mjs
```

A reviewed deployment runner must set `serviceos.release_target` and `serviceos.release_sha256` to the manifest's `executionContract` values, then submit the entire `apply.sql` file as one transaction using the existing production maintenance connection. Do not split it into statements or remove guards. A failed or uncertain response requires authoritative readback before any retry. Verify exact installed definitions, owner/ACL, role memberships, policies, access assignments, schedules and source preservation. Both new tables must initially be empty.

The matching Slack and platform workers must be published only after verified SQL installation. This patch does not start capture, replace credentials, modify a schedule, review a source-to-job link or incur AI calls. Existing approved scheduled capture will add public visibility proofs on subsequent pages. Previously stored versions require a genuine authorised replay; no C-prefix inference or manual proof insertion is allowed.

## Recovery

Restore the previous matching worker artifacts first, preserving their original JWT settings and the existing voicemail implementation. Verify runtime recovery, then submit the entire `rollback.sql` transaction with the same two release settings. It restores the exact old reader and disables the new writer. All capture-proof storage is retained, along with existing source messages, versions and review receipts. Never delete retained evidence to roll back this reader.

`original-reader.sql` is an exact recovery reference, not a standalone safe deployment: its restricted owner requires the guarded role-preserving envelope. A rollback failure or changed reader hash requires inspection; do not remove its guard.
