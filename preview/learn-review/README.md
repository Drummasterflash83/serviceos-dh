# Local LEARN design review

10 October channel recovery: Slack imports now opens **Progress & recovery**.
The actual component reads the channel window, approval-specific page count and
queue status, with continue/restart review and a saved pending request. Recovery
requests persist in browser local storage, scoped to backend, signed-in user and
company. Synthetic recovery receipts/state persist in session storage so
`&recovery=uncertain` can simulate a committed approval with a lost response across
a full reload. Retry resolves the same receipt. `stale`, `viewer`, `complete`,
`disabled` and `error` cover rejection, read-only authority, completion and unavailable
states. These are local fixtures; no provider or hosted database is contacted.
Initial channel and thread approvals now also use durable browser-local requests,
including partial batch confirmations. Refreshing progress keeps unresolved work.

9 October card increment: `?launch=1` now mounts the actual current company-card
and scoring-settings components with synthetic canonical records. Office/engineer
filtering and source evidence drill-down are available. `&cards=empty` and
`&cards=error` exercise empty/failed reads. Scoring draft saves are simulated in
memory only and disappear on page reload; no database or provider is contacted.
The current application stylesheet is imported so dialog utility classes are
generated correctly. These changes supersede the older statements below that all
preview mutations throw and that the global stylesheet is a frozen copy.

Slack setup uses synthetic connection metadata and session-storage import receipts.
`&slack=uncertain` loses the initial reply; a reload and exact retry resolves it.
`&slack=stale` returns an explicit rejection that the operator may clear.
`&slack=empty` shows the missing-connection state. “Approve and queue import” in
this local preview never creates a database job or contacts Slack. It exercises
the actual setup form and client request contract only.

10 October thread controls: open Slack imports, then **Thread replies**. Synthetic
stored channels and observed parents exercise multiple selection, per-thread
approval receipts and latest-window progress. `&threads=uncertain` simulates a lost
second approval response; retry reuses its saved request ID and completes the
remaining batch. `disabled`, `empty`, `no-threads` and `error` exercise retained
evidence, empty and failed-read states. These fixtures never create database jobs
or call Slack; their synthetic receipts and source timing now survive reload within
the tab. `&threads=stale` rejects the second item; clearing it preserves the other
batch members. Browser-local approval storage is separate from these fixture
receipts and remains scoped to backend, actor, company and import type.

A local, static review of the requested LEARN experience, mounted in the actual baseline ClientPortal and OperatorShell. Baseline:13b554368cda86dfb0a4014d4187b548a8b9de02. This supersedes the rejected4a8a05d preview direction; no publication is authorized.

ClientPortal is copied with three preview-only changes: LEARN immediately after AI Receptionist, an injected LEARN content slot, and a type annotation for the synthetic receptionist-workspace query. Its original sidebar/header/mobile menu remain. OperatorShell is byte-identical. Styles and tenant branding come from the existing source; CSS loads in the normal global-before-lazy-shell order.

Synthetic programme/auth fixtures run in memory. Off-screen WorkspaceHome, investment, delivery, notifications and Receptionist components are not mounted; their preview replacements explain that those real flows remain in the unchanged application. No full route/session/admin permission or live backend is tested. Existing whole-team Workspace onboarding and separate Calendar/Contacts/Phone/Emma remain unchanged in original source. The source provenance file records original bytes and preview modifications.

The current launch sources are Slack, email, Birchills and Emma, in that order, with Commusoft next. Default counts and status are Unknown/Unverified because no live source observation has been supplied. Example states are opt-in and clearly synthetic; no progress percentage is displayed without a verified total. Birchills is the carrier/source of phone records and Emma the conversation layer; only one stored-call total is shown. This presentation does not establish backend deduplication. Slack message and Team counts remain Unknown. Calendar/Contacts, files, accounting and research are preserved behind a collapsed later/optional disclosure and do not block this launch. Last-successful-sync times and activity in example mode are fixtures, not live provider evidence. Source actions open local scope review only; no source is enabled or connected from this preview.

