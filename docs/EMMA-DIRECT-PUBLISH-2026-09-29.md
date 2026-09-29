# Client feedback board and direct publishing

Requested: match DH feedback layout to OpenFolk; let Chris choose testing or direct Vapi submission.

## Client

Same shared status definitions and CSS: New, Reviewing, Needs approval, In progress, Ready to test, Resolved. Status selection filters a newest/priority ordered list; rows open a client-safe report and OpenFolk update. Needs approval explicitly means OpenFolk's approval, not the client's. Existing safe `care_customer_progress` projection, feedback RLS and private recording endpoints retained. No internal proposals, snapshot credentials or publishing controls are queried by this component.

## Operator

Three steps: problem, saved proposal, choice. Original evidence and detailed AI reasoning are collapsible. Test approval remains separate from publishing. Direct publish does not require a text/voice rehearsal. It requires an exact saved proposal, a current provider snapshot and an explicit confirmation of the appended instruction. AI does not generate new text after that confirmation.

Scope: response-instruction updates only, via a model patch retaining all existing model fields and adding the saved instruction. This is not a general editor for firstMessage, tools, phone routing, voice or office-hours configuration. Behavioural instructions can affect responses; the operator must inspect the exact addition.

`receptionist-release` authenticates Chris plus platform authority, refuses View-As, binds tenant/assistant/issue/version. Service-only SQL reserves one unresolved release per workspace. Snapshot content is inaccessible even to the operator's browser. Preview expiry:15 minutes. Before writing it re-fetches Vapi; changed configuration refuses publication. After PATCH it reads back the complete configuration. A timeout does not trigger a second PATCH; uncertain writes remain locked until read-only reconciliation confirms the intended state.

Provider limitation: Vapi does not document an atomic compare-and-swap header. There is still a narrow race with edits outside OpenFolk between GET and PATCH. UI advises not editing Vapi simultaneously. Do not claim atomic protection against external edits.

Successful publish goes to Ready to test, not Resolved, with honest client progress. The existing outbox sends the result and latest release instructions to OpenFolk Slack. Rollback explicitly restores the previous model only if the full current configuration still matches the published candidate. A later external change blocks rollback rather than overwriting it.

## Verification

- Unit tests cover exact patch scope, configuration drift, readback, lost responses without retries, uncertainty, rollback, authority guards and client isolation.
- Rollback-only local DB tests cover RLS, private snapshots, direct publishing from Needs approval without a rehearsal, duplicate publishes, locked task edits, honest client state and Slack outbox updates.
- No live assistant write is required to deploy or preview this feature. Browser preview and live publication are distinct acceptance checks. Record any actual live publication separately.
- Existing every-call monitoring and automatic recurrence fixes are not enabled by this increment. No report is automatically resolved.

Reference: https://docs.vapi.ai/api-reference/assistants/update
