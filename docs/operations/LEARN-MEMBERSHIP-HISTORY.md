# Membership evidence for LEARN work attribution

## What is implemented locally

`20261029220000_learn_member_history.sql` adds forward, append-only snapshots of
team-member identity links, team assignment, confirmation and effective dates.
Database triggers capture inserts and meaningful updates from all ordinary writers,
including the recovered roster lifecycle RPCs. Display-name/title-only changes do
not invent a membership change. Source changes and capture commit or roll back
together. Member IDs and tenant IDs cannot be rewritten, and member deletion or
truncation is refused; leaving remains an effective-end operation. History rows
cannot be updated, deleted or truncated through ordinary SQL.

Existing rows are **not** automatically baselined or retroactively dated. The
service-only `learn_member_capture_baseline` locks one member and captures its
current state once, starting coverage at the observation time. First observed
updates also start coverage at that instant; their before-state does not prove how
long that state previously existed. Historical effective dates cannot supply the
missing observation period. No baseline or live migration has run.

The owner/admin `learn_member_history_read` RPC reads one tenant's whole roster
and a completed period, in one database snapshot. Whole-roster reading is needed
to detect ambiguous login-to-person mappings. It returns one preceding event plus
period events for each member, including explicit missing coverage. The reader
checks capture availability, chronological and before/after continuity, and that
the latest captured state agrees with the current row. A gap or mismatch fails the
read. Limits are 366 days, 500 members, 1,000 events per member, 5,000 events total
and 2 MiB. Counts exceeding limits fail instead of truncating silently.

The history table is private with RLS and no direct anon/authenticated/service-role
table grants; ordinary reads go through the tenant-bound RPC. Capture is performed
by restricted security-definer triggers. This is evidence of membership **as
observed**, not a claim that operators never made a mistaken assignment. A database
owner can disable triggers or alter functions. Detection of currently disabled
capture or a mismatched/disconnected history does not prove detection of every
privileged bypass, especially one restored to its former value. Deployment and
operator audit controls remain necessary.

## Work attribution contract

`src/lib/learn-member-history.ts` validates the actual RPC contract, preserves
unknown periods, and resolves typed member/user references at an instant:

- A member reference uses that member's observed history.
- A user reference requires the complete roster to rule out ambiguous mappings.
  An unknown peer history can prevent resolution even when one current match
  looks plausible. Duplicate active mappings remain ambiguous.
- Confirmation and effective dates constrain an observed state. An unconfirmed,
  future or ended membership does not receive confirmed attribution.
- Names and email addresses never become historical person identities by matching
  current directory text. Team references are not misclassified as people.
- `attributeWorkMembership` splits an existing validated work timeline at observed
  membership, confirmation and effective-date boundaries. Each segment retains
  its work-history evidence IDs and membership-history evidence IDs. Missing work
  coverage remains visible; team transfers do not move earlier time to a new team.

These are per-item **elapsed ownership** intervals, not hours worked or a productivity
rating. Parallel items must not be summed as hours worked. Business calendars,
approved waits/leave, eligible work population, work complexity, cover attribution
and retrospective corrections still require their own evidence and rules. Later
backdated roster edits do not silently rewrite the earlier as-observed result;
they need a reviewed correction workflow before being used in performance scoring.

The recorded-handoff adapter now consumes the membership capture contract in its
server-side resolver and saves its calculation proof alongside an inferred observation.
The card collection flow is connected locally; see [the handoff adapter](LEARN-WORK-HANDOFF-MEASUREMENTS.md).
Desk-time attribution, calendars/exclusions and reviewed corrections remain incomplete.
No real employee measurement, score or pay change has been made.

## Verification and rollout

```sh
python3 scripts/verify/learn-member-history.py
node --test src/lib/learn-member-history.test.ts src/lib/learn-work-history.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

The SQL verifier takes a schema-only read of the existing local Supabase container,
loads a disposable offline database, applies the recovered roster migrations and
new capture migration, and inserts synthetic records only. It tests transfers,
leave/rejoin, current-state reconciliation, missing baseline coverage, rollback,
immutability, tenant/role boundaries and baseline replay. An actual SQL response is
then validated by the production TypeScript reader. The disposable container is
removed. This is not a production migration, a full migration-history replay or
live employee-data acceptance.

Before deployment, verify the actual target schema/migration history and review
the new retention restriction: workflows that delete members must use the existing
end/reactivate lifecycle instead. Deploy capture and arrange an explicit bounded
baseline for existing members before claiming forward coverage. Preserve previous
controlplane audit history for separate, reviewed historical recovery; do not
reinterpret it automatically as complete capture.