No API client/provider SDK, credentials, customer payloads or actual ingestion runs are included. CSP forbids connections; native fetch/XHR/WebSocket/EventSource/workers/beacon/service-worker registration are blocked. Query reads receive in-memory fixture results; mutations throw. The imported source contains ordinary auth/permission labels that are shell furniture, not proof of production security. Production consent, RLS/security, successful sync/progress and live counts still require accepted observations before wiring.

Build from repository root with the existing locked dependency tree:

```sh
node node_modules/vite/bin/vite.js build --config preview/learn-review/vite.config.mjs
node node_modules/typescript/bin/tsc --project preview/learn-review/tsconfig.json --noEmit
```

Output:preview/learn-review/dist. Local evidence server is outside tracked source at /workspace/OF-LEARN-POLISHED-UX-EVIDENCE/serve.py, bound to127.0.0.1:47871 only. It serves /client?section=learn and /operator-review as SPA entries. Localhost is not a shareable URL. Proposed test.openfolk.ai is unprovisioned/unverified here. There is no Vercel config, push, external write or deploy in this candidate; production app.openfolk.ai is unchanged.

Live client reference identified as libfile_115bded7f1f48191be343257fe59b2ff. Library pixel read returned unavailable and authorized materialization failed before local bytes; no alternate download or network-policy change attempted. Visual grounding uses exact13b554 source and Conductor's verified live description. Direct live pixel comparison and the admin reference remain pending. External fonts omitted; installed fallback font rendering is qualified.

Backend acceptance and independent Assurance remain separate from this local build/browser evidence. Future brain/action-phase naming has not been assigned.

## Source-only count adapter

`LearnReview` accepts optional `learn-status/1` stored-row evidence and an explicit tenant. Both shell callers currently pass no observation, so default counts stay Unknown. No live reader or permission has been added. See [SOURCE-CONTRACT-MAP.md](SOURCE-CONTRACT-MAP.md) for existing interfaces, exact gaps and the smallest hosted prerequisites. The pure existing validator is retained with source provenance; current/empty/partial counts never imply successful sync, source coverage or provider readiness.

Synthetic adapter checks: `node --test preview/learn-review/learn-count-view.test.ts`. Preview-only TypeScript allows explicit `.ts` imports for this Node test; no repository build or dependency settings changed.

Performance review fixture: append `&performance=1`, choose Team, open Example
coordinator and expand Performance evidence & score preview. Synthetic observations
and an in-memory review ledger support confirm/dispute/reload checks. A browser
reload resets the ledger. These controls never submit a real review or measurement.

Work-history fixture: open a customer card and expand **Ownership & time on this
work** under a finding. `&history=partial` (default), `complete`, `empty` and
`error` exercise the actual interval reader and card panel against synthetic
capture responses. Partial coverage reports missing time rather than attributing
it to an employee. Source records expose fixture history IDs. No database,
baseline, history write or scoring measurement is created by this preview.

`/roster-review` mounts the recovered operator roster component with one synthetic
person, proposed responsibility and proposed team permission. Its actions update
in-memory fixtures only; reloading resets them. Use it to review reason requirements,
proposal confirmation and forms. Person-hub/Command Centre navigation is described
in the fixture rather than loading live data; those routes remain wired in the real
operator application. This preview does not establish database/audit persistence.

Numerical correction fixture (10 October): `&performance=1` also supports the actual
correction form. Select a seven-day UTC interval ending at today's 00:00 UTC to match
the fixture. Correcting the inferred 80 retains it and creates a new inferred value;
separate confirmation enables a draft simulation. Explicit withholding creates a
new unassessed observation. Correction metadata and original source timing remain
visible. These measurements, correction receipts and reviews live only in memory
and reset on a full browser reload; no database or provider is contacted.
