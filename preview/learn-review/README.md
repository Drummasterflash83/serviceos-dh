# Local LEARN design review

9 October card increment: `?launch=1` now mounts the actual current company-card
and scoring-settings components with synthetic canonical records. Office/engineer
filtering and source evidence drill-down are available. `&cards=empty` and
`&cards=error` exercise empty/failed reads. Scoring draft saves are simulated in
memory only and disappear on page reload; no database or provider is contacted.
The current application stylesheet is imported so dialog utility classes are
generated correctly. These changes supersede the older statements below that all
preview mutations throw and that the global stylesheet is a frozen copy.

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
