# Account-holder review release

These are the exact guarded SQL envelopes installed on 13 October 2026. They
must not be reapplied: existing-object and definition checks intentionally reject
replay. Their only difference is the explicitly guarded project target.

The source migration extends the existing customer writer and logged operator
facade. The envelope verifies the exact prior and resulting definitions/ACLs,
requires the matching target/source digest and `postgres` deployment role, and
checks customer data, links, connections, existing roles, policies and schedules
within the transaction. The schedule check supports TEST without pg_cron.

The envelope rehearsal restored the approved native archive plus packages 001–024,
verified both targets' wrong-target/digest/drift/late-failure rejection and rollback,
then ran identity and operator journeys and compared all archived data. This does
not imply all later unrelated production changes were installed in that clone.
The source-level rehearsal is `scripts/backup/rehearse_customer_account_holder.py`.
Set `serviceos.release_target` and `serviceos.release_sha256` to the exact manifest
values when testing these envelopes in an isolated clone; never run them against
an unverified target or discard their guards.

Rollback retains the safe schema and saved account-holder evidence. An older
frontend may read existing reviews but cannot create a new person implicitly from
the provider contact. Use a forward fix for writer defects. Do not delete real
reviews or restore the old inference merely to make an older frontend write.

Live/TEST execution receipts are summarised in
`docs/operations/evidence/learn-customer-account-holder-production-2026-10-13.json`.
Private preservation maps and exact real-customer acceptance remain outside Git.
