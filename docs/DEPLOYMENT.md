# Deployment — how ServiceOS reaches production

> Authoritative description of the **live** deployment path. If anything else in the repo
> (including older notes in `CLAUDE.md` / `AGENTS.md`) implies Lovable deploys the site,
> this file wins.

## TL;DR

- **Frontend host: Vercel.** The live site is served by Vercel, not Lovable.
- **Lovable is legacy.** It was an early UX accelerator. It is **not** the active deploy
  path and must not be used to publish. Lovable-origin packages (e.g.
  `@lovable.dev/vite-tanstack-config`) are still load-bearing for the build — do **not**
  remove them just because they came from Lovable.
- **Backend is separate.** Supabase (project `tgbnakbxwcqjeimygroz`) is deployed
  independently via the Supabase CLI (migrations + edge functions). Frontend deploys
  never touch Supabase.

## The pipeline

```
Claude builds & verifies  →  git push  →  Vercel builds from Git  →  production
```

| Fact | Value |
|------|-------|
| Vercel team | **Allkin** |
| Vercel project | **serviceos-dh** (`prj_XEuCp5gnEireW5WynUgkRp9QNiXa`) |
| Linked Git repo | **github.com/Drummasterflash83/serviceos-dh** |
| **Production branch** | **`main`** |
| Production domain | **https://serviceos-dh.vercel.app** |
| Framework preset | TanStack Start (nitro) |
| Install / build command | `npm install` / `npm run build` |
| Public env (Production + Preview) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (marked *Sensitive*) |

### Build-target note

`npm run build` runs Vite + nitro. Nitro's **default preset is Cloudflare** (a local build
emits `wrangler.json`), but when Vercel runs the same command it **auto-detects `VERCEL=1`
and switches to the Vercel preset** (`λ __server`). So: build **remotely on Vercel** (source
upload or Git push). Do **not** ship a locally-prebuilt `.output` to Vercel — it would be
Cloudflare-flavoured.

## Current live checkpoint — 13 October 2026

The latest verified LIVE frontend is Git
`f03a96328924d9c6de4414143444c7f6949328e1`, deployment
`dpl_EhqKY1Qdbp28pXBM5Z31K2GrPuqR`, serving the four existing openfolk.ai aliases.
This is the isolated QuickBooks frontend on top of the previous verified
`a11f2041b84cb572a5ce8b65c97057e005bf4da3` contact-details release. It excludes the
separate pending Commusoft job-refresh and Slack recovery frontend changes.
Existing live operator sign-in, connection/import controls, audited empty finance
reads and Drummonds customer/LEARN navigation were checked on the permanent domain.
Actual HTML no-store headers and immutable hashed JavaScript caching are verified.
The previous deployment `dpl_FEvZQUizXBraRu71hJtGciJTPZER` remains a rollback target.

QuickBooks backend is installed, but no production app registration, credentials,
company connection, accounting records or imports exist. Frontend release is not
real-provider acceptance. Policy/Intuit confirmations and live accounting acceptance
remain outstanding. Existing contact details are preserved; broader source coverage,
scoring and operational acceptance remain incomplete.
Use **https://www.openfolk.ai** for LIVE and **https://test.openfolk.ai** for TEST.
TEST is unchanged by this release. The About panel reports the live candidate's
build-time `preview` environment; its verified auth backend is production.

See [QuickBooks live frontend evidence](operations/evidence/learn-quickbooks-live-frontend-2026-10-13.json)
and the [preceding contact-details evidence](operations/evidence/learn-contact-details-production-2026-10-13.json).
Older preview sections below are historical preparation, not current live status.

## Preview deployments

