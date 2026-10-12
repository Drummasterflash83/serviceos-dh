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

Implement an explicit client support context bound to the real signed-in operator
and selected client, with logged entry/exit, effective grant checks, expiry and
immediate denial after revocation. Carry that context through read APIs, RLS and
playback. Preserve existing client permissions and tenant write checks. The UI
must identify the client and operator support mode, clear stale data on a switch,
and fail visibly when access expires. Verify two client workspaces, ordinary
client isolation, forged/foreign contexts, revocation and retained source data.

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
