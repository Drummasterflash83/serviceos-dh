# OpenFolk client information access

## Required behaviour — Chris, 12 October 2026

Authorised OpenFolk operators must be able to inspect every client's business
information to support that client and improve their software. This includes
customers, contacts, sites, jobs, emails, calls, recordings, transcripts, Slack,
voicemail, cards, performance evidence and connector health. Client accounts
remain isolated to their own company. Operator activity must retain the real
operator identity and selected client in its audit record.

Do not implement support by moving an operator's profile from company to company
or impersonating client staff. Retain the existing distinction between platform
administration, client information reads and client/business mutations. Connector
and module changes use the existing audited operator controls. Secrets stay in
server-side credential storage rather than client-information responses.

## Current audit

The effective-dated `platform.controlplane.admin` grant already authorises
OpenFolk's client controller. Its resolver deliberately does not require changing
`profiles.role`. Several operator capture/health functions already use this model.

The tenant-facing LEARN surface is different: `requireTenantUser` binds requests
to the authenticated profile's tenant; launch status and recording playback then
require owner/admin access. Communication/source SQL readers apply their own
owner/admin checks and RLS. Therefore an operator grant alone is **not evidence
that all client information is accessible**. No broad source-table grants or
production changes have been made to address this gap.

The initial implementation uses a request-scoped selected-client context. Every
read verifies the real signed-in actor's effective admin grant, denies View-As,
fences revocation, and records the selected client, record IDs and access reason
in the append-only controller audit before returning content. Ordinary client RLS
and profile roles remain unchanged. Requests cannot select arbitrary tables or
columns. Anonymous, machine/service and view-only grants are denied.

The new `openfolk_client_information` RPC uses fixed collections and explicit
columns for customer cards, contacts, companies, sites, jobs, emails, calls,
recording metadata, transcripts, processed communications and retained business
input versions. Pages contain at most 25 records; text excerpts disclose truncation.
It excludes credentials, raw metadata, provider recording URLs and storage paths.
Responses use `no-store`. The UI clears content on account/client/collection
changes, backgrounding and five-minute expiry; every reload rechecks authority.
This does not yet supply operator playback or full scoring/card relationships.

Full-schema TEST rehearsal passed with two synthetic companies, pagination,
foreign record rejection, denied ordinary/view-only/revoked/unsigned/machine
access, View-As denial, failed-audit denial and source redaction. All fixtures
rolled back. Installed at 10:34 UTC on 12 October with all 194 datasets preserved,
including Auth users and identities. No new user or grant was retained. The matching frontend was deployed and its first signed-in record browsing
verified at 10:38 UTC: two real Drummonds source pages, expanded detail, an empty
second client and cleared state on switching. All three read audits matched the
real actor, client and reason. Other collections and full source-to-card journeys
still need representative signed-in acceptance.
[Initial reader evidence](evidence/openfolk-client-information-test-2026-10-12.json).

The failed care-report refresh was traced to missing TEST `care_health_snapshot`
and its care-issue/task-review/call-review tables. The existing operator authority
function is present. Do not replace the failure with zero counts; bring in the
matched care package after its dependency and preservation checks.

The work is not complete until real signed-in operator navigation, source detail,
recording playback and card/performance evidence work across clients. A session
table or passing isolated permission test alone does not satisfy this requirement.

## Approved ongoing TEST operator account — active

Applied run: `d8950e13-7f55-411a-8052-0103d4091c69`.
Target: TEST Supabase `saatxzwxvdvqevbnskxy` only.
Account: existing `chris@openfolk.ai`, unbanned with one ongoing operator grant.
**Its existing tenant and viewer role are preserved.**

Approved actions completed:

1. Recheck the existing Auth identity, profile, current Auth contract, reset URL,
   table inventory and all 192 prepared dataset fingerprints.
2. Unban that existing TEST login. Generate no password and create no new user.
3. Insert one audited `platform.controlplane.admin` grant, with **no automatic
   expiry**, for all TEST clients. Preserve every old grant and the current profile.
   Record the change in the append-only controller log. This is platform authority;
   completing the cross-client information workflow above remains required.
4. Verify the exact new grant and audit record and preservation of all other data.
5. Request **one** password-recovery email to Chris, targeting
   `https://serviceos-learn-test-allkin.vercel.app/login?reset=1`. Chris chooses the
   password and saves it in 1Password. An accepted email request does not prove
   delivery or sign-in. TEST currently uses Supabase's default mail service;
   a rejected request must be inspected rather than repeatedly sent.

No production change, provider request, import, schedule, client membership or
profile-role change is part of this account setup. The grant allows management
of all TEST clients until revoked. Chris separately approved this ongoing grant and reset email on 12 October.

