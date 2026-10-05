# OpenFolk module workspace — 28 September 2026

## Scope

- `/openfolk`: client directory, saved feedback and notification delivery health, urgent indicators. Exact server counts; failed reads show unavailable, not zero. Refresh every minute.
- `/openfolk/drummonds`: same authorised tenant as the old UUID URL. Slugs resolve only against the gated client directory; old UUID links redirect and preserve search state.
- Operator-only purple shell, orange `open` and white `folk`, responsive menu. Drummonds branding and client navigation remain unchanged.
- Client overview → AI receptionist → Programme → Invoices → Delivery outcomes.
- Original Operate / Configure / Govern tools retained under Future tools, including existing deep links.
- Receptionist reuses the existing embedded workspace, feedback response/status tools, practice and call evidence. No Vapi, routing or Slack destination changes.
- Programme and priced outcomes use the same versioned client programme and existing audit history, not copied content.
- Invoice delivery notes and delivery updates use the same client-facing records. New admin-only RPCs check tenant, optimistic version, real actor, change reason and active View-As restrictions. Both writes append the existing audit log. Issued PDFs, amounts, invoice identities and payment facts remain read-only; financial corrections require the separate controlled invoice workflow.

## Verification

- TypeScript and targeted ESLint pass.
- 122 focused navigation/receptionist/operator tests pass.
- Production build and actual bundled Vapi-constructor proof pass.
- 18 PostgreSQL rollback-only checks pass against the local database: client/view-as denial, cross-tenant mismatch, stale writes, invalid data, immutable invoice financial facts, audit actor, and client-visible publication.
- New migration `20261021120000` applied alone to production and recorded in migration history. Post-deploy read-only check: two version columns; anonymous execution denied; zero customer-content writes during deployment.
- Live browser visual acceptance remains outstanding: the approved browser tool refused access because its admin-enforced security check was unavailable. No bypass attempted. No claim of a completed authenticated visual walkthrough.

## Boundaries

Health means saved reports and notification-delivery state, not continuous phone-line/provider monitoring. No reported issues is not a guarantee of service uptime. Automatic Slack destination verification and acoustic diagnosis of the reported stutter remain separate open work. No client invitations, phone activation, invoice alterations or provider changes in this release.
