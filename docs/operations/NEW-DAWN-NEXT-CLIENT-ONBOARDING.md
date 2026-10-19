# Next-client onboarding pack — M6 preparation

**Status: preparation only (19 October 2026).** This pack creates no tenant, connection, provider claim, score or client access. It is an operator checklist for the first real client after Drummonds. The M6 asset pilot is separate and held until Chris selects one authorised customer and confirms an asset source and baseline. Condition, remaining life, replacement cost and compliance cannot be inferred from a job record.

## Intake record to complete with the client

| Decision | Record before activation |
|---|---|
| Sponsor and authority | Client legal entity, authorised sponsor, data owner, processor terms, support contacts, approval evidence and date. |
| Outcome | One daily job or customer decision the sponsor needs; accountable role, measurable baseline (or **unknown**), denominator, observation window, acceptance threshold and quality/staff guardrails. |
| Source inventory | System, owner, read scope, fields, retention, historical lookback, update cadence, rate limits, revocation path and which claims become unavailable if it fails. Preserve source IDs and codes as strings in their source namespace. |
| Identity and roles | Client users, OpenFolk operators, proposed person/team links, who may confirm them, least-privilege access and audit owner. No impersonation or automatic identity confirmation. |
| Terminology and rules | Client wording for jobs, customers, teams, contracts and assets; written definitions for each metric and business policy. Keep private rules in tenant configuration, never global defaults. |
| Readiness | Backup/recovery owner, support budget, expected ongoing provider cost, incident contact, client-facing freshness wording and a rollback decision maker. |

## Sequence and evidence

1. **Select the client explicitly in OpenFolk.** Record the tenant identity and operator audit. Confirm ordinary users see only their tenant. Do not reuse a Drummonds profile, provider credential or private template.
2. **Map each source to the shared model.** Reuse `provider_connections`, tenant-scoped canonical customer/contact/site/job data, cards and the existing module controls. Use [the adapter pattern](../architecture/source-adapter-pattern.md) for a missing provider. A provider-shaped fixture is not a connected provider; a new API adapter needs separate authority and end-to-end acceptance.
3. **Start read-only and bounded.** Verify an agreed sample of source records, source IDs, freshness, failed/held counts, and revocation. Present unresolved links as review items. Never map unlike job codes by guesswork or publish a score from missing fields.
4. **Turn on capabilities one at a time.** For each, record source coverage, definition, owner, tenant-visible screen, observed acceptance and rollback. A disabled module or revoked source must remove its dependent claim, not merely hide its warning.
5. **Capture an acceptance receipt.** Include client/tenant, release SHA, source and connector versions, sample window, isolation checks, client sign-off, support hours, known gaps and follow-up owner. Keep private evidence out of Git and cross-client learning.

## Reuse proof and limits

`src/lib/new-dawn-next-client-portability.test.ts` exercises the existing workspace selector and canonical job-card search for two synthetic tenants with different names and job codes. It checks requested tenant scope, preserved string codes and rejection of foreign/mixed responses. The underlying SQL search is `security invoker`, filters by `tenant_id` and retains caller RLS (`supabase/migrations/20261101150000_learn_card_search.sql`). Existing card, provenance, score and source tests provide narrower contract checks. Run `node --test src/lib/new-dawn-next-client-portability.test.ts`.

This **does not** prove a real second tenant's RLS policy, a provider connection, asset data, finances, search beyond the tested path, generated artifacts, caches, AI-memory isolation, offboarding, restore or client acceptance. Those require an authorised isolated integration rehearsal and source-specific evidence before onboarding can be called complete. The New Dawn M6 asset register and engineer utilisation also remain held: no pilot customer/source baseline or reliable booked-versus-available hours denominator has been selected.
