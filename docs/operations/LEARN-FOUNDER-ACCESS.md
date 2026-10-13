# Drummonds founder access — applied and verified in production

Plan `0cebff5a-8018-44d7-a444-2a6252efd641` targets ServiceOS production
`tgbnakbxwcqjeimygroz` only. It is separate from frontend/backend promotion. Chris approved this exact plan
in chat on 13 October, and it has now been applied and read back successfully.
[Production evidence](evidence/learn-founder-access-production-2026-10-13.json).

## Problem and exact change

At 01:32 UTC on 13 October, The designated founder’s existing login
is confirmed and not banned. Its Auth and profile emails match. It has Drummonds
portal membership, role `viewer` and no operational tenant. LEARN’s operational
requests require a matching tenant; its metadata/playback readers require
`owner` or `admin`. Portal membership alone does not satisfy these checks.

The prepared change assigns this one existing profile to Drummonds
(`00000000-0000-0000-0000-000000000001`) with role `admin`, with no automatic expiry.
It preserves the login, password, profile identity and portal membership. It adds
one append-only controller audit record. No OpenFolk platform grant is created.

This is **company-admin access, not read-only access**. Within existing installed
module permissions, it permits access to Drummonds communications, customers/jobs,
recordings and performance evidence, and customer-admin operations such as mailbox
configuration, import/processing requests, work actions and marketing administration.
Those actions still have their existing server checks, module settings and provider
requirements. This change itself does not run any of them. A separate narrowly scoped
read-only role would require additional implementation and verification.

No account is created, no reset email is sent, no password is read or changed, no
provider is called, and no capture or schedule is enabled. This does not allow us to
claim the founder has signed in successfully or that LEARN is fully working.

## Reviewed implementation and execution conditions

- Template: `scripts/verify/learn-founder-access.sql`; substitute only the approved
  private plan’s account identity. The resulting SQL must match the hash below.
- Rendered execution SHA-256: `b1fd554ca711fd6b128845b6e2baa86d62fd9c85ad7fd3fdb3fd3304fdb58006`.
- Private prepared plan: `.verification-results/founder-access-plan-20261013.json`.
- The exact account identity and profile fingerprint stay in the private plan.
- Explicit approval of this plan is required because it expands this person’s
  production permissions. Earlier TEST operator approvals concern other accounts.
- Before application, recheck the live profile/trigger contract and approval, match
  the prepared SQL checksum and profile fingerprint, record execution intent once,
  then submit one transaction with the fixed project/run/action/hash settings.
- The transaction locks the exact profile; checks identity, confirmation, ban state,
  tenant and portal membership; rejects an active platform grant, changed row or
  duplicate run; and changes only role, tenant and the trigger-managed timestamp.
- Inspect the durable profile and audit after the request. An uncertain HTTP outcome
  must be read back; do not retry the mutation automatically.

## Reversal and verification

The same SQL supports a separately requested `revert`, requiring the grant audit,
matching current profile fingerprint and the expected company-admin assignment.
It restores `viewer` with no operational tenant, retains both audit records and
keeps the original login and portal membership. Normal `updated_at` stamping remains.
It is not a session logout or password reset. Existing downloaded information cannot
be recalled by reverting access.

The exact SQL passed a full-schema rehearsal against the retained 13 October database
archive in a disposable container with no network, ports, host mounts, scheduler or
background worker execution. Checks cover wrong project, stale profile, atomic rollback
on late failure, normal grant, customer context without platform authority, duplicate
rejection, and reversal. All 297 archived tables outside profiles/controller audit and
all five archived sequences matched before/after. The target’s other profile fields matched;
the two expected audit entries were retained. The container was removed.

This does not prove every existing module’s endpoint permissions or a signed-in hosted
journey. Those require the matching release and real signed-in acceptance. The rehearsal itself made no production changes. [Sanitised rehearsal evidence](evidence/learn-founder-access-2026-10-13.json).

## Approved production result — 13 October

Fresh read-only preflight matched the prepared profile fingerprint, confirmed
identity, portal membership and table/trigger/permission contract. No audit for
this run existed. The unchanged, checksum-verified SQL was submitted once after
recording durable execution intent, and its result was read back independently.

Heidi's existing `heidi@drummondheating.co.uk` profile is now `admin` for Drummonds
with no automatic expiry. Exactly one matching `customer.access.grant` audit
records the previous viewer/no-tenant state and the new company-admin state.
No active OpenFolk platform grant exists for the account.

Before/after fingerprints match for all other profiles, the target profile's
other fields, its complete Auth row, portal memberships and platform-grant rows.
The schema/trigger contract still matches. No password change, reset email,
new login, provider request, capture change, schedule change or release occurred.
The private plan/journal are terminal `applied_verified`; do not submit again.
Signed-in production acceptance remains outstanding.
