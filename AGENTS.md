> [!IMPORTANT]
> **New Dawn is the active delivery direction, updated 21 October 2026.** Chris’s
> current M1–M6 pursuing goal
> supersedes `BUILD-CONTRACT.md`, `LEARN-ACCEPTANCE.md`, the 00–23 stage prompts,
> and any conflicting gate in `docs/DEPLOYMENT.md`. Keep the safety rules below:
> tenant isolation, audited OpenFolk access, excluded Slack DMs, secrets out of
> code and logs, no provider writes or messages without authority, no login or
> phone-routing change without authority, and no rewrite of published Git history.
> `docs/STATUS.md` is the current milestone record.

## New Dawn delivery cadence (Chris, 21 October 2026)

- Make one PR per client-usable outcome, normally 300–1,000 changed lines,
  including its code, any migration, rollback, and evidence. Do not open
  documentation-only, status-only, evidence-only, or readback-only PRs. Update
  `docs/STATUS.md` when a milestone changes, within an outcome PR.
- Aim for two LIVE release batches daily, around 12:00 and 17:00 UK time, and
  1–3 client-usable outcomes a day. Verify once per batch: build, focused tests,
  tenant isolation, migration/rollback check, and one signed-in readback. Do not
  repeat the full verification for each small slice inside the batch.
- Prioritise Drummonds open jobs, the job-first MD home and usable job details.
  Use clean exact Commusoft source identities for reversible, audited customer,
  site and job link batches without repeated approval. Hold collisions,
  duplicates, and unclear person/company identities for review. Never guess.
- A daily open-job status roster qualifies at 99% or greater coverage; show
  each missing job. Approved partial scores may publish with sample size, dates,
  missing measures and rescaled weights; advisory only, with no pay effect.
- The standing QuickBooks authority covers a read-only daily P&L and A/R
  refresh. It does not cover accounting changes or customer chases.
- Prefer audited one-click operator actions and CLI readback over brittle browser
  forms. Keep handoffs in Git rather than only local Mac paths. Build operator
  tooling only when it enables a client-usable outcome.
- Log time each day as building, verifying, waiting (name the dependency), and
  rework. Include one time-log line in each LIVE batch note.
- Keep the public repository free of secrets, raw communications and private
  aggregates. Every data change must be reversible and audited. Never invent a
  value. Heidi remains unable to log in; Chris is OpenFolk, not Drummonds
  staff. Net profit is MD-only. Provider writes, money actions, customer or
  staff messages, phone routing, and logins still require Chris's explicit
  authority. The test-number Emma rebinding in the current goal is authorised;
  the main-number change still needs the exact day-of go-ahead.

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> **Lovable is legacy — not the active deployment path.** The live frontend is
> deployed by **Vercel from Git** (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
> Do not use or publish through Lovable. Do not remove Lovable-origin packages
> (e.g. `@lovable.dev/vite-tanstack-config`) — they are still load-bearing for the build.
>
> Still valid regardless of host: avoid rewriting **published git history** — force
> pushing, or rebasing/amending/squashing commits that are already pushed. Keep the
> pushed branch in a working state (Vercel builds every push).
<!-- LOVABLE:END -->

## LEARN V1 delivery direction (Chris, 10 October 2026)

- Drummonds is the first client. Treat Commusoft as one tenant-scoped input adapter;
  other clients must be able to connect their own business systems to the shared
  customer/contact/site/job model, cards and scoring framework.
- Prioritise a read-only Drummonds Commusoft API connection for Monday, 12 October.
  Verify account access, coverage and end-to-end sync before calling it live.
- Chris clarified on 13 October that Commusoft is the source of truth for
  Drummonds' current job codes (for example `001`, `008`, `016`). Preserve codes
  as strings, including leading zeros. QuickBooks may carry older codes (for
  example `15b`, `13a`); preserve those on their original financial records.
  Cross-provider job links need an explicit, evidenced tenant-scoped mapping;
  do not overwrite Commusoft codes, infer mappings from these examples, or treat
  a service/job-type code as a unique job identity without verifying its meaning.
- OpenFolk is the operator controller for clients, module/submodule availability,
  connector health, diagnostics and recovery. Customer-facing status should be calm
  and actionable; never invent successful processing or hide material stale data.
- Chris clarified on 12 October that authorised OpenFolk operators need access to
  every client's business information to support clients and improve their software.
  Implement explicit, logged client selection and operator reads across customers,
  contacts, sites, jobs, communications, recordings, cards and performance evidence.
  Keep ordinary clients isolated to their own data. Do not implement cross-client
  support by moving the operator's profile into each client or impersonating staff.
- Preserve existing communications, recordings and source history. Reuse authorized
  credentials through server-side storage; never commit secrets or raw private data.
- Back up meaningful checkpoints to `Drummasterflash83/serviceos-dh`, branch
  `codex/learn-v1-test`. Verify the pushed head. This branch is a TEST checkpoint,
  not the production branch; `vercel.json` disables its automatic Git deployments.
  Keep real credentials and private runtime manifests excluded. Do not rewrite
  published history. Production promotion remains a separate verified release.
- On 12 October Chris explicitly authorised deployment to both `openfolk.ai` and
  `test.openfolk.ai`, retaining the existing live UX and Drummonds branding. The
  one-page showcase in `outputs/` is an illustrative conversation preview, not a
  replacement product design. Carry the release through its verification and
  preservation gates; do not ask again for the same deployment permission.
- Individual and group Slack DMs are explicitly deferred and must stay private.
  Channel history and replies remain in scope, including authorised private
  channels with appropriate visibility controls.

## Build-progress reports (Chris, 10 October 2026)

Use clear headings with short bullet points: Working and verified, Needs finishing,
and Blocked externally. Distinguish TEST verification from live provider/production
acceptance. This preference concerns build-progress reports, not a requested
redesign of the Slack panel. Review Drummonds branding against the live workspace
before promotion; local synthetic tenants are not evidence of live branding changes.
