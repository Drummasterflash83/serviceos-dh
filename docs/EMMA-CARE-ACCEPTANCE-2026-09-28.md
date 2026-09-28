# Emma: operator care and client feedback acceptance

28 September 2026. **A verified local checkpoint, not a completed live launch.**

## What this release changes

| Surface | Intended job |
| --- | --- |
| Client workspace | Workspace home, AI receptionist, Modules, Invoices, Review & feedback. |
| OpenFolk workspace | Client overview, AI receptionist care, Modules and Invoices; older tools stay under the future-tools disclosure. |
| Operator receptionist | Review coverage, urgent/unowned work, client testing, evidence, decisions and delivery status—not a copy of the client practice page. |
| Modules | Published delivery progress and outcome packages from the existing shared records. Programme/outcome bookmarks remain compatible. |
| Feedback | Durable practice drafts, exactly-once report creation, operator evidence and client-safe progress. General workspace feedback has an operator inbox and append-only replies. |

No invoice values, amounts paid, package prices or customer authorisations are invented or changed by this release.

## What runs automatically after deliberate activation

1. Completed practice calls, new feedback and Vapi-backed call records create durable work.
2. A read-only Vapi scanner reconciles the configured assistant's calls. Historical bound practice sessions are separately included: temporary practice assistants must not vanish from coverage.
3. A bounded scan persists unfinished windows and its fixed cutoff. Only a completed scan advances its watermark. A saturated timestamp or provider error is visible, never counted as complete.
4. A leased worker reviews completed transcripts against operator-approved rules. Tenant budgets, idempotency, changed-evidence generations, retries and dead-letter states prevent uncontrolled repeated work.
5. Grounded findings and client reports reach the review desk. Original recording/transcript evidence can be opened through authenticated, tenant-bound controls.
6. Verified OpenFolk Slack routes handle updates, attention and urgent incidents. Ambiguous delivery is held for positive receipt reconciliation, not blindly resent.
7. Urgent unowned work has bounded reminders; ownership stops unowned reminders, while overdue owned work can escalate.

This is **transcript review**, not continuous audio listening, a telephone-route test or a guarantee of call quality. Browser/network delivery and synthesised audio require separate evidence. Text repetition alone does not establish the cause of the reported stutter.

## What remains under OpenFolk control

- Review rules and enabling analysis.
- Verified workspace/channel routing and an explicit legacy-to-managed notification handover.
- Ownership, diagnosis, proposed change, test plan and approval.
- Provider changes and declaring a fix released/verified.

The current implementation refuses to turn an approval into a release. The controlled Vapi deployment adapter, version-bound regression runner and post-release rollback/verification loop are still required. No self-editing of Emma is enabled.

## Evidence boundaries

Final local verification:

- 314 Node tests passed (including 50 prebuild/navigation/branding checks).
- 249 PostgreSQL assertions passed serially: care foundation 24, delivery 89, drafts 27, cutover 47, combined acceptance 44, existing module/invoice publication 18.
- TypeScript, targeted ESLint and the three new/updated care edge-function runtime checks passed.
- Vercel-target production build passed. The shipped Vapi SDK resolves and constructs without making a call; workspace bundle checks keep invoices and legacy tools off the initial static dependency path.
- Migration-order checks pass over 110 files. The schema-qualified-name parser defect was fixed with 11 regression tests, not a whitelist.

- Database tests use real PostgreSQL permissions, functions and transactions. External model assessments and Slack receipts in the combined acceptance test are clearly labelled synthetic.
- Unit tests exercise scanners, worker dependencies, safe errors, scope checks, grounded review parsing, alert ambiguity and UI/navigation contracts. Static UI checks are not browser interaction tests.
- All application fixtures and temporary schema changes roll back. Concurrent lease tests use an isolated synthetic schema that is removed afterwards; no customer data is removed.
- Production build and shipped voice-SDK construction checks do not place a call.
- Every successful draft acknowledgement is durable. Abrupt device/network loss cannot guarantee saving keystrokes that have not reached the server.
- A clean practice call without submitted feedback is stored and queued for analysis, but is not automatically manufactured into an issue merely to create a Slack message.
- The scan's processed-observation count may include inclusive-boundary overlap across resumptions. Review coverage uses the unique call queue, not that counter.

## Release sequence

1. Reconcile the branch with current `main`; complete typecheck, targeted lint, full tests, the Vercel-target build and a protected preview smoke test.
2. Inspect the exact production migration history. Apply only the reviewed care migrations and required prerequisites—never an unrelated migration backlog.
3. Deploy the updated `client-notifications`, `receptionist-care`, `receptionist-care-worker` and `receptionist-care-scheduled-sync` functions. Deploying is not permission to activate processing.
4. Securely provision the approved funded OpenAI key/model, an OpenFolk Slack bot, exact OpenFolk team ID and a high-entropy worker secret. Never use browser-visible variables or source files for secrets.
5. Verify actual OpenFolk destinations. Approved target is OpenFolk `#ai-emma`, team `T0BLG3N4KN1`, channel `C0C4K7TGBLL`; verify membership and receipt at activation time. A manual message from the ChatGPT connector is not proof of the application's bot route.
6. Approve tenant-specific review rules and a bounded initial workload. Pass worker readiness and the explicit notification cutover. Any uncertain historic delivery needs reconciliation, not a blind replay.
7. Deliberately schedule only `serviceos-emma-care`. The migration registers it and preserves all 15 existing definitions; it does **not** install cron or call `serviceos_schedule_all()`.
8. Run a real client test through the browser: call, hang up, play recording, enter feedback, leave/reopen, inspect the operator issue and evidence, confirm exact Slack contents/receipt, claim/propose/approve, and confirm the honest client progress message.
9. Verify ordinary-client isolation, admin authority, mobile layout, disabled/failed provider states and stale approvals. Promote only once preview/auth/API checks pass.

## External gates observed during this work

- The approved OpenAI project returned insufficient credit. Chris was asked by Slack to fund it or securely select a funded project. No customer transcripts were sent to the new reviewer.
- The production secret inventory did not contain the new OpenFolk bot connection. The old automatic route was OpenFolk `#dh`; it is not silently relabelled `#ai-emma`.
- The browser tool refused access because administrator-enforced policy could not be verified. No alternate surface or URL was used to bypass it. Therefore no live browser walkthrough is claimed.
- No new production migration, scheduler activation, notification cutover or provider instruction change has been performed in this checkpoint.

This file supersedes the implementation-status portions of `EMMA-CARE-LOOP-CHECKPOINT-2026-09-28.md`. That earlier file remains the historical record of the initial foundation.
