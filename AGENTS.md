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
- OpenFolk is the operator controller for clients, module/submodule availability,
  connector health, diagnostics and recovery. Customer-facing status should be calm
  and actionable; never invent successful processing or hide material stale data.
- Preserve existing communications, recordings and source history. Reuse authorized
  credentials through server-side storage; never commit secrets or raw private data.
- Back up meaningful checkpoints to `Drummasterflash83/serviceos-dh`, branch
  `codex/learn-v1-test`. Verify the pushed head. This branch is a TEST checkpoint,
  not the production branch; `vercel.json` disables its automatic Git deployments.
  Keep real credentials and private runtime manifests excluded. Do not rewrite
  published history. Production promotion remains a separate verified release.

## Build-progress reports (Chris, 10 October 2026)

Use clear headings with short bullet points: Working and verified, Needs finishing,
and Blocked externally. Distinguish TEST verification from live provider/production
acceptance. This preference concerns build-progress reports, not a requested
redesign of the Slack panel. Review Drummonds branding against the live workspace
before promotion; local synthetic tenants are not evidence of live branding changes.