**Latest release preparation, 12 October:** the candidate contains production
packages 001–020 and 37 matching runtime artifacts, rehearsed locally against the
retained archive. Git `d6068af4db92d4efbcba364f195d75616b135200` is built as a
[protected production-configured preview](https://serviceos-bapstxhgk-allkin.vercel.app/login).
It is READY and its rendered auth target is verified as production. It includes
the recurring Commusoft operator controls also deployed on protected TEST. The earlier
`serviceos-yhfbegxeo` preview used the wrong backend and must not be promoted.
The live deployment and domains are unchanged. Chris has authorised deployment;
signed-in production acceptance, matching backend installation and the remaining
technical release gates are still outstanding.
[Current backend evidence](operations/evidence/learn-production-commusoft-recurring-2026-10-12.json) ·
[Frontend evidence](operations/evidence/learn-production-frontend-commusoft-recurring-2026-10-12.json).
The older component rehearsal records below are supporting history; use the
completion checklist and exact current release manifest for promotion decisions.

The production-specific LEARN candidates now include packages 001–014. The combined
archive rehearsal preserves every original row/sequence, existing storage owners
and private voicemail access. The latest suites pass synthetic Microsoft source-to-card
processing, token rotation with legacy Marketing compatibility, actual queue pause/resume,
private voicemail and the existing email/Phone-to-card journey. Real source capture,
audio bytes and signed-in acceptance remain unverified. After the approved Small
compute recovery, production read-only settings confirm the managed Storage helper
and policy grant; no live LEARN policy installation has occurred. The extra Marketing
compatibility patch is local only.
These are reviewed release inputs, **not live migrations or promotion approval**.
Install only as part of the eventual matched schema/worker/frontend release; never
run the TEST bundles against production. See the
[release plan](operations/LEARN-V1-PRODUCTION-RELEASE.md#microsoft-capture-and-compatibility-candidate)
and [completion checklist](operations/LEARN-V1-COMPLETION.md).

### Isolated LEARN TEST project (updated 13 October 2026)

**QuickBooks checkpoint, 22:29 UTC:** both stable TEST aliases now serve
`dpl_4V1Jw7cyxwdqb6u4DdZ8eCU5zbFP`, Git
`e048b49ea95c87d0eedb23881065196336275970`. Existing-session acceptance verifies
that build, the Preview environment, correct TEST backend, 77 retained sandbox
records and the deliberately revoked connection. This supersedes the older TEST
frontend identifiers below. The TEST project's public authentication settings are
**Preview-only**: omit `target: production` when creating its Git deployments.
No LIVE frontend promotion is implied. QuickBooks production foundation/runtime
are installed but inert, with no Intuit production app or company connection.
[Release evidence](operations/evidence/learn-quickbooks-stable-test-cache-2026-10-13.json).


**Latest observed TEST deployment:** `dpl_8oV6zsNRRRbSiUdwsxgDBLHfoqV5`, Git
`119b13d81b91f6b87cfead0a5bbd8445f671517d`, serves both stable TEST aliases
(verified 13 October, 22:07 UTC). Protection remains `all`. This adds the six-file
reviewed job-refresh frontend to the prior QuickBooks/contact checkpoint.
The existing signed-in operator session can find a linked job and verify that it
already uses the latest retained Commusoft version. Applying a changed source is
not yet verified in hosted TEST. The old stable page rendered `c7744a8` after a
reload; navigation with `release=119b13d` rendered the new build. The underlying
cache cause remains unresolved; alias readiness alone is not browser acceptance.
Two temporary retained-data review windows have closed, restoring the original
disabled module / active account configuration. Capture was disabled during review;
no provider requests or canonical job updates occurred.
Rollback frontend: `dpl_6Vb2z8TyE43LuyMevbZnuhvtG8sq`, Git `c7744a8`.
[TEST release and partial browser evidence](operations/evidence/learn-business-job-refresh-test-2026-10-13.json).

The prior TEST checkpoint includes QuickBooks callback guidance from `91c2f3a`.
Its rotated development app and Intuit sandbox authorization were verified for
`Sandbox Company_US_1`, not Drummonds' live accounts. Callback runtime v7 and the
remaining endpoints' v2 releases are unchanged by this frontend release.
See [integration evidence and limits](operations/LEARN-QUICKBOOKS-INTEGRATION.md#hosted-gateway-callback-correction-and-sandbox-connection--13-october-1936-utc).
Production QuickBooks is not installed or connected by this release.

Older deployment details below are historical acceptance records.


**serviceos-learn-test** (`prj_KOScR3ShQmvxjrwLAJ68yTh93Pcs`, Allkin) is separate
from the production project above. Its preview-only public configuration targets
Supabase TEST `saatxzwxvdvqevbnskxy`. The permanent human-facing entry is
**[test.openfolk.ai](https://test.openfolk.ai)**. On 12 October its existing
Cloudflare DNS record was attached to this TEST project and assigned to the exact
current TEST deployment. Vercel authentication now protects **all** deployments
and domains of this TEST project (`ssoProtection.deploymentType = all`). All four
entry routes redirect unauthenticated visitors to Vercel; the authenticated browser
loads the application sign-in page. No live-domain or production-project setting
changed. [Verified setup](operations/evidence/learn-stable-test-domain-2026-10-12.json).

TEST Auth's default return is `https://test.openfolk.ai/login?reset=1`; that exact
address was added while preserving previously allowed TEST return addresses.
Existing accounts and passwords remain unchanged. New origins require a fresh
application sign-in; browser sessions do not transfer between hostnames.
A successful Auth request is not proof of email delivery or a completed reset.
Open the protected site in the receiving browser before following recovery links.

Use this permanent address in user instructions and 1Password. For every future
TEST deployment, verify its TEST backend and READY status, then update **both**
`test.openfolk.ai` and the compatibility alias
`serviceos-learn-test-allkin.vercel.app` to that exact deployment. Read back both
aliases and the TEST project's `all` protection; verify HTTPS and sign-in routes.
Do not change the live project's protection or promote to the live project.
Git checkpoint pushes still do not automatically deploy this TEST branch.

The compatibility staging entry remains
[serviceos-learn-test-allkin.vercel.app](https://serviceos-learn-test-allkin.vercel.app).
It points to immutable preview
[serviceos-learn-test-qrg6bnh9y-allkin.vercel.app](https://serviceos-learn-test-qrg6bnh9y-allkin.vercel.app),
built remotely from GitHub commit `e2d51fa2b106a6fa56c1ddba67238c3ab6e7317d`
and observed READY at **12:50 UTC on 12 October**. The stable alias, TEST backend
binding and both hostnames' protection were verified. This adds audited operator
recording playback and fixes the information/business-review panels to use the
existing embedded layout. The build and its 47 prebuild checks pass.

Chris's existing operator session played the retained eight-second synthetic
recording to its end and closed the player. Six control-plane receipts and two
matching playback receipts from the two browser checks match the actor, selected
synthetic tenant, recording and reason. All original audit rows remain unchanged;
only those reviewed audit additions differ across 194 protected datasets. Both
panels' deployed layout was visually checked. No new identity/grant was created.
Real Phone provider capture, processing and card acceptance remain outstanding.

The preceding deployment verified one real linked customer job/site/contact chain
through the operator browser. Whole-account publication, ordinary-owner browser
acceptance, real email acceptance and enriched summaries/scoring remain open.
See [operator audio evidence](operations/evidence/learn-operator-phone-playback-test-2026-10-12.json),
[customer-context evidence](operations/evidence/learn-customer-business-context-test-2026-10-12.json),
[business-review evidence](operations/evidence/openfolk-business-review-test-2026-10-12.json)
and [reset evidence](operations/evidence/learn-password-reset-test-2026-10-12.json).

The deployment retains the prior Connections status distinctions and navigation
to LEARN input controls, snapshot freshness, projection/identity review, queued
processing messages, draft advice and bounded card-evidence explanation. Compatible
dependency-lock updates passed TypeScript/build; production-dependency audit is
clear, with nine development tool findings retained for review.
The backend now has release **079**, worker **v20**, voicemail importer **v2**, private playback **v1**,
card refresh **v2**, and Workspace discovery **v3**. Release 079 installed a
read-only Microsoft operator-status RPC at **02:41 UTC on 12 October**, preserving
all 148 datasets. Existing OpenFolk view authority is required; anonymous and service
HTTP calls are denied. Positive counts/pagination/redaction/authority checks used
rolled-back synthetic SQL fixtures. The new status panel is included in the current hosted frontend;
**signed-in acceptance remains unverified**. No new human access or capture was
enabled. See [operator status evidence](operations/evidence/learn-microsoft-status-2026-10-12.json).

Release 078 installed the nine
Microsoft schema migrations at **02:17 UTC on 12 October**, after an exact rollback
rehearsal, preserving all 140 existing datasets. It activated no mailbox, worker
or schedule. A subsequent 16-request synthetic hosted RPC run verified actual
local handler/credential refresh/source storage/identity/card publication and
replay, preserving 148 datasets outside the fixture. The fixture is archived,
paused and revoked, with its dummy token deleted and remaining jobs cancelled.
Worker v20 deployed at **02:25 UTC** with the Microsoft handler. All 148 datasets
and other endpoints were preserved. Downloaded-code comparison matched 110 runtime
modules and all 177 emitted imports; its 20 control-flow tests passed. Five hosted
calls then proved auth denial, saved-email recovery while capture/account access
were disabled, paused fresh-work exclusion and one card through the deployed
identity worker. The second fixture is archived with no credentials or active jobs.
This verifies retained-page recovery, not fresh Graph transport; no real Microsoft
mailbox or signed-in journey has been verified. Keep its retained source/receipt
tables when rolling back application code. See
[Microsoft TEST evidence](operations/evidence/learn-microsoft-test-078-2026-10-12.json)
and [worker acceptance](operations/evidence/learn-microsoft-worker-test-2026-10-12.json).

The new frontend exposes the
operator-only voicemail aggregate status and a direct LEARN entry to the existing
private owner/manager inbox. Its scoped response reader rejects unknown counts and
incomplete pages; account/company changes discard private UI state. The inbox was
verified locally with synthetic responses; successful real playback and hosted
signed-in acceptance remain open. Release 077 adds a paginated caller-RLS inbox
reader that keeps old owners' existing message access discoverable after mailbox
reassignment, without disclosing current mailbox configuration. The full-schema
rehearsal and install preserved all 140 datasets. The corresponding frontend is
deployed here. `receptionist-voicemail-recording` v1 is ACTIVE with JWT verification,
observed at **00:01 UTC on 12 October**. Its two installed modules match the pinned
source; six hosted HTTP boundaries deny unauthorised playback and preserve all
140 datasets. Eight behavioural tests also pass against downloaded code. Positive
signed-in playback remains unverified. See [playback deployment evidence](operations/evidence/learn-voicemail-playback-test-2026-10-12.json).
Release 073 added private voicemail
storage/intake; 074 added durable queue settlement; 075 added retained-email
discovery; 076 added bounded dispatch and operator status. These releases did not
activate real voicemail routes or a TEST schedule. Hosted positive scheduled import
and signed-in operator/owner acceptance remain outstanding. The current frontend
passed full-project TypeScript; its stable alias and immutable hostname were both
verified protected at **08:09 UTC on 12 October**. See the
[earlier Microsoft frontend evidence](operations/evidence/learn-microsoft-status-frontend-2026-10-12.json),
[historical inbox evidence](operations/evidence/learn-voicemail-inbox-history-2026-10-12.json)
and [dispatcher evidence](operations/evidence/learn-voicemail-dispatch-2026-10-12.json).
Release 067 added directory-verified alias identities; 068 adds mailbox-wide recent
Gmail capture with a mandatory reconciliation when upgrading old label-limited
cursors. Release 069 preserves drafts while excluding them from communication
publication, identity attribution and card excerpts; its worker uses the matching
draft-aware page store. Release 070 extends the filtering into card refresh, with
revision-checked writes and full eligible counts. Both the worker and manual card
endpoint were downloaded and verified. A scoped hosted service call refreshed one
synthetic card and passed tenant isolation, source preservation and job-completion
checks; its fixtures are archived and all 123 pre-existing datasets were preserved.
No login/grant was created. The matching explanatory frontend is now deployed;
positive signed-in browser acceptance remains pending. These releases did not infer
real alias bindings or activate capture. See the
[card refresh evidence](operations/evidence/learn-card-draft-projection-2026-10-11.json),
[draft eligibility evidence](operations/evidence/learn-email-draft-eligibility-2026-10-11.json), the
[mailbox coverage evidence](operations/evidence/learn-email-mailbox-coverage-test-2026-10-11.json)
and [identity evidence](operations/evidence/learn-workspace-profile-identity-test-2026-10-11.json).
Release 071 adds Gmail label/deletion observations and private source history.
Worker v17 was deployed first, then the pinned schema package. Downloaded runtime
comparison verified 92 emitted modules and 21 reader/store tests. The hosted
synthetic storage API check passed, preserving all 124 pre-existing datasets;
no users, grants or actual provider requests were created. The archived fixture
retains verification evidence. This does not establish real Gmail capture or
signed-in acceptance. See [mailbox change evidence](operations/evidence/learn-email-mailbox-changes-2026-10-11.json).
Keep `learn_email_source_versions` and its rows when rolling back application
code; do not drop source history as a rollback shortcut. Older workers must not
process v4 checkpoints: pause affected capture and use a forward compatibility
repair before resuming. Production remains unchanged.

Release 072 adds operator-only retained-email availability counts, preserving the
health reader's existing owner and permissions. Its aggregate was verified in the
full TEST schema against the archived synthetic history fixture; all 124 datasets
were preserved. The corresponding frontend is deployed to the protected TEST preview above.
Anonymous and service-role HTTP access is denied; positive signed-in operator
acceptance is still pending.
[Retention status evidence](operations/evidence/learn-email-retention-health-2026-10-11.json).

The exact TEST project, Git SHA, preview-only backend binding and Vercel protection
were verified. Homepage, login and LEARN routes remain protected. Browser approval
for this new origin and positive signed-in acceptance are pending.

TEST Auth uses the stable alias's `/login?reset=1` as its default recovery target;
the previous exact TEST recovery URLs remain allowlisted. No wildcard redirect,
user, grant, password, email or other Auth setting changed. The existing owner
login reactivation proposal remains unapproved. Do not claim an email-token journey
or authenticated acceptance from these configuration checks.
[Frontend release evidence](operations/evidence/learn-card-frontend-test-2026-10-11.json).

The previous scheduler-health staging candidate is
[serviceos-learn-test-b5u66qgft-allkin.vercel.app](https://serviceos-learn-test-b5u66qgft-allkin.vercel.app),
built remotely from GitHub commit `aff42842d82ae228de3513a63cad73c2a91ff9a7`
and observed READY at 14:35 UTC on 11 October. It adds bounded scheduling checks
to OpenFolk and the legacy LEARN/Ops readers, paired with TEST release 060. Its
exact TEST project, Git SHA, backend environment and Vercel protection configuration
were verified through the management API. This release does not activate capture,
install the email schedulers or change production. Browser permission for the
updated origin is pending; positive signed-in hosted acceptance remains open.
[Release evidence](operations/evidence/learn-scheduler-health-test-2026-10-11.json).

The previous partial-job-time staging candidate is
[serviceos-learn-test-c7irm9j5p-allkin.vercel.app](https://serviceos-learn-test-c7irm9j5p-allkin.vercel.app),
built remotely from GitHub commit `a084b97a7a21f8377c04e054b893a18e69b3bfb9`
and observed READY at 13:20 UTC on 11 October. It exposes Commusoft job timing
limitations without withholding otherwise reviewable job identity/status.
TEST release 059 was installed at 13:16 UTC; the existing review function retains
its owner and execution grants, and all 113 monitored datasets matched. No real
Drummonds records were published. The frontend retains the prior call-detail
contract fix. Three HTTP routes remain Vercel protected. Browser inspection of
this new origin awaits explicit permission after automatic approval review
rejected opening it; no signed-in acceptance is claimed.
[Release evidence](operations/evidence/learn-commusoft-partial-times-test-2026-10-11.json).

The previous call-detail staging candidate is
[serviceos-learn-test-fpzgfbxtu-allkin.vercel.app](https://serviceos-learn-test-fpzgfbxtu-allkin.vercel.app),
built remotely from GitHub commit `a5f2329369b50194be4bcad59f29d31157d2717a`
and READY at 12:56 UTC on 11 October. It fixes exact transcript linkage and
unverified saved-analysis messaging in the older `/app#communications` detail.
TEST `phone-call-detail` v1 is ACTIVE, JWT verified and serves response contract
`phone-call-detail/2`; this endpoint must precede the matching frontend because
its client rejects unversioned responses. Source readback and eight handler cases
passed, three hosted access denials passed and all 113 retained datasets matched.
No database migration, credential, account, grant, schedule or production change.
The frontend's TEST binding, three protected routes, actual app login redirect
and zero browser errors pass. Positive signed-in detail/review acceptance remains
open. [Release evidence](operations/evidence/learn-call-detail-test-2026-10-11.json).

The previous saved-results staging candidate is
[serviceos-learn-test-ea944wgld-allkin.vercel.app](https://serviceos-learn-test-ea944wgld-allkin.vercel.app),
built remotely from GitHub commit `508dc13172f80fa565e52802105951e01a6687b5`
and READY at 12:32 UTC on 11 October. It adds paged saved transcripts and advisory
analysis to customer-card recordings, with source-matched/stale/unverified labels.
TEST schema release 058 installed at 12:30 UTC and preserved all 113 datasets.
TEST binding, three Vercel-protected routes, actual app login redirect and zero
browser errors pass. Positive signed-in reading remains open; the component was
verified locally with synthetic results, and its SQL passed full-schema hosted
rollback assertions. No provider requests or production changes.
[Release evidence](operations/evidence/learn-phone-saved-results-test-2026-10-11.json).

The previous playback candidate `serviceos-learn-test-qu7dogqm4-allkin.vercel.app`
from `0a8d7eab2eeede40d368a9e5b66508ddd954abeb` passed the approved isolated
signed-in card-to-generated-audio journey. Its synthetic login is now banned and
company membership removed. [Acceptance](operations/LEARN-PHONE-PLAYBACK-ACCEPTANCE.md).

The earlier operator candidate is
[serviceos-learn-test-c6le93r67-allkin.vercel.app](https://serviceos-learn-test-c6le93r67-allkin.vercel.app),
built remotely from GitHub commit `48999ca1c8439ab039375a0972befc2e5b787cfb`
and READY at 10:39 UTC on 11 October. It adds safe Phone attempt history and
audited saved-result recovery, paired with TEST database release 056 installed
at 10:37 UTC. All 111 existing monitored datasets were preserved; seven HTTP
permission checks passed with 112 datasets unchanged including the new journal.
No users, grants, provider calls or production changes were introduced. TEST
backend binding, protection on three routes, actual same-origin client/operator
login redirects and zero observed browser errors pass. Positive signed-in recovery
acceptance remains open. [Release evidence](operations/evidence/learn-phone-operator-test-2026-10-11.json).

The previous staging candidate is
[serviceos-learn-test-k2z4ob4ri-allkin.vercel.app](https://serviceos-learn-test-k2z4ob4ri-allkin.vercel.app),
built remotely from backed-up GitHub commit `6be7c9b34a50dfdb07264806188eb0d9333e0259`
and READY on 11 October at 08:31 UTC. It includes the typed team/person ownership
name fix for customer/job findings, with clear unresolved-assignment gaps. It also
retains the source timeline viewer and safe Workspace diagnostics from the prior
07:00 UTC candidate `serviceos-learn-test-pncxu962n-allkin.vercel.app`.
TEST backend binding, deployment protection on three routes, actual client/operator
same-origin sign-in redirects and zero observed browser console errors pass.
Positive signed-in card/source/diagnostic and real-provider acceptance remain open.
No backend or production change occurred. Backup/restore scripts in this Git commit
remain unactivated; this frontend deployment does not run them.
[Frontend evidence](operations/evidence/learn-owner-labels-test-2026-10-11.json).

TEST database release 054 installed at 06:52 UTC and `platform-worker` v6 at
06:54 UTC. Rollback/install/worker/HTTP evidence preserved all 101 monitored
datasets and existing authority. Worker HTTP checks reject missing/incorrect
internal credentials and accept an authorised execution with no capture jobs.
No provider calls, access grants or production changes occurred.
[Diagnostic release evidence](operations/evidence/learn-email-diagnostic-test-2026-10-11.json).

The earlier 05:05 UTC candidate
[serviceos-learn-test-428847jna-allkin.vercel.app](https://serviceos-learn-test-428847jna-allkin.vercel.app)
was built from GitHub commit `1e4fc645d4b71e7ae7be8d4e29a0cfbc4092f53a`.
It added durable numerical-correction recovery: check, exact retry and cancellation
after an interrupted request or reload, paired with TEST database release 053.
All 101 monitored datasets and prior writer authority were preserved; the writer
adds only its cancellation check. Eight hosted HTTP access-denial checks passed.
Controller v8 remains unchanged. Positive signed-in hosted recovery acceptance
remains open. [Correction recovery evidence](operations/evidence/learn-correction-recovery-test-2026-10-11.json).

The earlier 04:46 UTC candidate added receipt attribution checks before performance
scoring, paired with database release 052 at 04:41 UTC. All 101 monitored datasets
and prior RPC access were preserved. Four private helpers and three deferred
constraints guard new observations, confirmations and assessments. The read-only
management audit cannot execute the private checker and does not prove historical
receipt compatibility. Positive signed-in hosted acceptance remains open.
[Receipt release evidence](operations/evidence/learn-measurement-receipts-test-2026-10-11.json).

The earlier 04:11 UTC candidate added complete cursor-based discovery/sync
history with filters, previous/next navigation and failed-read recovery, paired
with controller v8 at 04:10 UTC. All 101 monitored datasets, schema and other
endpoints were preserved; 32 hosted access checks pass. Synthetic 57-run history
browser checks pass with zero console errors. Actual capture/recovery remains open.
[Discovery history evidence](operations/evidence/learn-discovery-history-test-2026-10-11.json).

The earlier 03:55 UTC candidate separated retained inventory from connection
health, showed distinct Phone providers and retained failed/revoked states,
paired with controller v7.
[Connection inventory evidence](operations/evidence/learn-connection-inventory-test-2026-10-11.json).

The earlier 03:43 UTC candidate corrected Phone readiness and cleared stale
badges on failed/superseded refreshes, paired with controller v6 at 03:40 UTC.
[Phone readiness evidence](operations/evidence/learn-phone-readiness-test-2026-10-11.json).

The earlier 02:51 UTC candidate added searchable operator rosters and paired with
controller v2. [Roster evidence](operations/evidence/learn-roster-pagination-test-2026-10-11.json).
The backend controller was subsequently updated to v3 at 03:04 UTC, from Git
`9dd72d4994f82e2365e90f797321507e654c25cf`, to correct identity/phone health
coverage and use checked paginated inventories. All 101 datasets, schema and
other endpoints were preserved; 14 hosted boundary checks pass. Frontend source
and request contracts were unchanged, so the then-current frontend was retained.
Positive signed-in health acceptance remains outstanding.
[Operator health evidence](operations/evidence/learn-operator-health-test-2026-10-11.json).
Controller v4 supersedes v3 at 03:16 UTC, from Git
`6a1544dcd4ebfb09f6bb4919447e841d6c5127e8`. It checks complete identity
inventories and keeps suggested links within their provider and current scope.
All 101 datasets, schema and other endpoints were preserved; fourteen hosted
boundary checks pass. Frontend source/contracts remain unchanged. Signed-in
identity acceptance remains pending.
[Identity deployment evidence](operations/evidence/learn-identity-inventory-test-2026-10-11.json).
Controller v5 supersedes v4 at 03:30 UTC, from Git
`abc714dead1a9eef552fbe5d37d318ccb54baa5a`. It resolves checked ownership
at the requested time and keeps ambiguous owners/handovers unresolved. All 101
datasets, schema and other endpoints were preserved; twenty hosted access checks
pass. The protected frontend remained unchanged at that release. Positive signed-in ownership
acceptance is still pending.
[Ownership deployment evidence](operations/evidence/learn-ownership-evidence-test-2026-10-11.json).
The earlier 11 October 02:36 UTC candidate added the searchable/paginated team-group
chooser, retaining backend release 051. Local browser checks cover 256 groups,
retry, selection and scoring scope; hosted signed-in acceptance remains pending.
[Chooser deployment evidence](operations/evidence/learn-team-group-picker-test-2026-10-11.json).
Use explicit API `target: "staging"`: the first deployment of a fresh project can
be classified as production when target is omitted. Its default hostname and
intermediate deployments are not the accepted TEST candidate. Preview homepage
login stays on the current origin; production keeps the canonical login URL.
The refreshed candidate includes per-property Commusoft contact progress, secondary-contact
matching explanations, the specific unresolved-timezone review hold and retained-record
search backed by TEST release 045, plus durable assessment recovery backed by
TEST release 046 (installed at 22:06 UTC), older saved-assessment paging, and retained-job source detail inspection backed by
TEST release 047 (installed at 22:34 UTC). Release 047 preserves 88 monitored
datasets, including assessment cancellations, and existing function privileges.
The current frontend also exposes separate team cards and scoring settings for
individual, team, job and customer scopes. Team workload collection is now backed
by TEST release 048 (10 October 23:04 UTC / 11 October 00:04 local). Its hosted
rollback rehearsal, installation and four HTTP-denial checks passed, preserving
91 monitored datasets and every existing collection guard except the exact addition
of the team evidence type. No provider request or capture activation occurred.
Resumable collection is now backed by TEST release 049 (10 October 23:44 UTC /
11 October 00:44 local). It freezes the full work population, processes batches of
100, retains individual proof and supports durable browser recovery and original-rule
review. Its rollback rehearsal, installation and 14 HTTP-denial checks passed;
all 92 monitored datasets were preserved and both new ledgers remain empty. The
existing append function changed only to accept completed runs and reject unfinished
ones. No provider traffic, capture activation or operator access was created.
Working-time package release 050 is installed (11 October 01:57 UTC / 02:57 local).
It adds company calendar revisions/publication, approved-delay history and frozen
member/team working-time collection, with explicit scoring states and retained
input evidence. Hosted rehearsal/install/readback preserved 94 monitored datasets
and existing authority; 40 HTTP access-denial checks passed and seven new tables
remain empty. The paired frontend above is READY; binding, protection and actual
same-origin sign-in redirect pass. Signed-in owner acceptance, real company
configuration and hosted large-evidence transport remain open. No identities,
operator grants, provider requests or capture activation were created.
Canonical card-search release 051 is installed (11 October 02:16 UTC / 03:16 local).
It searches customer titles, job titles/numbers, member names/roles and team names
under existing caller permissions and RLS. Exact rollback/install/readback preserved
101 monitored datasets and existing table access. Eight HTTP role-denial checks
passed. Its paired frontend above is READY; TEST binding, deployment protection and
actual browser sign-in redirect passed with no console errors. Signed-in hosted
search acceptance remains pending. No provider, source or production changes occurred.
History paging is a frontend-only change with no new backend migration. Release 046
preserved all 87 monitored datasets, including assessment and scoring ledgers, and
existing assessment privileges.
Vercel reports READY; TEST environment binding and anonymous protection on homepage,
login and client routes pass. This candidate rendered the login screen and passed the actual browser
unauthenticated client redirect check. Signed-in hosted card-search acceptance, calendar/delay/working-time acceptance, resumable collection/recovery/review, team workload collection/review, team-card/scoring-scope, job-detail, history, card recovery
and control acceptance remain pending;
a successful build is not that acceptance. The Phone evidence panel is backed by TEST release 044, installed at 21:24 UTC
on 10 October with rollback service-path and HTTP-denial checks. Fresh signed-in
visual acceptance and real scheduled capture remain pending. See the
[Phone release evidence](operations/evidence/learn-phone-operator-evidence-test-2026-10-10.json).
See [current deployment evidence](operations/evidence/learn-roster-pagination-test-2026-10-11.json),
[card-search deployment evidence](operations/evidence/learn-card-search-test-2026-10-11.json) and
[047 backend evidence](operations/evidence/learn-job-details-test-2026-10-10.json).

Backup pushes to `codex/learn-v1-test` do **not** automatically deploy because
`vercel.json` disables that branch. Verify and deploy a pinned Git commit explicitly.
Do not apply the production Supabase settings in the sections below to this TEST
project. Full signed-in acceptance still requires the TEST operator backend and
account dependencies recorded in [TEST readiness](operations/LEARN-TEST-READINESS.md).

### Production-project previews

- Every branch push produces a **Preview** deployment. Pushes to a non-production branch
  (e.g. `serviceos-backend-foundation`) only ever produce Preview, never Production.
- A preview can also be created from the working tree with `vercel deploy` (remote build).
- **Preview URLs are behind Vercel Deployment Protection (SSO)** — open them while signed
  in to Vercel, or via a Protection-Bypass-for-Automation token. Production URLs are public.

## Promoting to production

Production tracks `main`, so the controlled routes are:

1. **Fast-forward `main`** to the verified branch and push — Vercel's Git integration then
   builds & deploys it to production (carries the real commit SHA). This is the current
   default. It is a fast-forward, never a history rewrite.
2. For an exact-build release, create a staged production deployment with
   `vercel deploy --prod --skip-domain`, verify that deployment, then run
   `vercel promote <staged-production-id>`. A preview promotion instead triggers
   a new production build; it does not preserve the verified preview artifact.
3. `vercel deploy --prod` — deploy the working tree straight to production.

Instant rollback: `vercel rollback <previous-production-id>`, after checking backend
compatibility. Previously promoted deployments use rollback, not staging promotion.
See [Vercel promotion semantics](https://vercel.com/docs/deployments/promoting-a-deployment)
and [staged production builds](https://vercel.com/docs/cli/deploying-from-cli).
For LEARN V1, the pinned release coordinator governs promotion after backend gates;
do not substitute an unverified working-tree deployment or a moving branch head.

### Required checks before promoting

1. `npm install` — dependency install (repo also carries `bun.lock`; **Vercel uses npm**).
2. `npx tsc --noEmit` — typecheck must pass (the meaningful gate).
3. `npm run build` — production build must succeed.
4. Route verification — the intended routes exist (`/openfolk`, `/openfolk/$tenantId`,
   `/demo/openfolk`, `/demo/ownership`, `/health-shadow`, `/demo/customer-health`).
5. Preview smoke test — routes render, auth works, API calls target
   `tgbnakbxwcqjeimygroz`, no console errors, unauthorised users fail closed.

> `npm run lint` currently reports pre-existing `prettier/prettier` formatting drift. Vercel
> builds with `vite build`, **not** lint, so it does not gate deployment. Do not mass-reformat
> as part of a deploy.

## Confirming the deployed commit

- **In-app:** the OpenFolk operator surface (`/openfolk`) renders a build/version badge —
  frontend commit SHA, build timestamp, environment, and Supabase project ref
  (`src/components/BuildBadge.tsx`, injected via `vite.config.ts` `define`). If the badge SHA
  is behind the branch HEAD, the frontend is stale. It is operator-only (auth-gated route,
  never in tenant navigation) so ordinary tenant users do not see it.
- **From the CLI:** `vercel inspect https://serviceos-dh.vercel.app --scope allkin` and
  `vercel ls serviceos-dh --scope allkin`.

## Custom domain — `app.openfolk.ai`

The **canonical user-facing production hostname** is **`https://app.openfolk.ai`**, attached to
the same `allkin/serviceos-dh` project (no second project). **`serviceos-dh.vercel.app` stays
attached** as a temporary fallback + deployment-diagnostic hostname.

| Item | Value |
|------|-------|
| Canonical domain | `https://app.openfolk.ai` |
| Fallback domain | `https://serviceos-dh.vercel.app` (keep working) |
| DNS provider | **GoDaddy** (`ns11/ns12.domaincontrol.com`) — nameservers unchanged |
| **DNS record to add** | `CNAME` host `app` → `b7083fbc113bbb6d.vercel-dns-017.com` (Vercel A-record alt: `76.76.21.21`) |
| Ownership verification | Automatic — domain is under the same Vercel scope (`attached: true, verified: true`); **no TXT record** |
| SSL | Auto-issued by Vercel (Let's Encrypt) once the CNAME resolves |
| Control Plane route | `https://app.openfolk.ai/openfolk` (no hostname-based routing this increment) |

**Do not** change nameservers or touch MX / SPF / DKIM / DMARC (a DMARC record exists at
`_dmarc.openfolk.ai`). Add only the single `app` CNAME.

### Verify after DNS is added

```bash
vercel domains inspect app.openfolk.ai --scope allkin   # DNS + SSL status
dig +short CNAME app.openfolk.ai                         # should show the vercel-dns target
```

## Application canonical URL / auth origins

The app has **no application-URL / site-URL env var** — it derives origins from
`window.location.origin` at runtime, so serving it at `app.openfolk.ai` needs **no Vercel env
change**. Auth is **password-only** (`signInWithPassword` / `signUpWithPassword`,
`detectSessionInUrl: false`); there are **no magic-link / OAuth / email-redirect client flows**.

### Supabase Auth URL configuration (project `tgbnakbxwcqjeimygroz`)

Set in the Supabase dashboard (Authentication → URL Configuration). Do **not** change the
Supabase project API URL.

- **Site URL:** `https://app.openfolk.ai`
- **Redirect allow-list:**
  - `https://app.openfolk.ai/**`
  - `https://serviceos-dh.vercel.app/**` (temporary fallback)
  - `https://*-allkin.vercel.app/**` (preview deployments — narrowest safe pattern)
  - existing local-dev URLs the team already uses (e.g. `http://localhost:5173/**`)

Because no client flow consumes these today, this only affects future email-template links
(e.g. signup confirmation, currently gated off by `VITE_ENABLE_SIGNUP`).

## Rollback (no data touched)

1. **Auth:** if sign-in breaks, restore the previous Supabase Auth **Site URL** in the dashboard.
2. **Frontend:** `serviceos-dh.vercel.app` keeps serving the same deployment — use it while
   diagnosing. Roll a bad deploy back with `vercel rollback` (never delete deployments).
3. **Domain:** detach `app.openfolk.ai` only if required (`vercel domains rm` / dashboard);
   the fallback hostname keeps the app reachable.
4. All Supabase schema, audit and configuration data is untouched by any of the above.

## Future domain structure (documented, not implemented)

- `control.openfolk.ai` — OpenFolk operator entry point (future)
- `demo.openfolk.ai` — synthetic commercial demo (future)
- optional customer-specific subdomains (future)

For now `app.openfolk.ai/openfolk` is the authoritative Control Plane route.

## Platform authority (who can open `/openfolk`)

Platform authority is **decoupled from `profiles.role`** (migration
`20260822120000_platform_authority_decoupled_from_role.sql`). Access to the Control Plane
requires exactly three things:

1. an authenticated user;
2. an existing `public.profiles` row;
3. an **active `platform.controlplane` grant** (`admin` implies `view`) in
   `platform_authority_grants` (effective-dated, auditable, reversible).

`profiles.role` is the **tenant-facing role only** (`owner|admin|ops|viewer|openfolk`) and is
never consulted by the gate — so a tenant **`owner` can hold platform authority without
surrendering their tenant role**. `is_openfolk()` is deliberately unchanged: it still means
`role='openfolk'` and still governs cross-tenant access in tenant RLS, so **a platform grant
confers Control Plane access only, never tenant data access**.

Grant an operator with `scripts/openfolk-grant-operator.sh` (it never modifies a profile's
role). Both enforcement points must be in sync in production: the SQL gate
`current_user_is_openfolk_operator()` **and** the deployed `openfolk-control-plane` edge
function (`_shared/controlplane/authz.ts`).

## Backend (Supabase) — separate track

For the developing LEARN V1 release, use the separate
[verified TEST environment map](operations/LEARN-TEST-READINESS.md). The existing
TEST backend is a partial schema with its own deployment ledger; a successful
local build does not establish hosted TEST compatibility. Do not point a TEST
frontend at the production project documented above.

Supabase migrations and edge functions deploy via the Supabase CLI against project
`tgbnakbxwcqjeimygroz`, independently of Vercel. A frontend deploy must never modify
Supabase, publish the Customer Health policy, enable the source allowlist, or activate any
live source.

## LEARN V1 checkpoint branch — 10 October 2026

Chris requests regular GitHub backups during TEST development. This reconstructed
checkout uses `codex/learn-v1` locally and pushes checkpoints to
`Drummasterflash83/serviceos-dh:codex/learn-v1-test`. Verify the remote head after
each push. Keep secrets, private manifests, generated builds and original customer
files excluded. The branch contains recovered source plus subsequent LEARN work;
it does not replace the original checkout's full history.

`vercel.json` disables automatic Git deployment for this exact TEST checkpoint
branch, as supported by [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).
This permits source backup while a separately configured TEST frontend remains
unpublished. Do not point it at production Supabase. Promoting `main` and deploying
backend changes remain separate operations. A source-code backup is not a backup
of hosted email, phone audio or database records.

The 11 October read-only backup check found eight completed production database
backups and an empty TEST backup list. Database backups exclude Storage file
bytes. Independent recording backup and a manifest-selected audio restore are now
verified; a real database restore and unattended recurring operation remain open.
See [data recovery coverage](operations/LEARN-DATA-RECOVERY.md) before claiming
that a GitHub checkpoint or database backup protects all retained customer data.