The runner is `scripts/verify/learn-test-owner-access.mjs`. It requires the exact
approved run ID and TEST environment guard. Its ignored private journal pins the
runner checksum and records intent before each remote mutation. Unknown unban,
grant or email outcomes stop; apply cannot replay any started plan. `inspect`
reads current state without sending another email. Seven local tests cover scope,
source preservation, read-only preparation and uncertain-outcome handling.
Read-only preparation passed at approximately 10:11 UTC. The approved setup
completed at 10:14 UTC: one exact grant and audit record, login unbanned, all
192 protected datasets unchanged. Supabase accepted the one reset request at
10:14:43 UTC. Email delivery and actual signed-in acceptance remain pending.
[Sanitised evidence](evidence/learn-test-operator-access-2026-10-12.json).

Reversal, if requested: end only the new grant identified by this journal and
`owner-approved:<run ID>`, then ban this exact TEST login through Auth Admin.
Keep its profile, old grants, audit and all client data. Verify the grant no longer
resolves before recording reversal complete. Do not delete the user or any tenant.

## Password reset URL correction — 12 October

Chris received the email, and Arc showed his authenticated TEST workspace as
`chris@openfolk.ai`. The reset link skipped the password form because TanStack's
actual search parser turns `reset=1` into numeric `1`, while our route validator
accepted only boolean `true` or string `"1"`. The correction accepts numeric `1`.
The regression harness now runs the real router search parser, route validation
and redirect effects, including session hydration from the exact emailed URL.
All eight recovery tests and full TypeScript checks pass locally.

The existing hosted form was opened at `/login?reset=true&redirect=%2Fopenfolk`
in the same authenticated Arc session; “Choose a new password” and both password
fields were visibly confirmed. Chris must enter/submit his password and save it
in 1Password. No second email was sent. Password-update completion and operator
navigation remain pending; the numeric-link correction still needs TEST deployment.

At 10:25 UTC the correction was deployed to the protected stable TEST alias from
Git commit `e8d1690e0255bd0364c855f8e603f487f4b65e54`. Chris confirmed completing
his password update; Arc visibly showed his OpenFolk client directory and the
Drummonds TEST controller. The corrected numeric reset URL was also checked in
that session and showed the password form; no second update was submitted.
The report-status refresh on Drummonds' controller failed with a visible warning
and remains to diagnose. Full business-information access is still unfinished.
[Latest verified evidence](evidence/learn-password-reset-test-2026-10-12.json).

## Audited source-to-card review — 12 October, 10:59 UTC

The TEST backend now exposes `openfolk_business_review` for the fixed existing
Commusoft review operations. It checks the current admin grant and selected tenant,
records the real actor and review reason, invokes the governed customer/site/job/
contact rules and returns an audited receipt. Ordinary tenant ownership checks and
generic import permissions remain unchanged. Operator profiles are not moved.
An audit failure rolls back canonical writes; source and contact matching holds
still apply. The full-schema synthetic customer-to-card relationship journey and
negative-access checks passed. No real canonical records were published.
Frontend deployment and real signed-in review remain unverified at this checkpoint.
See [evidence](evidence/openfolk-business-review-test-2026-10-12.json).


### 12 October, 11:06 UTC — signed-in business review

Protected TEST frontend `e2ac2d3` now exposes the installed business-review facade.
Chris's existing operator session browsed real customer/site/job/contact pages,
paginated customers and opened job details. Eight result audits match the actor
and selected client. Closing review clears retained rows; the existing profile
and grant remain unchanged. No real canonical publication occurred. This supersedes
the earlier frontend-unverified status; full cards/scoring/audio acceptance remains
open. See [browser evidence](evidence/openfolk-business-review-test-2026-10-12.json).

## 13 October: customer workspace and founder access check

Production already has its programme and two portal memberships. A read-only check
at 01:23 UTC confirms the existing Chris account has role `owner`, the Drummonds
operational tenant, portal membership and an active platform admin grant. Heidi’s
existing account has role `viewer`, portal membership and **no operational tenant**.
`requireTenantUser` rejects the missing tenant; the planned metadata reader also
requires owner/admin. Portal membership alone cannot complete her LEARN acceptance.
No profile, role, grant or membership changed. Define the least sufficient intended
customer permissions, prepare a guarded change with rollback and review the access
expansion before applying it. Do not grant cross-client OpenFolk authority to a client.

The missing programme was specific to Drummonds TEST. The new operator form created
one minimal TEST record and audited revision through the existing signed-in user.
It does not create accounts, memberships, module settings or capture. Existing
notification triggers queued one record; no TEST dispatcher or destination exists.
Review the queue before any later notification enablement. Client home now opens,
while its unavailable care status and missing receptionist are still explicit gaps.
[Verification](evidence/learn-workspace-setup-2026-10-13.json).
