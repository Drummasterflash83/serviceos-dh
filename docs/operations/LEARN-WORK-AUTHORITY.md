# Work authority from the roster

Local implementation, 9 October 2026. The [TEST action bundle](LEARN-TEST-ACTIONS.md)
is installed and passed real signed-in HTTP acceptance at 21:29 UTC.
No live permissions, work records or communications were changed.

## Applied rules

The transition endpoint now asks `learn_work_authority` for one decision bound to
the authenticated tenant, actor, work item and displayed revision. The endpoint
checks the returned contract before using the existing pure transition evaluator.
Saving repeats authority resolution inside `work_transition_apply`, after locking
the work revision. A positive earlier read is not permission to bypass a later
revocation. Role, View-As, source-read and contract failures prevent a write.

Cover rules adapt the older `jcc_cover_active` and `cp_active_cover_for` logic from
`serviceos-dh` migrations `20260916120000` and `20260918120000`. Cover requires a
confirmed, currently effective assignment, an active confirmed acting member and
covered owner, and a responsible/accountable RACI role. Day masks use the tenant's
existing `metadata.timezone`. A missing/invalid timezone with a weekday mask does
not establish cover. NULL/127 masks mean explicitly all days. Waiting-on and
observer/consulted references do not give mutation authority.

Company grants apply company-wide. Self grants apply only to directly owned work
and cannot assign it to another member. A team grant requires all recorded RACI
owners to resolve to that same tenant team, with no unresolved owner references.
Assignment/correction targets must be active confirmed members in that team too.
Accepting assigned work applies the same target boundary to the acting member.
Temporary cover permits operational transitions, not a permanent ownership claim
without separate assignment authority.
Mixed-team or unowned work does not acquire a team scope by guessing. Tenant
superadmin authority must be company-scoped. Grants must be confirmed and effective.

Canonical member references and unambiguous profile IDs establish staff/team
identity. Legacy user-email references retain direct-owner compatibility, but
cannot establish someone else's cover or team scope through email/name matching.
Duplicate active staff identities cause refusal rather than choosing a row.

The endpoint restores the older viewer-role staff self-service path. A viewer must
resolve to a confirmed active staff member, then satisfy the same item authority
checks. A tenant viewer without staff membership cannot act. Claiming unassigned
work also requires confirmed staff membership. Tenant owner/admin/ops role alone
does not become company-wide work authority.

## Persistence and audit

The save transaction records the final database decision's actor/member, applicable
grant IDs and cover-assignment IDs. Acting as cover leaves the recorded work owner
unchanged unless an explicit authorized assignment is requested. Source capture
and attributed transition history continue to commit with the object update.
Completion exceptions recheck approval authority; objective-link approval uses
the final superadmin decision rather than a stale request field.

These writers share the roster's tenant transaction lock, so recovered roster
revocations and replacements serialize with work saves. The installed input guards now bring ordinary
authorized direct mutations into the same lock. A competing change waits on an
existing row lock or returns PT409 for an explicit refresh/retry. Registry changes
serialize through a global shared/exclusive lock; unrelated companies can still
act concurrently. These guarantees exclude deliberately disabled database guards.

## Verification

```sh
node --test scripts/learn-work-transition.test.mjs
python3 scripts/verify/learn-work-authority.py
node scripts/work-projection.test.mjs
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

Ten focused Node tests execute the real Edge handler with mocked I/O and the real
authority response validator/pure decision module. They cover denied/failed scope,
actor/item/target binding, revision conflicts, authority revocation and staff claims.
The existing projection assertions pass.

The SQL runner reads schema only from the existing local Supabase stack into an
offline disposable PostgreSQL 17 clone. It applies the recovered roster and work
migrations plus the new authority migration, using synthetic staff/work records.
It covers local weekdays/DST, unknown timezone, future/proposed/self/team grants,
mixed teams, assignment/accept targets outside the team, observer/temporary cover, ended/unconfirmed members,
ambiguous identity and revoke-before-save. Denied saves leave object and history
unchanged; valid cover stores the original owner and final cover attribution.
Source data and credentials are not copied, and the clone is removed afterward.

Application typing and a separate endpoint check using installed Supabase types
and declared Deno globals pass. This is not actual Deno/local-stack HTTP acceptance.
The production build and its 47 prerequisite tests pass with existing bundle warnings.

## Release dependencies and remaining work

The installed bundle includes this source plus `20261030070000` validation and
`20261030080000` authority-input serialization.

Migration `20261029210000_learn_work_scoped_authority.sql` depends on the recovered
roster, authority vocabulary, work snapshot/capture migrations and canonical tenant
profile/team tables. The TEST release reconciled those dependencies and retained the prior ledger.
Real owner, operator and viewer-staff HTTP flows passed with synthetic evidence;
full Command Centre browser acceptance remains outstanding.

Work collection visibility and UI affordances still need to consume the same scope
rules; do not claim the entire cover/team experience is complete from endpoint tests.
Historical membership, calendars, approved exclusions, eligible populations and
the performance adapter remain necessary for scoring. Operational permission at
the moment of action does not prove past membership or employee performance.
