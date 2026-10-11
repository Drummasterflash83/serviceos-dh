# LEARN V1 production release plan

Status: **preparation only; not approved or ready to execute**. The
[completion checklist](LEARN-V1-COMPLETION.md) is the acceptance authority.
The current hosted TEST frontend is Git `1af32a4`, schema package 066 and worker
v12. That combination has synthetic processing acceptance, not full launch
acceptance. Source backups are on `codex/learn-v1-test`.

## Required evidence before requesting promotion

- Resolve existing TEST access approvals and verify signed-in customer and
  OpenFolk journeys on the matching protected frontend: reset/sign-in, source
  inspection, card evidence/audio, operator review, module controls and scoring.
- Complete the bounded real Commusoft import and relationship reconciliation;
  establish historical/incremental coverage for required email, Phone, voicemail
  and Slack inputs. Reusable Microsoft support remains in scope; identify whether
  Drummonds needs an actual Microsoft mailbox. Do not substitute fixtures for
  source acceptance or silently defer unavailable inputs.
- Prove provider capture through stored inputs, identity/card delivery and
  reviewed metrics, including disable/resume, lease expiry and unattended worker
  dispatch. A manually invoked worker does not prove recurring operation.
- Establish Drummonds' staff/team mapping, working calendars, scoring criteria,
  weights, scales and source limitations. Missing inputs must remain missing;
  pay-related use requires authorised human review.
- Rehearse a real isolated production database restore and reconnect its recording
  references to verified independent audio backups. Complete credential recovery
  and storage ownership handover. See [recovery coverage](LEARN-DATA-RECOVERY.md)
  and [daily recording operations](LEARN-RECORDING-DAILY.md).
- Resolve every remaining item in the authoritative checklist or obtain an
  explicit scope decision from Chris. Present specific unresolved limitations;
  never interpret absence of objections as approval.

## Build the production-specific release candidate

1. Read production's current migration ledger, schema/catalog, deployed function
   versions, settings and active schedules. Capture a fresh private preservation
   baseline of source IDs, relationships, counts and fingerprints. Record the
   currently serving frontend and production environment binding.
2. Derive an additive, ordered production migration manifest from that actual
   state. The 066 TEST packages include TEST-specific guards and assumptions;
   **do not execute TEST bundles on production, copy the TEST database, or run an
   unreviewed blanket database push**. Keep schema and source hash pins immutable.
3. Rehearse the exact candidate against an isolated restored full production
   schema, with network/provider calls and imported schedules disabled. Prove
   preservation, tenant isolation, authority, rollback on failure and compatibility
   of every paired reader/writer. Record each required runtime and deployment order.
4. Pin the frontend Git commit, database package hashes, function source bundles,
   required environment-variable names and dependencies in one reviewable manifest.
   Never include secret values. Re-run the documented release checks for that
   exact candidate and verify the GitHub backup SHA.
5. Prepare a production-configured Vercel candidate using the existing production
   project's environment. Never promote a frontend bound to Supabase TEST.
   Follow [deployment instructions](../DEPLOYMENT.md); Lovable is not a host.
6. Give Chris the exact production changes, expected user-visible behaviour,
   preservation/recovery evidence, capture activation plan and rollback limits.
   Production promotion requires his explicit approval.

## Approved execution order and verification

After approval of the specific manifest, take a fresh recovery/preservation
checkpoint. Install the reviewed additive database prerequisites, then their
compatible guarded functions, then the matching production frontend. Do not
activate capture or schedules as a side effect of schema/frontend installation;
follow only the separately reviewed activation steps in the approved manifest.

Verify the actual `openfolk.ai` routing and served version, production Supabase
binding, tenant/operator permissions, Drummonds branding and signed-in journeys.
Compare source IDs, existing relationships and recorded-file references with the
baseline. Verify new real inputs and updates through the whole pipeline, including
scoring limitations and operator-visible diagnostics. Record actual observation
windows and receipts; an ACTIVE function, HTTP 200 or rising count is insufficient.

## Rollback and operational handover

