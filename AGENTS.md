> **New Dawn delivery direction (Chris, 19 October 2026).** The active M1–M6 pursuing goal supersedes `BUILD-CONTRACT.md`, `LEARN-ACCEPTANCE.md`, the 00–23 stage prompts, and any conflicting gate in `docs/DEPLOYMENT.md`. Preserve tenant isolation, logged operator access, excluded Slack DMs, secrets and backups, no invented business data, and explicit authority for provider writes, messaging, phone routing, logins, destructive changes and money movement. See `docs/STATUS.md` for the current short status.

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