Choose compatibility boundaries during rehearsal. An old frontend or worker may
not understand new receipt contracts; Vercel rollback alone is not automatically
a safe application rollback. For an unsafe paired release, pause affected capture
through verified controls while retaining inputs and evidence, then use the
reviewed compatible runtime/frontend version or an additive forward correction.
Do not drop receipt/audit tables, overwrite existing data from TEST, or rewrite
published Git history. A production database restore is a separate reviewed
recovery operation, not a routine way to undo a schema addition.

The final handover must name the operator, monitoring location, actual dispatch
and backup schedules, alert recipient, escalation route, credential locations
and rotation dates, recovery steps, expected provider coverage and known limits.
No credentials belong in this document. Keep customer messages calm and factual;
record operator detail without claiming failed or stale processing is healthy.

## Workspace alias compatibility before promotion

The 11 October read-only directory audit found two active configured addresses
that Google reports as aliases; their Gmail profiles resolve to current primary
users without separate DWD account rows. The earlier directory handler would
mark these valid alias inputs removed. Use the reviewed v3 directory-identity
candidate with its additive binding schema and matching worker when packaging production; do not run the earlier primary-only refresh.
TEST code/readback checks pass, but production is unchanged and still needs the
explicit release approval. Do not enable parallel primary accounts or merge old
sources implicitly. Review alias ownership and retained account IDs during real
capture acceptance. Four other failing addresses are absent from the current
domain directory; their history stays retained while the operator resolves them.
See [current delivery evidence](LEARN-V1-COMPLETION.md#real-workspace-directory-and-aliases--11-october-18491854-utc).

The provider distinguishes primary email from editable/non-editable aliases:
[Google Directory User reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users).
The bounded scan covers the configured domain, not every domain, group or deleted
user in the Workspace customer:
[Google users.list reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list).

### Alias capture identity sequence

TEST package `067_workspace_identity` was installed only after its exact rollback
rehearsal. The new discovery handler and capture ports require its two columns and
identity guard; schema precedes runtime. Production must use a production-specific
manifest and approval, never the TEST package. Existing bindings start unverified.
A complete authorised directory refresh must establish an alias's primary before
V1 capture can accept the primary address returned by Gmail. Source account IDs
and old email namespaces must remain intact.

If ownership changes, the guard retains the original primary and latches a hold.
A normal refresh or generic retry must not clear it. Operator disposition remains
an explicit reviewed recovery action, with preservation evidence. For rollback,
pause affected capture before reverting matching runtime; retain new binding and
conflict evidence instead of dropping columns after they have been populated.
Positive hosted real-data acceptance remains open.

## TEST 068 mailbox-wide email prerequisite — 11 October, 19:24 UTC

TEST 068 and worker v14 now read message additions without an Inbox/Sent filter.
The first v3 recent generation reconciles the mailbox, including Spam/Trash;
existing in-flight v2 pages remain unchanged. See the
[verified TEST evidence](evidence/learn-email-mailbox-coverage-test-2026-10-11.json).
This is not production promotion approval or real mailbox coverage acceptance.

The pinned TEST package uses the existing postgres administrator's ADMIN membership
only inside its migration transaction: a temporary grant enables protocol-owner
inheritance for replacement, is revoked before assertions, and original memberships,
function owners and ACLs must compare exactly. No lasting permission is added.
Production must first prove the corresponding original function hashes, authority
and full source preservation; do not execute the TEST-targeted package there.

Deploy the matching worker before allowing new v3 capture. For rollback after v3
checkpoints exist, pause new Email capture and keep a worker capable of both v2/v3
recovery. Do not downgrade the transition function or reinterpret ALL page tokens
as Inbox/Sent. Preserve v3 receipts and checkpoints and recover forward; any older
code rollback requires a separately reviewed compatible recovery plan. No data
or cursor reset is an acceptable rollback shortcut.

Real-provider initial reconciliation, subsequent capture, source-to-card acceptance,
score eligibility (including draft/spam treatment), and operator recovery still
need acceptance before this change can be part of an approved production release.
