# Marketing CRM — Implementation Ledger

_Living record for the staged Marketing CRM build inside ServiceOS
(`serviceos-backend-foundation` branch). Master brief:
`~/Documents/DH Works/ServiceOS-Marketing-CRM-Claude-Build-Brief.md`. This ledger is
the restart-safe source of truth for what has been decided, mapped, built and
verified. It does **not** replace the code; it explains it._

- **Authoritative product/architecture manual:** [docs/README.md](../../README.md)
  (glossary, business graph, backend principles, navigation, automation engine).
- **Canonical rule:** People + Companies are the identity model. Marketing Contacts
  is a **server-side projection** over canonical People, never an authoritative
  `marketing_contacts` table. Reuse Interactions, identity resolution, imports,
  connectors, events, Business Graph, Customer Cards, Objectives and the Automation
  Engine. Do not build a second identity model, activity feed, workflow engine,
  permission model or provider-delivery bypass.

---

## 0 · Status at a glance

| Phase | Title | State |
|---|---|---|
| 0 | Audit & design reconciliation | **Done** (this ledger) |
| 1 | Foundations (shell, route, schema, permissions, config) | **Implemented + security-hardened + DB-proven.** NOT complete as a claim: the `marketing-access` authenticated **HTTP path is unexecuted** (no local edge runtime; deploy gated) — see §7a. Clean full-chain and upgrade-path migration proofs done in disposable databases. |
| 2 | Contacts vertical slice | **COMMITTED as `24b4497`** (`feat(marketing): add governed contacts vertical slice`, 2026-07-29 — partial-staged `supabase/config.toml` marketing hunk only). One consistent record in §11: mandatory-key create idempotency (key lock before ledger read — no same-key duplicate People, ever), tenant-safe bounded identity evidence, strict payload shapes at both boundaries, single-row relationship filters, exact contact-point concurrency tokens (set_primary removed), invalid-evidence-aware eligibility, current-relationship card projection, true key-based event dedup, run-once release migration (no destructive drops). NOT launch-proven — HTTP proofs NOT RUN, populated visual QA Preview. |
| 3 | Settings, access admin, lifecycle, tags, segments, imports, audit | **Built + THREE CORRECTION PASSES + DB/PostgREST-proven, UNCOMMITTED on 24b4497** (2026-07-29) — see §12. Pass 3 (§12c, final narrow pass) verified and fixed 3 findings: over-permissive row-results transition guard (identity/lineage now pinned on every update, failed retries counted by exactly one, terminal immutability with a single-reference FK set-null as the only exception — stated honestly as a SHAPE constraint, not caller authentication), an unrecorded "matched person vanished" invalid (now a retryable 40001 → durable failed row → retry re-resolves), and single-contact assignment resurrecting inactive tags (tag_mutate assign now locks + rejects; remove/history/reactivation proven). Review 1 verified 14 defects (broken UI import flow, lossy retry counts, non-converged import identity, viewer-ceiling violation, lockout race, disabled-recovery dead end, default-stage drift, history-rewriting retirement, non-strict validation, unbounded AST recursion, incomplete segment concurrency, definition-destroying builder, false keyset pagination, ambiguous bulk counts). Review 2 verified 10 remaining gaps (live-settings default leak past the sealed contract, under-specified profile resolution, racy row-outcome upserts, incomplete finalize contract, missing external-id identity lock + name-collision review, unbound row-results references, unprotected Phase-2 tag mutations, silently-normalized nested keys, unreachable saved-segment evaluation + fragile builder shapes, leaky sample masking). Every finding was fixed in place in the SAME uncommitted draft (§12b) and proven by extended suites. Safe as a correction-passed LOCAL CHECKPOINT; NOT launch-proven — HTTP proofs NOT RUN (staged, exit 3), populated visual QA Preview. |
| 4 | Workspace sender & governed delivery (test-send vertical) | **Built + CORRECTNESS/SECURITY PASS (14 findings, §13b) + FINAL INTEGRITY PASS (6 findings, §13c: delivery INSERT invariants + terminal-fact pinning; event lineage composite-bound to the exact intent with guarded truthful history; exact auth/scope readiness + trigger-refreshed capability; RFC 2047 folded long-Unicode headers; fail-closed adapter authority reads; stale claims corrected) + §13d micro-correction, **COMMITTED as the local Phase 4 checkpoint on top of `6e64b0b`** (2026-07-29) — see §13. NOT pushed, NOT deployed, NOT launch-proven. Sender profiles composite-FK bound to existing Gmail-OAuth/Workspace-DWD mailboxes (incl. creator/updater binding); CANONICAL LIVE readiness from authoritative source state (per-mailbox connection; drives enable/capability/test/adapter/overview; health honest); `email.send_marketing` external/high with TEST-ONLY intent `send_marketing_test_email` (requires_approval FALSE — a test send is an explicitly authorised DELEGATED action under marketing.campaigns.test; NO approval row exists or is fabricated; the frozen approval guard still protects the Phase-5 broadcast boundary); frozen-envelope-only delivery (sender edits never leak into a requested send) + execution-time actor-authority recheck via the canonical resolver; request-FINGERPRINT idempotency (MK412 on reuse-with-difference, zero side effects); FACTUAL delivery states (fabricated submission structurally impossible, even for the service role); confirmed submission → canonical email row + the STANDARD interactions.sync job (deterministic, idempotent); strict status contract at the DB boundary. Engine untouched (conformance PASS incl. strengthened gate j). NOT deployed; NO real email ever sent; HTTP staged exit 3; mode truth: execution requires trusted/optimisation. |
| 5 | Broadcasts end to end | **BUILT + locally proven + INDEPENDENT ADVERSARIAL AUDIT PASS (9 confirmed defects fixed, §14e), UNCOMMITTED on `c739a39`** (2026-07-29/30) — see §14 and §14e. One campaign model around the existing skeleton: immutable revisions (one safe authored content model, allowlisted personalisation + fallbacks), append-only approvals/events, immutable audience snapshots with EVERY candidate + exact exclusion reasons, one-use digest-verified launch confirmations (DST-truthful scheduling), lease-safe dispatch (SKIP LOCKED), the bulk intent `send_marketing_broadcast_email` registered APPROVAL-REQUIRED with a genuine append-only tenant_senior approval per recipient, three-point suppression-race closure through ONE canonical SQL send authority (adapter rechecks pre-provider), multipart MIME with one-click unsubscribe, digest-only non-enumerating public unsubscribe, factual reporting (clicked/delivered honestly null — tracking NOT implemented), derived completion (unknown blocks), polished Broadcasts UI. NOT deployed; NO email ever sent; Edge HTTP/visual QA deploy-gated. |
| 5 | Broadcasts | Not started |
| 6–10 | Sequences, templates/reporting/AI, Ads, platform seams, launch | Not started |

**Honest layer separation (what "proven" means here):**
- **Implemented**: all Phase-1 code + schema below.
- **Database-tested (real boundary)**: RLS module access, canonical permission
  resolver, tenant-consistency guards, contact-point semantics, suppression
  integrity, governed materialisation RPC — via `supabase/tests/marketing_*.test.sql`
  and `scripts/marketing-access.test.mjs` (PostgREST → the real RPCs).
- **Migration-chain proven**: all 81 repo migrations apply cleanly to a fresh
  disposable database, and the marketing foundation applies cleanly on a database
  at the previous head (20260827) with data preserved.
- **HTTP-tested**: **NOT yet** — `scripts/marketing-access-http.test.mjs` exists and
  fail-closes with NOT-RUN locally; it must run against a served function
  (staging/deploy or `supabase functions serve`).
- **Deployed**: nothing (remote is untouched; deploy is explicitly gated).

Reality-tag legend (repo convention, `src/lib/capability-registry.ts`): **Live** /
**Read only** / **Preview** / **Not connected** / **Requires permission** / Hidden.

---

## 1 · Phase 0 — Repository findings & canonical concept mappings

Every brief concept was reconciled against **actual repository evidence**. Where a
canonical concept already exists it is reused; genuinely missing primitives are
listed as additive.

### 1.1 Canonical identity (REUSE — do not duplicate)

| Brief concept | Canonical repo reality | Evidence |
|---|---|---|
| Person | `people` (`id, tenant_id, company_id→companies, display_name, first_name, last_name, primary_email, primary_phone, address_text, postcode, metadata, verified, created_source`) | `supabase/migrations/20260709120000_customer_cards_foundation.sql:50`, extended `20260709140000_identity_engine.sql` |
| Company | `companies` (`id, tenant_id, name, domain, phone, address_text, postcode, metadata, verified, created_source`) | `20260709120000_...:27` |
| Person↔Company | **single nullable FK** `people.company_id`. No many-to-many join table exists. | `20260709120000_...:53` |
| Identity resolution | edge `identity-resolve` → `_shared/worker_handlers/identity_resolve.ts`, pure `_shared/identity.ts`. Confidence vocab `UNKNOWN\|POSSIBLE\|LIKELY\|CONFIRMED\|REJECTED`; deterministic (exact email/phone/domain), **no silent name merges**. | `_shared/identity.ts:15,150` |
| Weak-match review | `interaction_match_suggestions` (`match_level confirmed\|likely\|possible\|rejected`, `confidence numeric(5,4)`, `evidence jsonb`, `status pending\|accepted\|rejected\|superseded`) — evidence-led proposals, never silent merges. | `20260709120000_...:120` |

**Contact points:** there is **no customer-side multi-value contact-point table**
today — only scalar `people.primary_email` / `people.primary_phone`. The staff-only
`communication_endpoints` (Control Plane, `20260821120000`) is the prior-art *shape*
(channel / endpoint_kind / normalized_value / effective-dated) but is operator-gated
and staff-scoped. → **Phase 1 adds a canonical `contact_points` table** mirroring that
shape for customer People (not marketing-bespoke), so the platform gains a real
multi-endpoint model. Scalar `primary_email/phone` remain the fast path.

### 1.2 Interactions, events, graph, cards, objectives (REUSE — project additively)

| Brief concept | Canonical repo reality | Evidence |
|---|---|---|
| One interaction history | `interactions` — idempotency `unique (tenant_id, source_table, source_id)`; `direction inbound\|outbound\|internal\|unknown`; `related_person_id/company_id`; `processing_status pending→ready→enriched`. Projected by **hardcoded** per-channel projectors. | `20260708140000_interactions.sql:16`; `_shared/worker_handlers/interactions_sync.ts` |
| Event bus | `platform_events` (dotted `domain.noun.verb`; idempotent partial-unique on pending subject). Helper `publishEvent()`/`markEventsConsumed()`. | `20260709150000_platform_events.sql:22`; `_shared/events.ts` |
| Business Graph | `graph_nodes`/`graph_edges`/`graph_events`. Node **types are data** (`domain_entity_types`); **projection is hardcoded code** (`business_graph_sync.ts`). Confidence = 1.0 FK / <1.0 inferred. | `20260709160000_business_graph.sql`; `_shared/business_graph.ts` |
| Customer Cards | `customer_cards` — **one card per person**. `customer_card.sync` spread-merges `context: {...existing, projection}`, so a `context.marketing` blob **survives every re-sync**. Respect `locked_fields`. | `20260709120000_...:80`; `_shared/worker_handlers/customer_card_sync.ts:353` |
| Objectives & Outcomes | `objectives`, `metric_definitions`, `measurements`, `objective_links` (relation `supports\|contributes_to\|…`; `target_kind` incl. `graph_node\|intelligence_object`, **no `campaign`/`interaction`**). Attribution is **measurement-evidence gated** (opens/clicks never count); verified business-outcome evidence types are **empty in v1**. | `20260720120000_objectives.sql:167`; `_shared/intelligence/objectives.ts` |
| Generic observation/action store | `intelligence_objects` (`object_type` data-registered, RACI hot-cache, evidence, `source_interactions[]`, `source_entities[]`). Reusable for operational marketing signals, **not** strategic objectives. | `20260716120200_intelligence_objects.sql:11` |

### 1.3 Automation Engine & connectors (REUSE — no parallel sender)

- **Governed execution:** `automation_intents` (immutable `parameters`, `idempotency_key`,
  `capability_key`, `correlation_id`, `approved_payload_hash`), capability registry
  `automation_connector_capabilities`, intent-type registry `automation_intent_types`,
  **execution contract** `automation_capability_contracts` (a capability cannot be
  claimed/executed without an *enabled* contract row), append-only
  `automation_execution_attempts` (idempotency unique on succeeded), atomic RPCs
  `automation_claim_and_start` / `automation_finalize_execution` /
  `automation_resolve_unknown_execution`. Adapters in `_shared/connectors/`, registered
  in `AUTOMATION_ADAPTERS`. Evidence: `20260722120000_automation_engine.sql`,
  `20260801120000_execution_reliability_hardening.sql`,
  `20260726120000_customer_response_assistant.sql` (the template for adding a capability).
- **Adding `email.send_marketing` (Phase 4, NOT now):** migration seed (capability +
  intent type + outcome type + enabled contract) + one adapter file + one line in
  `AUTOMATION_ADAPTERS` + per-tenant `tenant_connectors`/`tenant_connector_capabilities`.
  It will be the **first `external_side_effect=true` capability** — approval/mode/health
  guards that are currently inert will fire; conformance gate G6 will need updating.
- **Connectors:** `tenant_connectors` (health/status), `connector_accounts` (cursors).
  **Credentials** via the Vault broker RPCs `provider_secret_store/read/revoke`
  (service-role only) — never on the payload. Gmail/Workspace tokens are in the older
  `email_oauth_tokens` (deny-all RLS). All Workspace/Gmail scopes are **`.readonly`
  today** (`_shared/gmail_oauth.ts:13`, `_shared/google_workspace.ts:13`) — a send scope
  (`gmail.send`) + re-consent is a Phase 4 change.
- **Scheduler/workers:** `platform_jobs` queue + `platform-worker` (lease 300s, retry
  backoff, bounded/resumable via continuations), cadence registry
  `serviceos_schedule_defs()` (`20260709180000_scheduler_cron.sql`), a documented deploy
  step (never auto-applied).

### 1.4 Imports (REUSE — preview-first, source-neutral)

`data-import` edge function: `profiles → preview (dry-run, SHA-256 checksum, redacted
sample, no writes) → apply (re-checks checksum, idempotent canonical writes +
`import_row_provenance`, never overwrites verified fields)`. Profiles are **data**
(`import_profiles`, seeded `20260815120000_import_profiles_seed.sql`;
`definition.columns[]` with `canonical/aliases/type`). A **contact import profile** =
one additive seed row (`entity_type='contacts'`), no function change. There is no
importer UI in `src/` yet. → Phase 3.

### 1.5 Frontend shell, auth, permissions, capability states

- **Shell:** `/app` is a **single route** (`src/routes/app.tsx`, ~4.8k lines) with an
  **inlined, unexported `AppShell`** and **hash-driven** internal view switching
  (`#/<viewkey>`), not multiple routes. Chrome (aside + header + wrapper) is
  `app.tsx:356–495`. Prior art for a second shelled area: `src/routes/openfolk.tsx`
  (layout route) + exported prop-driven `src/components/app/OpenfolkShell.tsx`.
- **`marketing` and `campaigns` already exist as `ViewKey`s in Labs/Preview**
  (`app.tsx:141–142,182`), rendered as `<PreviewBanner><ComingSoon/></PreviewBanner>`.
  The brief anticipates this: the real `/marketing` becomes authoritative and the Labs
  `marketing` preview is retired/redirected.
- **Auth/tenant:** `AuthProvider`/`useAuth`/`RequireAuth` (`src/lib/auth.tsx`); `profile`
  carries `role` (`owner\|admin\|ops\|viewer`) + `tenant_id`. Tenant is bound
  **server-side** by edge functions from the JWT; the client never asserts a tenant_id.
- **Edge calls:** `src/lib/api.ts` — user JWT is the bearer; `{ ok, data, error }`
  envelope; `POST ${url}/functions/v1/<fn>`.
- **Server authz:** `_shared/authz.ts` `requireTenantUser(req, admin, allowedRoles?)` →
  `AuthContext { userId, email, tenantId, role }`; `assertSameTenant`. Writes are
  **service-role only**; RLS is SELECT-only for `authenticated`.
- **Capability registry:** code array `src/lib/capability-registry.ts` — tenant labels
  Live / Read only / Preview / Not connected / Requires permission / Hidden. Add
  `marketing.*` rows.
- **Module registry:** `src/lib/modules/*` (`useModules`, `MODULES`) is connector/
  licence oriented; the real marketing gate is role + grants + `marketing_enabled` config.

### 1.6 RLS & migration conventions (the authoring rulebook)

- `current_tenant_id()` / `current_user_role()` SECURITY DEFINER helpers
  (`20260702130000_security2_feed_rls.sql:16`). `tenants` table exists
  (`20260716120000_intelligence_backbone.sql:10`); Drummonds tenant
  `00000000-0000-0000-0000-000000000001`.
- Table shape: `id uuid primary key default gen_random_uuid()`,
  `tenant_id uuid not null references tenants(id) on delete cascade`,
  `created_at/updated_at timestamptz not null default now()`, `set_updated_at()` trigger.
- RLS: `enable row level security`; `for select to authenticated using (tenant_id =
  current_tenant_id())`; **no** client write policies. Grants:
  `grant select on <t> to authenticated; grant select,insert,update,delete on <t> to
  service_role;`.
- Enums: inline `check (col in (...))` for tight vocabularies; `numeric` confidence
  `check (... between 0 and 1)`. Vocabulary tables (`<x> text primary key`) + seed.
- Append-only ledgers: raising `before update or delete` trigger. Effective-dating:
  `effective_from/effective_to (null=current)` + `version int`.
- Audit: `writeAudit(admin, {tenantId, actor, action, resourceType, resourceId, status,
  detail})` → `audit_logs`. Events: `publishEvent(...)` → `platform_events`.

---

## 2 · Gap matrix — brief requirement → resolution

| Brief requirement | Exists? | Resolution |
|---|---|---|
| Canonical People/Companies | ✅ Reuse | Project Contacts over `people`+`companies` |
| Multi-value contact points (customer) | ❌ Missing | **Add** canonical `contact_points` (Phase 1) |
| Contact relationship + lifecycle + owner + provenance | ❌ Missing | **Add** `contact_relationships` + `marketing_lifecycle_stages` (Phase 1) |
| Communication preference (append-only) | ❌ Missing | **Add** `communication_preferences` (Phase 1) |
| Hard suppression (fail-closed) | ❌ Missing | **Add** `contact_suppressions` (Phase 1) |
| Tags + Person↔Tag | ❌ Missing | **Add** `marketing_tags` + `contact_tag_assignments` (Phase 1) |
| Versioned dynamic segments | ❌ Missing | **Add** `marketing_segments` (Phase 1 skeleton; eval Phase 3) |
| Campaign umbrella + state machine | ❌ Missing | **Add** `marketing_campaigns` (Phase 1 skeleton; delivery Phase 4–5) |
| Immutable audience snapshot | ❌ Missing | Phase 5 (`campaign_audience_snapshots`) |
| Tenant marketing settings (versioned) | ❌ Missing | **Add** `marketing_settings` (Phase 1) |
| Granular marketing permissions + per-user grants | Partial (`profiles.role`, `authority_grants`) | **Add** `marketing_permissions` vocab + `marketing_access_grants` (Phase 1) |
| Protected `/marketing` route reusing `/app` shell | ❌ | **Add** `AppChrome` extraction + `src/routes/marketing.tsx` (Phase 1) |
| Governed delivery via Automation Engine | ✅ Engine exists; capability missing | Phase 4 (`email.send_marketing` capability + adapter) |
| Preview-first import | ✅ Reuse | Phase 3 (contact import profile seed) |
| Interactions/graph/cards/objectives projection | ✅ Reuse | Phase 4/5/9 (additive projectors, `context.marketing`) |

**No table-name collisions** were found for any new marketing primitive (grep over all
80 migrations): tags, segments, campaigns, consent, suppression, lifecycle,
relationship, preference, audience, enrolment, marketing, contact_points are all absent
today.

---

## 3 · Decision boundaries recorded (evidence-led)

1. **Real `/marketing` route + shared chrome (not a Labs hash view).** The brief
   mandates the protected route `/marketing`; the codebase's `/app` is a single hash-view
   route. Resolution: extract the `/app` chrome into an exported `AppChrome`, consumed by
   both `/app` and a new `src/routes/marketing.tsx` (mirrors the `openfolk.tsx` +
   `OpenfolkShell` precedent). No shell markup is duplicated. `/app#/marketing` Labs
   preview is retired to point users at the real surface.
2. **Canonical `contact_points`, not a marketing endpoint.** No customer-side
   multi-endpoint table exists; adding a marketing-only one would violate "one identity."
   Resolution: add a canonical `contact_points` table over `people` (Phase 1), shaped
   after `communication_endpoints`, platform-owned.
3. **Marketing access = role defaults + per-user grants + tenant `marketing_enabled`.**
   `profiles.role` is coarse; `authority_grants` is member/agent-scoped. Resolution: a
   marketing permission vocabulary + `marketing_access_grants` keyed by `profile_id`,
   resolved **server-side** (edge function) and mirrored client-side for nav gating only.
4. **Tenant defaults are configuration data, not code.** Lifecycle stages and marketing
   settings are seeded as a **platform template** (`tenant_id null`) in the migration and
   **materialised per tenant** idempotently by the server on first authorised access — so
   defaults are tenant rows, editable, never hard-coded Drummonds behaviour.
5. **No delivery, no automation capability, no provider scope change in Phase 1.** Send
   is Phase 4 and is the first `external_side_effect=true` capability; Phase 1 stops at the
   decision boundary and only lays inert, honest foundations.

---

## 4 · Phase 1 — build plan (this run)

**Legal state changes / trust boundaries for Phase 1:** browser reads tenant-scoped
rows via RLS; the only write path is the `marketing-access` edge function (service-role,
`requireTenantUser`) which (a) resolves the caller's marketing permissions, (b) returns
tenant marketing config, (c) idempotently materialises tenant defaults, (d) audits. No
external side effects. No campaign/contact mutation yet.

Deliverables:
- **Migration** `20260828120000_marketing_foundation.sql` — all foundation tables + RLS
  + indexes + constraints + platform vocabulary/template seeds. Additive, idempotent.
- **Edge function** `marketing-access` — server-enforced access + config + default
  materialisation.
- **Frontend** — `AppChrome` extraction; `/app` rewired + top-level Marketing nav;
  `src/routes/marketing.tsx` (protected) with Contacts/Campaigns/Ads honest sections;
  `useMarketingAccess` hook; capability-registry `marketing.*` rows; Labs `marketing`
  preview retired.
- **Tests** — SQL RLS/cross-tenant test; unit test for permission resolution + marketing
  nav gating; product-alignment.

See §6–§9 for the running record (updated as built).

---

## 5 · Acceptance matrix (linked to master brief)

Phase-1-relevant acceptance scenarios (full list Phase 10). ⏳ = foundation laid, proven
in later phase; ✅ = demonstrated this phase.

| Brief scenario | Phase | Phase-1 state |
|---|---|---|
| Permissions: admin grants a user Marketing access | P1/P3 | schema + canonical resolver **DB-proven** (grant + deny paths); admin UI P3 |
| Permissions: user without access can't see nav / open `/marketing` | P1 | **DB-proven structurally** (RLS denies direct reads without `marketing.view` — bypass closed); client gate implemented; **HTTP path of the access fn NOT yet exercised** (§7f) |
| Permissions: viewer can't mutate via direct Edge call | P1 | **DB-proven**: no client write policies; materialise RPC execute revoked from authenticated/anon; fn restricts materialisation to owner/admin (HTTP proof pending §7f) |
| Contacts: discovered Person appears by default; inclusion setting followed | P2 | config flag `include_all_discovered` laid ✅; query P2 |
| Suppression cannot be bypassed | P4/5 | schema fail-closed **DB-proven** for all three scopes (destination/person/contact-point) |
| UI states truthful (Live/Preview/Not connected) | P1 | ✅ — and section reality labels now derive from the capability registry |

---

## 6 · Files changed per phase

### Phase 1 (this run — 2026-07-29)

**Migration (new):**
- `supabase/migrations/20260828120000_marketing_foundation.sql` — 12 objects:
  `marketing_settings` (unique per tenant, versioned), `marketing_lifecycle_stages`
  (tenant rows + platform template `tenant_id null`; partial unique keys),
  `contact_points` (canonical multi-endpoint over `people`), `contact_relationships`
  (type/lifecycle/status/owner/provenance; one active per person+type),
  `communication_preferences` (append-only, raising trigger),
  `contact_suppressions` (fail-closed; one ACTIVE per tenant+channel+value),
  `marketing_tags`, `contact_tag_assignments`, `marketing_segments` (versioned defs),
  `marketing_campaigns` (status vocabulary pinned), `marketing_permissions`
  (11-permission vocabulary seed), `marketing_access_grants` (per-profile overrides).
  All tenant tables: RLS SELECT via `current_tenant_id()`, service-role-only writes,
  `set_updated_at()` triggers, tenant-first indexes. 8-stage lifecycle template seeded
  as configuration data (materialised per tenant at runtime — nothing Drummonds-coded).

**Edge function (new):**
- `supabase/functions/marketing-access/` — `requireTenantUser`-authorised;
  idempotently materialises tenant settings + lifecycle stages from the template
  (plain insert — ON CONFLICT cannot target the partial unique index; count-guard +
  unique index make races harmless); resolves permissions (role defaults + grant
  overrides, deny wins); audits materialisation via `writeAudit`; returns config +
  stages + permission set. Registered in `supabase/config.toml` (verify_jwt=false,
  auth inside).

**Frontend:**
- `src/components/app/AppChrome.tsx` (new) — the ONE shared shell frame (sidebar
  frame, mobile drawer, header, brand, tenant footer, logout, LiveCallCard),
  extracted verbatim from `/app`; nav supplied by render-prop.
- `src/routes/app.tsx` — `AppShell` now composes `AppChrome` (no chrome markup left
  inline); top-level Marketing nav item (`MarketingNavLink`, shown only when the
  server grants `marketing.view`); Labs `marketing` preview retired → redirect to
  `/marketing` (`MarketingMoved`); hash views + Labs + Open Folk unchanged.
- `src/routes/marketing.tsx` (new) — protected `/marketing` (RequireAuth), exactly
  three sections in order (Contacts, Campaigns, Ads); honest states: Live tenant
  config + lifecycle pipeline; Preview for contact list/imports/campaign areas;
  **Not connected** for Meta/Google/LinkedIn; "Requires permission" rendered ONLY
  after the server has answered; unreachable check = error card + Try again.
- `src/lib/marketing/permissions.ts` (new) — permission vocabulary + role defaults +
  pure resolver (client mirror of the server).
- `src/lib/marketing/access.ts` (new) — typed client for `marketing-access`.
- `src/lib/marketing/useMarketingAccess.ts` (new) — deterministic access hook
  (plain effect + shared in-flight promise + per-user cache; deliberately NOT React
  Query — see decision 6).
- `src/lib/capability-registry.ts` — REGISTRY_VERSION bump + six `marketing.*`
  entries (route/lifecycle LIVE-READ_ONLY proven; contacts/imports/campaigns
  PREVIEW; ads "Not connected"). Prettier-normalised.

**Tests (new):**
- `supabase/tests/marketing_foundation.test.sql` — 7 assertion groups (seeds, RLS
  enabled, two-tenant isolation, client-write denial, append-only preferences,
  suppression dedup).
- `src/lib/marketing/permissions.test.ts` — 6 unit tests (role defaults, grants,
  deny override, unknown-permission rejection).
- `scripts/marketing-access.test.mjs` — 11-check materialisation proof replaying the
  function's exact call sequence against the real DB (idempotency, template copy,
  duplicate-race rejection, vocabulary).

### Decision 6 (added during build)
React Query was tried first for the access hook; its online/offline `networkMode`
left a failed check permanently "paused" (pending, no error) in event-unreliable
browser contexts — an unresolvable limbo that read as "Requires permission". An
access gate must always settle to data or error, so it uses a plain effect with a
module-level shared promise. Recorded as evidence for future gates.

## 6a · Security & architecture hardening pass (2026-07-29, same day)

An independent review of the Phase-1 checkpoint raised findings; every one was
verified against the code, confirmed, and corrected. Record of findings →
resolutions (all covered by the tests in §7):

| # | Finding (confirmed) | Resolution |
|---|---|---|
| 1 | `marketing-access` materialised config **before** checking permissions; unchecked query results; silent fallback to role defaults on grant-read errors; full config returned to any tenant user | Function rewritten as a thin, fail-closed shell over **canonical DB authorities**: permissions resolved FIRST via RPC `marketing_effective_permissions`; every result checked; any resolver/config error → HTTP 500 with no access and an `audit_logs` row; denied callers get ONLY `{can_view:false, reason}` (no settings/stages/permissions/role); materialisation is owner/admin-only via the service-role-only RPC `marketing_materialise_defaults` — checking access never mutates config |
| 2 | **Direct-read bypass**: RLS gated only on `tenant_id = current_tenant_id()`, so a same-tenant user without `marketing.view` could read every Marketing table directly | **Structural RLS enforcement** (approach 2, documented): one canonical resolver — `marketing_role_defaults` (defaults as data) + `marketing_effective_permissions` (SECURITY DEFINER; role defaults ∪ explicit grants ∖ explicit denies; `marketing_enabled` gate; fail-closed) — wrapped by `marketing_has_permission()` and required by every protected table's SELECT policy. Grants table requires `marketing.access.manage`. Vocabulary tables stay platform-readable (authority_permissions convention). The Edge Function consumes the SAME resolver — no duplicated authority |
| 3 | Single-column FKs allowed cross-tenant lineage under a service-role bug | `marketing_tenant_guard()` trigger (canonical `automation_vertical_tenant_guard` pattern, jsonb-based for mixed row shapes) on all 10 marketing tables: person/company/contact-point/tag/segment refs must match the row's tenant; lifecycle stage keys must exist for the tenant (or template); ALL profile-reference columns (owner/created_by/updated_by/recorded_by/assigned_by/approved_by/launched_by/profile_id/granted_by) must name an existing profile **in the same tenant** (see §6b — the initial tenantless-profile allowance was itself a finding and was removed) |
| 4 | `contact_points` unique `(tenant, channel, normalized_value)` forced one Person per endpoint — contradicting shared-device handling and "no silent merges" | Uniqueness moved to **per-Person**: `(tenant, person, channel, normalized_value)`; shared endpoints across People are allowed and surface as ambiguity for identity review; non-unique lookup index `(tenant, channel, normalized_value)` retained; **one primary per (person, channel)** enforced by partial unique index. Scalar `people.primary_email/phone` documented as the canonical fast path until a governed backfill |
| 5 | `timezone` defaulted every tenant to `Europe/London` (Drummonds assumption) | Default now `UTC` (no canonical tenant-timezone source exists — `tenants` has none). Drummonds receives `Europe/London` as tenant configuration via Settings (Phase 3) or a tenant-data seed, never as schema/application logic. Remaining sweep: relationship/lifecycle defaults are universal template vocabulary from the brief, `reply_handling` is a mode default — no tenant-specific values remain in the migration. Frontend note: the shared `/app` chrome's "Drummond Heating/DH" branding is **pre-existing** shell behaviour carried over unchanged, recorded as platform debt (tenant-branding source), not introduced by Marketing |
| 6 | Capability registry claimed `marketing.route` LIVE/`proven:true` with the HTTP layer unexecuted | Both `marketing.route` and `marketing.lifecycle` downgraded to `PREVIEW`/unproven with explanations distinguishing DB-proof from HTTP-proof; `/marketing` section cards read their reality label FROM the registry (`getCapability`) so the UI can never out-claim it |
| 7 | Prior "migration applies" evidence was a direct psql run onto a drifted local DB | Full **clean-chain** (81 migrations, fresh disposable container) and **upgrade-path** (chain→20260827 head, seed data, apply marketing, data preserved, +13 tables exactly) proofs — see §7. Local dev DB drift documented below |
| 8 | Template rows `tenant_id is null` needed review | Confirmed canonical: identical to `import_profiles` platform defaults. Protections verified: no client write policies anywhere (service-role only), template reads now ALSO require `marketing.view`, materialisation copies template→tenant rows only, tenant renames/retirements touch only tenant rows, count-guard + partial unique indexes make the copy race-safe. Kept on repository evidence |
| 9 | Suppression dedup only covered non-null destinations | Three-scope active dedup: destination `(tenant,channel,normalized_value)`, person `(tenant,channel,person)` when no destination/point recorded, contact-point `(tenant,contact_point)`; plus `contact_suppressions_target_check` (a suppression must name a target). Lifting preserves history/actor/evidence and allows re-suppression |
| 10 | 553-line formatting-only churn in `capability-registry.ts`; ledger claims ahead of reality | File restored to original formatting via `git checkout` + entries re-added in the file's own compact style (diff is now additive); this ledger reconciled (this section, §0, §5, §7) |

## 6b · Final authorization correction (2026-07-29, follow-up review)

Two further findings, both confirmed and corrected in the same uncommitted
migration:

**(1) Arbitrary profile permission inspection.**
`marketing_effective_permissions(p_profile_id)` was executable by `authenticated`
with a caller-supplied profile id, letting any signed-in user inspect another
user's effective permissions/enabled/settings-existence state. Corrected
structurally (preferred design): the arbitrary-profile resolver is now
**service-role-only** (the marketing-access Edge Function's path); authenticated
users get exactly one self-only wrapper, `marketing_current_user_permissions()`
(no parameters — resolves `auth.uid()` only), which `marketing_has_permission()`
and therefore every RLS policy consume; the wrapper delegates to the single
canonical resolver (no duplicated logic; SECURITY DEFINER ownership makes the
delegation work despite the service-role-only grant); anon has no execution path
on any of the three. Proven at the REAL PostgREST/GoTrue boundary
(`scripts/marketing-access.test.mjs`, 25/25): a signed-in ops user resolves
themselves; the same JWT gets **42501** attempting to resolve a same-tenant user
AND a tenant-B profile; a pure anonymous client gets 42501 on both functions;
service role resolves arbitrary profiles; deny/disabled verdicts unchanged; RLS
suites re-pass (policies still route through the canonical resolver).

**(2) Tenantless profiles are not platform operators.**
The tenant guard allowed profile-reference columns when `profiles.tenant_id is
null`, treating tenantlessness as platform authority. That contradicts the
platform model (`20260822120000`): authority requires an ACTIVE
`platform_authority_grants` row, and `platform.controlplane` authority
deliberately confers **no tenant-data access**; Marketing has no governed
cross-tenant mutation capability. Corrected: every supplied profile-reference
UUID must name an existing profile **of the same tenant** — tenantless profiles
are rejected with or without an active `platform.controlplane.admin` grant;
nullable actor columns stay null for genuine system actions, attributed via
`audit_logs.actor` (`'service'`); `marketing_materialise_defaults(p_actor)` now
also rejects cross-tenant/tenantless actors and audits null-actor runs as
`service`. A future OpenFolk cross-tenant Marketing operation must arrive as an
explicit permissioned capability + audited API, never a trigger exception.
Proven in `marketing_hardening.test.sql` §(4)/(7b)/(9): same-tenant actors
succeed, other-tenant/unknown/tenantless (granted or not) rejected, null-actor
attribution verified.

**Migration-packaging decision:** all hardening is folded into the SAME
`20260828120000_marketing_foundation.sql` rather than a follow-up migration,
because the foundation is uncommitted and has never been applied to any
authoritative environment — one coherent migration is the honest history. The file
additionally self-upgrades over the earlier local draft (drops the superseded
contact-point index, resets the timezone default) so the local dev DB converges by
re-running it.

## 7 · Verification performed & results (Phase 1 + hardening)

Evidence is layered — each row states exactly which boundary it exercises.

**(a) Direct SQL compilation / local application**
| Check | Result |
|---|---|
| Hardened migration applies to the local dev stack (self-upgrade over draft) | ✅ |

**(b) Clean full-chain migration (fresh disposable `supabase/postgres:17.6.1.141` container)**
| Check | Result |
|---|---|
| All **81** repo migrations apply in canonical order (no name/order/object conflicts, no function/RLS replacement regressions) | ✅ |
| `marketing_foundation` + `marketing_hardening` + pre-existing `control_plane` + `automation_engine` SQL suites pass on the resulting schema | ✅ (env bootstrap shim documented: minimal `storage.buckets` + GoTrue's `is_sso_user`/`is_anonymous` columns, which services provision in real environments) |

**(c) Upgrade-path migration (second disposable container)**
| Check | Result |
|---|---|
| Chain through the previous head `20260827120000` applies | ✅ |
| Seeded tenant/person/interaction data, then applied the marketing foundation | ✅ applied cleanly; **data preserved**; table delta exactly +13 (12 domain tables + `marketing_role_defaults`); no drops of unrelated objects; no history manipulation |
| Both marketing SQL suites pass on the upgraded database | ✅ |

**(d) RLS & structural integrity (real database boundary)**
| Check | Result |
|---|---|
| `supabase/tests/marketing_foundation.test.sql` (isolation, write-denial, append-only, dest-suppression, RLS-enabled, seeds) | ✅ ALL ASSERTIONS PASSED |
| `supabase/tests/marketing_hardening.test.sql` — resolver verdicts (owner/admin/ops/viewer/granted-viewer/denied-admin/disabled-tenant/unknown-profile); same-tenant viewer & denied-admin read ZERO from all 11 protected tables; granted viewer reads; grants need `access.manage`; cross-tenant zero; authenticated writes + RPC execute denied; 12 cross-tenant reference classes rejected + valid same-tenant rows accepted + null-actor rows allowed; **tenantless profiles rejected as actors with AND without an active platform.controlplane.admin grant**; materialise-RPC actor integrity (cross-tenant/tenantless rejected, null audited as 'service'); **authenticated role can execute only the self-only resolver wrapper** (arbitrary-profile resolver → insufficient_privilege); shared endpoints/dup-person/primary rules; 3-scope suppression dedup + target check + lift/re-suppress | ✅ ALL ASSERTIONS PASSED (local dev DB AND both disposable DBs) |
| `git diff --check` | ✅ clean |

**(e) Data-logic boundary (real RPCs via PostgREST — NOT copied logic)**
| Check | Result |
|---|---|
| `scripts/marketing-access.test.mjs` — resolver verdicts over real auth users; **authenticated grant boundary over real GoTrue JWTs via PostgREST** (self-resolve OK; cross-profile and cross-tenant resolve → 42501; pure-anonymous → 42501 on both resolver functions); service role resolves specified profiles; materialise RPC blocked for anon (42501); idempotent materialisation + single audit row; UTC default; disabled-tenant strips owner | ✅ 25/25 PASS |
| `node --test src/lib/marketing/permissions.test.ts` (client mirror, advisory) | ✅ 6/6 |

**(f) Authenticated HTTP boundary — NOT EXERCISED (honest)**
| Check | Result |
|---|---|
| `scripts/marketing-access-http.test.mjs` (full contract: owner/admin, ops non-materialising, minimal viewer deny, explicit grant, explicit deny, 401, idempotency) | ⏸ **NOT-RUN (exit 3)** — no edge runtime exists locally and none may be installed; the script refuses to fake success. **Required staging verification:** serve `marketing-access` (deploy or `supabase functions serve`) and run this script with staging env; it must print "ALL PASS (real HTTP boundary exercised)" before `marketing.route` may be marked Live/proven |

**(g) Regression + build**
| Check | Result |
|---|---|
| `npm run test:openfolk` / `npm run verify:product` | ✅ 23/23 / passed |
| ESLint on changed files | ✅ clean on all changed files except `capability-registry.ts`, which deliberately keeps its pre-existing (non-prettier) formatting to avoid 550 lines of unrelated churn — repo-wide lint separately fails on ~1,977 pre-existing violations in untouched files |
| `npm run build` (production) | ✅ |
| Visual QA | ✅ re-verified after hardening (fail-closed states unchanged) |

**Local dev DB drift (finding 7 report):** recorded migration history stops at
`20260821120000` (73 rows), yet objects from `20260822`–`20260827` AND the marketing
foundation exist — direct psql application has been this stack's established proof
style since before this phase. Remedy when the supabase CLI is next available:
reset the local stack and let the CLI apply the (now chain-proven) full migration
set, or `supabase migration repair` to reconcile history. No history records were
edited by hand.

## 8 · External configuration still required
- **Phase 4:** `gmail.send` scope + Workspace re-consent; `email.send_marketing`
  capability/adapter/contract; per-tenant connector capability enablement.
- **Phase 8:** Meta/Google/LinkedIn ad adapters + credentials (Not connected until real).
- Scheduler cron rows for any marketing scheduled sync (Phase 5+), deploy step.

## 9 · Honest limitations / blocked items
- Remote prod migration/deploy is **not** performed without explicit approval (memory:
  state-changing `db push`/`functions deploy` are gated). Phase 1 is local/branch only.
- The `marketing-access` **HTTP layer has not been executed**: the local Docker stack
  has no edge-function runtime and no Deno/supabase CLI is installed on this machine
  (and none may be installed without approval). Its auth scaffold is the proven
  `ownership-projection` pattern; its permission and bootstrap logic now LIVE IN THE
  DATABASE and are proven at that real boundary (§7d/e). The remaining gap is the
  HTTP/auth shell itself: `scripts/marketing-access-http.test.mjs` covers the full
  contract and must pass against a served function (staging or `functions serve`)
  before anything is labelled Live/proven. Until then the /marketing surface shows
  its honest "Marketing is unavailable" error and the /app nav hides Marketing
  (fail-closed, visually verified).
- Contacts/Campaigns/Ads render as **Foundation/Preview** — the read/write logic lands
  in Phases 2–8; nothing is faked as Live.
- A local test fixture user (`phase1-proof@local.test`, admin on the local Drummonds
  tenant) exists in the LOCAL Docker auth DB only, created for visual QA.

---

## 11 · Phase 2 — Contacts vertical slice (2026-07-29; committed as `24b4497`)

_One consistent record. Phase 2 went through the initial build, an independent
hardening review, a follow-up correctness review, a verification pass, and a
FINAL CORRECTION PASS (2026-07-29) that executed the final checkpoint findings
against the running code. That last pass fixed, structurally: (1) the Edge
boundary rejected the server's own null-v last-contact cursor; (2) no-op edits
emitted false `updated` events; (3) the name-only/same-key create race (both
racers saw an empty key ledger, both committed a Person, the loser converged on
the stored result but its duplicate Person stayed committed) — the tenant+key
advisory lock is now taken BEFORE the ledger read, the key and a real
same-tenant actor are mandatory, and the fingerprint is canonical stored JSON
over every material field including first/last names; (4) destructive
`drop table` statements were removed from the release migration (it is a normal
run-once migration; drifted local draft DBs are reset, never patched by release
SQL); (5) strict payload shapes and relationship-contract combinations are
enforced at both boundaries with zero-write proofs; (6) the contact-point
concurrency token is the exact opaque timestamp and the unprotected
`set_primary` shorthand was removed; invalid points can never become primary;
(7) invalid contact-point evidence now beats the scalar fallback in
eligibility; (8) identity-evidence queries join candidates back to the tenant
on BOTH sides and stored arrays are bounded (25 + per-identifier truncated
flag); (9) relationship filters must all match ONE relationship row, which is
the row projected, and the Customer Card always re-projects the CURRENT
relationship (with `relationship_id`) after any mutation; (10) event dedup is
truly key-based (same `k` never re-appends; `current` moves only on a new key).
All folded into the SAME migration
`20260829120000_marketing_contacts_projection.sql`, committed at `24b4497`
(never applied to any authoritative environment — deploy remains gated).
Superseded interim claims from earlier passes are replaced by this section._

### What is implemented

**Server (service-role-only SQL, the testable production boundary):**
- `marketing_normalize_endpoint(channel, value)` — the ONE channel-aware
  normaliser (emails format-validated + lowercased; phone/sms/whatsapp reduced to
  `+digits`, min length; malformed → NULL) used by matching, writes, eligibility
  and suppression visibility alike.
- `marketing_endpoint_eligibility(tenant, person, channel, contact_point?,
  destination?, topic?)` — the AUTHORITATIVE pre-send decision
  (`subscribed | unsubscribed | suppressed | unknown | invalid | no_contact_point`).
  Suppression (person/contact-point/destination scope, normalised — formatted
  scalar phones included) always wins. Preference precedence is SCOPE-RANKED —
  (endpoint+topic) > endpoint > topic > person/channel; latest within the most
  specific applicable scope decides, so a newer generic subscribe can never
  override a specific unsubscribe while a later same-scope resubscribe works.
  A destination that is not a usable endpoint of the Person is `invalid` (never
  inherits a generic subscription); invalid points are never usable defaults;
  INVALID EVIDENCE BEATS THE SCALAR — when a contact point marked invalid
  carries the same normalised value as the Person's scalar, the scalar IS that
  known-bad endpoint and the verdict is `invalid` (a different usable endpoint
  is still selected when one exists); cp+destination inputs must agree.
  `marketing_contact_eligibility` is only the Person-level LIST SUMMARY
  delegating to the endpoint fn.
- `marketing_contacts_list(tenant, args)` — keyset pagination (name/created/
  last_contact × asc/desc; cursor contract `{v, id}` typed PER SORT: v is a
  string for name/created and string|NULL only for last_contact — null v is the
  explicit null-last-contact sentinel, round-tripped end-to-end, and a
  mistyped/malformed cursor raises 22023 at BOTH the SQL and Edge boundaries
  rather than being silently ignored); full filter set
  (search, company, eligibility, classified, tag include/exclude, created +
  last-contact ranges, plus the RELATIONSHIP predicates — lifecycle, type,
  status, owner, relationship source — which form ONE contract: when any is
  supplied, a SINGLE relationship row must satisfy ALL of them together
  (filters can never be satisfied by different rows) and that matching row IS
  the projected relationship, chosen deterministically (active > inactive >
  archived, then oldest); without relationship filters the projection is the
  documented current/display relationship under the same ordering); one row per
  Person, never duplicated; `classified` = has an ACTIVE relationship; card
  next-action; explicit tenant predicates on every join; malformed input →
  clean 22023.
- `marketing_contacts_counts`, `marketing_contact_detail` (ALL relationships;
  per-endpoint eligibility + protected flag per point; destination suppressions
  matched against normalised endpoints incl. scalars — "suppressed" is never
  shown with its cause hidden).
- `marketing_classify_contact` — STRICT SHAPE (array/scalar/empty changes →
  22023 with zero writes); explicit contract combinations: `expected_version`
  without `relationship_id` is invalid, `allow_new` applies only to a new
  classification, a non-active `status` on create is rejected (never silently
  ignored), booleans must be real JSON booleans. Updates target an EXPLICIT
  `relationship_id` with MANDATORY `expected_version` (stale → MK409; 40001 is
  unusable — PostgREST auto-retries it, discovered at the real boundary); no-op
  mutations are rejected (no false version bumps/phantom transitions);
  create-classification requires no active relationship and `allow_new` when
  only historical rows exist (reactivation is an explicit status update by id);
  owner validated (`marketing_validate_owner`) and stored on BOTH paths;
  Customer Card `context->marketing` NESTED merge (other engines' subkeys +
  non-marketing context survive; `locked_fields` respected) is RECOMPUTED from
  the CURRENT/display relationship after every mutation and includes
  `relationship_id` — editing a historical row never overwrites the card with
  non-current state.
- `marketing_create_contact` — 0 matches → create; exactly 1 Person → `existing`;
  >1 → `ambiguous` with bounded (≤6, `truncated` flagged) minimal candidates
  (person_id, display_name, matched_on[]) + durable `marketing_identity_conflicts`
  record whose `identifiers` field lists, PER supplied identifier, exactly which
  People matched it (mixed email/phone matches are never mislabelled); every
  evidence query joins the candidate Person back to the tenant on BOTH sides
  (corrupt cross-tenant contact-point refs can never leak a foreign Person id)
  and stored candidate arrays are bounded (25 ids + per-identifier truncated
  flag). Concurrency & idempotency (mandatory): `p_idempotency_key` and a REAL
  same-tenant actor are required (null → 22023 before any write); the
  tenant+key advisory lock is taken FIRST, before the ledger read, so same-key
  racers — including name-only creates — can never both see an empty ledger
  and each commit a Person; the ledger returns/conflicts before any identity or
  Person mutation; only then the per-identifier locks (email then phone,
  deterministic) serialise overlapping identities; the unique (tenant, key)
  constraint stays as defence in depth. The fingerprint is canonical stored
  JSON (jsonb text, sorted keys — collision-free by construction) over EVERY
  material field: display/first/last name, normalised email/phone, company,
  owner, relationship type, lifecycle stage; identical retry returns the stored
  result, any material difference → 55000. Different keys with identical
  name-only input intentionally remain two People.
- `marketing_update_contact` — STRICT SHAPES throughout (body and every nested
  block/item must be its declared shape; arrays/scalars/malformed items and
  non-boolean flags → 22023 before ANY write, audit or event). Person fields
  (names blocked on verified People → MK403 PROTECTED_FIELD), company,
  contact-point ADD / UPDATE. The UPDATE contract: explicit id + EXACT opaque
  `expected_updated_at` comparison (the client returns the server's own
  timestamp verbatim; the token is never truncated) → MK409 on any mismatch;
  the `set_primary` shorthand was REMOVED (it bypassed the optimistic contract)
  — primary changes go through update items under the same token; an INVALID
  point can never become primary; value edits only on manual-source unverified
  points → MK403 otherwise; a value change first takes the SAME
  tenant+channel+normalised-value advisory lock creates use, then re-runs the
  identity check (tenant-joined on both sides, bounded 25) and records conflict
  evidence with BOTH an audit row and an event, without blocking — shared
  endpoints are legal; audits and events for real changes carry BEFORE/AFTER
  values. Relationship changes delegated to classify.
  NO-OP SEMANTICS: sub-operations that change nothing (identical person fields,
  identical value/label, make_primary on the current primary) update
  nothing and emit nothing; supplying the CURRENT value of a protected point is
  a no-op, not MK403 (protection guards changes, so a label-only edit beside an
  unchanged protected value still lands); a request whose every sub-operation is
  a no-op raises 22023 — false `updated` transitions are never emitted.
- `marketing_tag_mutate` (create/assign/remove), `marketing_owners_list`
  (bounded directory — the UI never accepts a free-form owner UUID).
- `marketing_identity_conflicts` (identifiers evidence, truncation, idempotency
  correlation, status-governed) and `marketing_request_keys` tables.

**Events (actual emissions, tested by type + payload):** `marketing.contact.created`
· `classified` (creation) · `lifecycle_changed` · `owner_changed` ·
`relationship_type_changed` · `relationship_status_changed` (per-field, with
from/to/version/actor/relationship_id; only for fields that actually changed) ·
`contact.updated` · `contact_point.created` · `contact_point.updated` ·
`tag.created` · `contact.tag_changed` · `identity_conflict.created` — all via
`marketing_event_append` — dedup is TRULY KEY-BASED: every entry must carry a
non-empty stable `k` (else 22023); a pending transition with the same `k`
blocks the append entirely (identical `k` with a different timestamp adds
nothing and `current` moves only when a genuinely new key is accepted);
different keys append independently; retries/no-ops emit nothing; bus
invariant intact — and audited in the same transaction.

**Edge function `marketing-contacts`:** thin canonical-resolver shell; per-action
permission map; REQUIRED idempotency key on create (missing or explicit null →
400); STRICT SHAPES mirrored from SQL — the request body and every nested
changes block (details/changes/person/relationship/contact_points/each
add-update item) must be a plain object, arrays and scalars → 400; booleans
(`allow_new`/`clear_owner`/`clear_company`/`make_primary`) must be real
booleans; relationship contract combinations enforced (`expected_version`
without `relationship_id`, `allow_new` with `relationship_id` → 400);
`set_primary` rejected with a pointer to the update-item contract; full input
validation (uuids/enums/limits/sort/dir/dates/names/labels; cursor typed per
sort — v: null is ACCEPTED only for last_contact so the server-issued sentinel
cursor round-trips, and rejected for name/created); stable error contract
(`INVALID_REQUEST / NOT_FOUND / FORBIDDEN / VERSION_CONFLICT /
IDEMPOTENCY_CONFLICT / DUPLICATE / PROTECTED_FIELD / INTERNAL`)
— raw DB messages never reach the browser.

**UI (`MarketingContacts.tsx`):** list with live counts, full filter set
(search, lifecycle, eligibility, owner, relationship type/status, source,
company via a server-backed searchable bounded select, classified, tag
include/exclude, date ranges, sort + direction — every control drives the server
query and resets pagination); columns incl. last contact, real card next-action
and an intentional "—" Campaigns column (Phase-5 dependency recorded); detail
dialog (per-endpoint eligibility, suppression scope+reason, ALL relationships,
canonical timeline, Customer Card head); quick classify targeting the explicit
relationship id/version; edit dialog (names/company via searchable directory,
full relationship editing — lifecycle/type/status/owner —, contact-point ADD +
EDIT with protected values explained, primary selection); create dialog with the
idempotency-key LIFECYCLE (transport-failure retry reuses the key; edited inputs
start a new attempt with a new key; after existing/ambiguous the form freezes
with "Start another attempt"); VERSION_CONFLICT → reload + "changed elsewhere";
every mutation result checked with busy/error/retry states.

### Decisions of record
- `interaction_match_suggestions` deliberately NOT used for manual-create
  ambiguity (no interaction exists) — `marketing_identity_conflicts` is the
  smallest governed record.
- "Classified" = has an ACTIVE relationship; historical rows never silently
  shadowed (`allow_new` explicit).
- Custom SQLSTATEs MK409/MK403 (PostgREST retries 40001; protected-field needs a
  stable non-authz code).
- Campaigns column stays an honest "—" until the Phase-5 participation model.

### Verification matrix (explicit statuses)

| Boundary / check | Status |
|---|---|
| `supabase/tests/marketing_contacts.test.sql` — 20 sections: inclusion + classified definition; SINGLE-ROW relationship filters (all supplied predicates — lifecycle/type/status/owner/relationship-source — on ONE row; cross-row combinations proven non-matching; the matching row is the projected relationship; no duplication); invalid input 22023s incl. the TYPED cursor contract (null v rejected for name/created, non-object and v-less cursors rejected, never ignored); pagination name + NULL-heavy last-contact asc/desc (no gaps/dups, null-v cursors round-trip); eligibility normalisation/linkage/mismatch/malformed/invalid-primary/scope-ranked precedence + same-scope resubscribe + INVALID-SCALAR-EVIDENCE (invalid point matching the scalar → invalid; usable alternative still selected); formatted-scalar suppression visibility; per-identifier ambiguity evidence (mixed email/phone never mislabelled) + conflict event; mandatory-key fingerprint idempotency (all material fields incl. first/last names; payload + actor conflicts; NULL key and NULL actor → 22023 with no writes); §9b STRICT SHAPES + relationship contract (array/scalar/empty changes, expected_version-without-id, allow_new-with-id, non-active status on create, non-boolean flags → 22023 with ZERO writes/audits/events); explicit relationship targeting + mandatory version + no-op rejection + allow_new + reactivation; owner persistence/validation; Customer Card current-relationship projection (relationship_id included; historical-row edit never overwrites the card); per-field event types + payloads + transition accumulation; §11b TRUE key-based event dedup (same k + different timestamps → one transition, current unchanged; new k appends; empty k → 22023); contact-point update with EXACT concurrency token + protection + before/after audit evidence + conflict AUDIT on endpoint edits; §12b no-op edit semantics + removed set_primary shorthand + invalid-primary rejection + stale-token-on-primary MK409; tag events incl. tag.created; corrupted cross-tenant fixtures incl. §15b EVIDENCE leakage (foreign Person ids never in candidates/identifiers/candidate_person_ids on create or edit paths); authenticated RPC denial | **PASS** (local + clean-chain + upgraded DBs) |
| `scripts/marketing-contacts.test.mjs` — real GoTrue JWTs: 9 RPCs denied 42501 (authenticated + anon); service end-to-end; byte-identical different-key parallel creates → one Person; **OVERLAPPING-identity parallel creates → one Person, one existing**; **SAME-KEY name-only parallel creates → exactly ONE Person, identical results (key lock, no orphan duplicate)**; **same-key identified parallel → one Person**; identical retry returns stored result; same key + changed payload → 55000; **same key + changed first_name → 55000**; **null key → 22023 with no writes**; **different-key identical name-only → two People intentionally allowed**; ambiguity + per-identifier evidence; MK409 stale version; update surface; **concurrent contact-point updates → one winner + one MK409** | **PASS** (42/42) |
| `scripts/marketing-access.test.mjs` (regression) 25/25 · foundation + hardening SQL suites · unit 6/6 · openfolk 23/23 · product-alignment · lint (changed files) · `tsc --noEmit` clean repo-wide (the one error it found — a too-narrow tag-helper type in `MarketingContacts.tsx` — was a Phase-2 defect, fixed this pass) · production build · `git diff --check` | **PASS** |
| Clean full chain (82 migrations = 81 tracked + the contacts migration, fresh disposable container; the unrelated untracked telephony migration from a concurrent session is excluded from Phase-2 scope) + 5 SQL suites (foundation, hardening, contacts, control_plane, automation_engine) | **PASS** (re-proven after the verification-pass fixes) |
| Upgrade path (tracked chain → committed head 7cf1dcf → seed people/relationship/contact-point/preference/suppression → corrected 20260829 applies as a normal RUN-ONCE migration — no destructive drops, no reapplication claim; data preserved; table delta exactly +2; all 3 marketing suites pass on the upgraded DB) | **PASS** (re-proven after the final correction pass) |
| Authenticated Edge HTTP (`marketing-access-http` / `marketing-contacts-http`, now covering create/retry/fingerprint-conflict/ambiguous/update/cp-update/stale-version/invalid-cursor/**null-v cursor accepted for last_contact + rejected for created**/**wholly no-op update → 400**/**missing AND explicit-null idempotency key → 400**/**array body / array changes / array person → 400**/**expected_version without relationship_id → 400**/per-mutation denials/safe bodies/cross-tenant) | **NOT RUN** — no edge runtime exists locally and none may be installed; scripts exit 3 rather than fake success (re-confirmed this pass: both exit 3). Blocker: deploy or `supabase functions serve` on a machine with the CLI |
| Populated responsive UI QA | **Preview** — blocked by the same runtime gap (the access gate fail-closes before data loads); fail-closed error state verified in-browser. To complete on staging |
| Capability registry | `marketing.*` remain **Preview** until the HTTP proofs pass. Phase 2 is safe as a LOCAL CHECKPOINT; it is **not launch-proven** until HTTP + visual gates pass |

### Phase 2 commit scope (reconciled from the working tree, 2026-07-29)

Exactly ten files:
`docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md` ·
`scripts/marketing-contacts-http.test.mjs` · `scripts/marketing-contacts.test.mjs` ·
`src/components/app/MarketingContacts.tsx` · `src/lib/marketing/contacts.ts` ·
`src/routes/marketing.tsx` · `supabase/config.toml` ·
`supabase/functions/marketing-contacts/index.ts` ·
`supabase/migrations/20260829120000_marketing_contacts_projection.sql` ·
`supabase/tests/marketing_contacts.test.sql`.
EXCLUDED unrelated areas (other sessions' work, preserved untouched):
`docs/product-review/`, `docs/run-checkpoints/`,
`scripts/telephony-capability-probe.mjs`,
`supabase/functions/telephony-capability-audit/`, and the concurrent session's
in-flight phone-operations work (migration
`20260830120000_phone_operations_control.sql`, `supabase/functions/phone-operations/`,
`_shared/phone_operations.*`, `src/lib/phone-operations.ts`,
`src/components/app/admin/PhoneOperations.tsx` +
`PhoneReliabilityControl.tsx`) — not marketing, not staged; the 20260830
migration sorts AFTER the contacts migration, so committing Contacts first
keeps chain order.

**`supabase/config.toml` is now a SHARED file** carrying two independent
working-tree hunks: the `[functions.marketing-contacts]` entry (Phase 2) and an
unrelated `[functions.phone-operations]` entry (the concurrent session's).
The Marketing checkpoint must stage ONLY the marketing-contacts hunk — e.g.
`git add -p supabase/config.toml` (stage the `[functions.marketing-contacts]`
hunk, skip the phone-operations hunk), or `git diff -- supabase/config.toml`
→ edit to the marketing hunk → `git apply --cached`. NEVER `git add
supabase/config.toml` blindly.


## 12 · Phase 3 — Settings, access admin, lifecycle, tags, segments, imports, audit (2026-07-29; built, CORRECTION-PASSED, uncommitted on 24b4497)

_One consistent record. The first Phase 3 draft went through an independent
review that VERIFIED 14 findings; a full correction pass then fixed every one
IN PLACE (the migration itself was corrected — no follow-up patch migration;
local/disposable proof databases were rebuilt) and extended the suites so the
defects cannot recur. Earlier §12 claims that the review disproved — "strict
nested JSON validation", "depth-bounded segment validation", "fully sealed
import profile/mapping", "full provenance on every row", "true audit keyset
pagination", "safe historical lifecycle retirement", "safe local checkpoint",
and the miscounted file scope (12 created/7 modified/21 paths) — are RETRACTED
and replaced by this section._

### Verified findings → corrections (all fixed in the same uncommitted draft)

1. **Normal UI import flow could not apply its preview.** Preview stored the
   Contact provenance source (`csv_upload`) as `data_imports.source_system` and
   no profile id, so apply re-resolved `csv_upload/contacts` and found nothing.
   → Preview now resolves the ACTUAL profile row, persists the resolved
   `profile_id` even when the client supplied none, keeps provenance source
   separate from profile resolution, and SEALS csv checksum + profile
   id/version + immutable definition snapshot + sha256 + resolved mapping +
   reviewed mapping overrides + contact options + provenance source. Apply
   uses ONLY the sealed contract and demands a new preview when it cannot be
   honoured. The UI shows the resolved profile and provides a genuine mapping
   review whose adjustments are validated and re-sealed via re-preview.
2. **Completion/retry/counts were wrong** (partial failure → `completed`,
   retry → `already`, retries overwrote real counts). → New
   `marketing_import_row_results` table records a DURABLE outcome for EVERY
   source row (terminal `created/updated/conflict/invalid` vs retryable
   `failed`; invalid/conflict are reviewed terminal outcomes) and
   `marketing_import_finalize` computes cumulative totals + completion from
   those durable rows under the locked import row: `completed` means NO
   retryable failures; retry processes ONLY unapplied/failed rows; applied
   rows stay idempotent with their original result; concurrent finalisations
   agree; apply validates the legal status; checksum/sealed mismatches stay
   rejected. Bounded invalid/conflict/failed downloads (row number + outcome +
   reason + FIELD NAMES only) via the permission-gated `row_results` action.
3. **Import identity was first-match-wins** (email→A + phone→B silently chose
   A and attached B's phone). → `marketing_import_resolve_contact` resolves
   EVERY strong identifier independently (source+external id, primary AND
   secondary email/phone), records correctly-labelled bounded per-identifier
   evidence, ignores explicitly-invalid contact points AND invalid evidence
   behind matching scalars, matches ONLY when all usable evidence converges on
   exactly one Person, and turns any ambiguity/disagreement into ONE bounded
   tenant-joined conflict with ZERO canonical mutations. Name-only never
   merges. `marketing_import_contact_row` is structurally validated (tenant
   import lineage, contacts entity, legal status, row range, sealed-options
   equality, real same-tenant actor with effective contacts.import, strict
   record allowlist/scalar types, tenant-valid option refs). Invalid
   row-supplied lifecycle/type values are honest `invalid` outcomes in BOTH
   preview and apply — never silently defaulted. Companies resolve safely
   (created only when they will be linked; exact-name single match links;
   multiple matches are recorded ambiguity; a differing company on a linked
   Person is conflict evidence). Conflicting-scalar endpoints are never
   attached after a field conflict; invalid endpoints are never promoted to
   primary; one-primary and idempotency invariants preserved.
4. **Viewer write grants violated the role ceiling.** → VIEWER READ CEILING:
   the resolver lets ONLY `marketing.view`/`marketing.reporting.view` flow to
   a viewer from grants (hostile raw write-grant rows are inert), the grant
   RPC rejects viewer write grants, and the tag/segment/import mutation RPCs
   re-check authority via the canonical resolver at the authoritative
   boundary. Owner/admin-only restricted permissions and ops defaults
   unchanged.
5. **Lockout protection raced.** → `marketing_access_set` takes a per-tenant
   advisory lock BEFORE reading grant state; two managers concurrently
   denying themselves can no longer both succeed (proven with a real parallel
   test: one succeeds, one MK423/MK409, ≥1 manager remains). Exact no-op
   access changes return idempotently without duplicate audits/events.
6. **Disabling Marketing removed the re-enable UI.** → `marketing-access`
   returns the caller's OWN role on denied verdicts; the `/marketing` route
   derives a governed recovery state (pure `deriveMarketingGate`, unit-tested):
   owner/admin + `reason='not_enabled'` → "Marketing disabled" + "Open
   settings to re-enable" (Marketing settings renders while disabled);
   ops/viewer get no administration path; missing permission stays "Requires
   permission"; an unreachable server stays an error.
7. **Default lifecycle stage could drift** between `marketing_settings` and
   `is_default`. → ONE ATOMIC INVARIANT: both governed paths (settings update
   and `set_default`, which now carries `expected_updated_at` concurrency
   evidence) move BOTH representations in one transaction with settings
   history + version bump; a partial unique index makes dual defaults
   structurally impossible; retirement checks BOTH representations; the UI
   keeps ONE control (the settings select is read-only display). Upgrade and
   clean-chain proofs assert no drift.
8. **Retirement rewrote history.** → `retire_preview` counts CURRENT ACTIVE
   relationships (labelled honestly) and reports historical rows separately;
   retirement locks and remaps ACTIVE rows only, each with a version
   transition + canonical per-relationship lifecycle event + Customer Card
   refresh; the remap UPDATE re-checks stage+status under the lock so
   concurrent reclassifications are never overwritten; inactive/archived rows
   keep the retired key forever; the retired stage row remains for their
   labels; bounded durable mapping evidence (relationship ids) in the audit.
9. **Validation was not fully strict.** → Malformed JSON → 400 in EVERY
   marketing function (never a silent default read); per-action top-level and
   nested key allowlists; explicit nulls rejected; exact JSON scalar types
   checked before casts; `quiet_hours` allows only `{start,end}` whole hours;
   lifecycle ops have per-op argument allowlists; set_default/reorder carry
   concurrency evidence; whole-operation no-ops rejected before history/audit/
   events (settings, lifecycle, tags, segments, access).
   `marketing_settings_history` is structurally bound: composite
   `(tenant_id, settings_id)` FK + unique superseded version; UPDATE raises
   and delete privileges are explicitly REVOKED from client roles in every
   environment (tenant cascade cleanup still works — a tenant is never
   undeletable). Guardrail/footer/quiet-hour form state re-syncs after any
   reload/version conflict.
10. **Segment validation was vulnerable to unbounded recursion.** → One
    validator for stored AND ad-hoc definitions enforces depth BEFORE
    descending and the 32-node budget DURING traversal; unknown keys at every
    node level, mixed `op`+`field` shapes, non-strict scalars (string "true"),
    reversed ranges and duplicate tag ids rejected; relationship
    type/source/status vocabularies validated; explicit unsupported-filter
    (Preview) errors retained.
11. **Segment concurrency/versioning was incomplete.** → Archive/reactivate
    use the observable `updated_at` token with no-op rejection; exact-repeat
    updates rejected (no misleading versions/audits); evaluation captures the
    definition version, stores ONLY against that captured version (a
    concurrent change leaves the stored count untouched), accepts
    `expected_version` (stale → MK409/VERSION_CONFLICT), returns the ACTUAL
    stored timestamp, and uses a strict typed cursor with `next_cursor`;
    actor + permission validated at the authoritative RPC boundary.
12. **The segment builder destroyed nested definitions.** → A structured
    NESTED AND/OR/NOT builder over the validated grammar whose state IS the
    definition tree (deep-cloned, saved verbatim — lossless round-trip proven
    by pure-state unit tests); definitions outside the grammar render
    READ-ONLY (name/description editable, definition never sent back) instead
    of being flattened. Complete structured controls: relationship
    lifecycle/type/status/source/owner, company, created range, last-contact/
    never, tag any/all/none with MULTIPLE tags, eligibility, search. Campaign
    engagement / ad attribution stay visibly disabled Preview.
13. **Audit pagination was not a true keyset.** → Typed `(created_at, id)`
    tuple cursor with the exact tuple predicate + `next_cursor`; equal
    boundary timestamps proven lossless/duplicate-free; audit detail is a
    bounded allowlisted projection (no raw imported rows, destinations or
    unnecessary PII); rejected sensitive administration attempts (access_set,
    sensitive lifecycle ops, settings conflicts) are audited from the Edge
    AFTER the failed transaction so the rejection audit cannot roll back.
14. **Bulk tagging counts/evidence were ambiguous.** → Duplicates collapse
    into `unique` (never counted "rejected"); counts are
    requested/unique/applicable/already/rejected; preflight issues a
    server-computed CONTRACT hash over (tenant, tag, op, sorted unique ids)
    that apply must present (mismatch → conflict); apply locks the tag row so
    inactive-tag races fail safely; assignments carry actor, source and a
    stable `bulk:<uuid>` trigger reference; viewer mutation impossible.

### What is implemented (post-correction)

_Pre-implementation audit findings (all verified against code before building):
the shared importer's person path created NO contact points/relationships,
matched on RAW (unnormalised) scalar equality, had NO per-row idempotency
(name-only rows would duplicate on a partial retry), fetched explicit
profile ids WITHOUT a tenant check, and had no marketing permission gate —
seeding an `entity_type='contacts'` profile alone would NOT have produced
canonical contacts. The resolver had no structural owner/admin-only rule for
restricted permissions, settings had a version integer but NO history, and
lifecycle/tag/segment administration did not exist._

**Migration `20260831120000_marketing_admin_phase3.sql`** (run-once; next safe
id after the concurrent untracked `20260830120000`, which is never touched; no
destructive drops, no draft self-upgrade logic — the corrected draft REPLACED
the original file and proof databases were rebuilt): three new tables
(`marketing_settings_history` — append-only, structurally bound;
`marketing_segment_versions` — immutable definition history;
`marketing_import_row_results` — durable per-row import outcomes), the
resolver replacement (restricted owner/admin-only + viewer read ceiling), and
the governed RPC suite (`marketing_update_settings`,
`marketing_lifecycle_admin`, `marketing_access_overview/set`,
`marketing_audit_list`, `marketing_tags_admin_list`, `marketing_tag_admin`,
`marketing_tag_bulk`, `marketing_segment_validate/match_person/mutate/
evaluate`, `marketing_import_resolve_stage/validate_contact_row/
resolve_contact/match_contact/contact_row/finalize`) — every RPC service-role
only. The EXACT corrected contracts are documented in the migration header and
in the findings list above; the header comment is kept in lockstep with the
code.

**Edge Functions:** `marketing-admin` (owner/admin gate; malformed-JSON 400;
per-action key allowlists; typed audit cursor; Edge-side rejection audits for
denied sensitive administration) and `marketing-segments` (canonical resolver;
per-action/args allowlists; archive tokens; expected_version passthrough) —
both registered in `supabase/config.toml` WITHOUT touching the concurrent
`[functions.phone-operations]` hunk. `marketing-contacts` extended
(tags_admin_list / tag_admin / contract-bound tag_bulk_preflight/apply +
strict parse). `marketing-access` returns the caller's own role on denied
verdicts (the disabled-recovery signal). `data-import` corrected end-to-end
for contacts: resolved-profile sealing, mapping-override review, durable
row-outcome recording, finalize-driven retryable state machine, bounded
row_results downloads, strict per-action allowlists — while the non-contacts
importer paths are byte-preserved (regressions rerun).

**UI:** three primary sections unchanged. Contacts carries four tabs —
Contacts (+ bounded multi-select bulk tagging: server preflight contract →
explicit confirmation → bound apply) / Segments (structured NESTED AND/OR/NOT
builder over the validated grammar with lossless round-trip and a read-only
fallback for unsupported shapes; complete filter controls; honest Preview
options; evaluate + bounded member preview) / Tags (governance with assignment
counts) / Imports (CSV wizard: file checks, RESOLVED-PROFILE display, genuine
column-mapping review with validated sealed overrides + re-preview, preview
counts + masked samples, duplicate-file warning, reviewed apply against the
sealed contract, failed-row retry, bounded review-row downloads, history).
Marketing settings opens from a clearly-labelled sidebar control (owner/admin
only, NOT a fourth section): Access & permissions matrix, Contact inclusion &
lifecycle (ONE default-stage control — the stage list's "make default"),
Delivery guardrails & unsubscribe identity (form state re-synced after
reload/conflict; plain-text rendering), Notifications (real destinations
only), governance pointer, Audit history (true keyset "Load older") and
append-only settings snapshots. `/marketing` derives its gate from the pure
`deriveMarketingGate`: disabled + owner/admin → governed "Open settings to
re-enable"; disabled + ops/viewer → no admin path; missing permission →
"Requires permission"; unreachable server → error. Senders/Workspace and Ads
stay Preview / Not connected. Loading/empty/error/denied/conflict states
throughout; nothing fabricated.

### §12b · Correction pass 2 (2026-07-29) — 10 further verified gaps → corrections

1. **Sealed defaults were still live fallbacks.** When the UI left stage/
   relationship on "Default", the seal carried only `source` and the row RPC
   read live `marketing_settings` at apply. → Preview now resolves the
   EFFECTIVE defaults and seals them explicitly; the preview response and UI
   show the exact resolved values; the row RPC requires the sealed defaults
   and NEVER reads live settings; an unhonourable sealed stage/tag (retired/
   deactivated) returns 409 `invalid_preview` at the Edge BEFORE any status
   change, row processing or failed-outcome write (proven: the rejected apply
   leaves zero row outcomes); import tags are validated ACTIVE at preview,
   apply preflight and in the row RPC.
2. **Profile resolution was under-specified.** → Pure `chooseImportProfile`
   (unit-proven): explicit ids must be active and match the requested source/
   entity (foreign/wrong-entity/wrong-source/inactive adversarially rejected);
   auto-resolution only when unambiguous with one tenant profile preferred
   over the platform fallback; several eligible profiles → 409
   `profile_selection_required` with the bounded eligible list; the Imports
   UI offers the eligible profiles and sends an explicit choice with its own
   source system. A jobs/customers/staff or inactive profile can never be
   sealed into a Contacts import.
3. **The durable ledger had racy writers.** Edge upserts for invalid/failed
   could overwrite terminal outcomes. → New service-role-only
   `marketing_import_row_outcome` (invalid|failed only) takes the same
   per-(import,row) advisory lock, never downgrades or replaces a terminal
   outcome, increments attempts, permits failed→terminal, and returns the
   authoritative existing outcome (`already`) when another worker completed
   the row; the Edge uses ONLY this recorder. Provenance with a missing (or
   failed-stuck) ledger row is repaired deterministically by the next apply —
   `already_applied` can never strand an import. A trigger makes terminal
   rows immutable (only `failed` may transition; FK set-null cascades exempt).
   *(Refined in §12c: as written in pass 2 the trigger returned NEW
   unconditionally for any `failed` row — an update shaped like a retry could
   also rewrite id/tenant/import/row/created_at, and the set-null exemption
   did not compare those fields either. Pass 3 pins identity/lineage on EVERY
   update and counts retries; the pass-2 wording overstated what was
   enforced.)*
4. **Finalisation returned a bare shape when completed.** → EVERY successful
   invocation — first, concurrent, already-completed, and apply-on-completed —
   returns the same complete contract (status + created/updated/conflicts/
   invalid/failed/unprocessed + the full import row + `already`); proven with
   a FULLY PROCESSED import finalised concurrently (both callers receive
   identical full totals).
5. **No identity lock for external ids + weak-name rule drift.** → The row
   RPC now locks `ext|<source>|<external_id>` in the same deterministic sorted
   lock set (two concurrent rows sharing only an external id create at most
   ONE Person — proven over PostgREST; other source namespaces stay
   independent). A NAME-ONLY row whose normalised name collides with existing
   People routes to bounded identity review (one conflict, zero automatic
   merge) in BOTH preview and apply; only genuinely-new evidence creates.
6. **Row-results references were not structurally tenant-bound.** → Composite
   FKs bind `(tenant_id, import_id)` → the same tenant's `data_imports`,
   `(tenant_id, conflict_id)` → the same tenant's conflicts and
   `(tenant_id, entity_id)` → the same tenant's People (cross-tenant
   combinations impossible even under service-role mistakes — proven);
   delete/truncate revoked from anon/authenticated/service_role; tenant
   cascade cleanup still works. *(Retracted from this item: "updates only
   through the governed failed→terminal transition." A trigger cannot know
   its caller, so it can never restrict updates to the governed RPCs — and
   the pass-2 trigger did not even constrain a failed row's update shape.
   §12c states the honest structural guarantee now enforced.)*
7. **Phase-2 tag mutations bypassed the canonical boundary.** →
   `marketing_tag_mutate` (create/assign/remove) is REDEFINED in the Phase 3
   migration: real same-tenant actor + effective `marketing.tags.manage` from
   the resolver + exact per-operation argument shapes + strict JSON types +
   unknown keys rejected; `marketing_tag_admin` enforces exact per-operation
   allowlists (rename/tone/description/deactivate/reactivate) at SQL AND Edge.
   Proven: a viewer with hostile raw write grants is denied at tag create,
   assign, remove, administration, bulk apply and segment mutation.
8. **Hostile nested keys were silently normalized.** → The audit cursor is
   EXACTLY `{t,id}`, the segment cursor EXACTLY `{v,id}`, tag-admin args match
   their exact op shape at the Edge; extra keys are 400s (HTTP assertions
   staged), never quietly dropped.
9. **Saved-segment evaluation was unreachable from the UI + builder shape
   gaps.** → Segment cards gained "Evaluate now" (pinned `expected_version`;
   stores + reloads the count/timestamp; stale → VERSION_CONFLICT notice);
   draft builder changes keep using ad-hoc evaluation which never stores.
   `canEditNode` now validates the EXACT editable shape of every leaf/group
   (required properties, primitive types, enums, arrays, nested relationship
   keys, unknown keys, tag arrays, date/never combinations) — malformed
   known-field definitions render read-only and can never crash the editors
   (23 pure shape tests). The company filter is a bounded server-backed
   typeahead (`companies_list` search) that preserves saved references beyond
   the first page.
10. **Sample masking leaked identifiers.** → Explicit deny-by-default policy
    in `_shared/imports/redact.ts`: primary/secondary emails, phones, owner
    email, names, company, address/postcode, external/source refs all masked
    (unknown fields fully masked; vocabulary fields readable); pure proof that
    known PII never appears verbatim (13-test module incl. local-part checks)
    plus a staged HTTP assertion on the real preview response.

### §12c · Correction pass 3 (2026-07-29) — FINAL narrow pass, 3 verified findings

All three fixed in place in the SAME uncommitted migration
(`20260831120000_marketing_admin_phase3.sql`); no patch migration; no Edge or
frontend changes were needed; scope membership unchanged.

1. **The row-results transition guard was too permissive.** The pass-2
   `marketing_import_row_results_guard()` returned NEW unconditionally when
   `OLD.outcome = 'failed'`, so an update shaped as a failed-row retry could
   also move the row (`id`, `tenant_id`, `import_id`, `row_number`) or rewrite
   `created_at`; the terminal set-null exception compared business fields but
   not those identity/lineage fields either. → Rewritten. The guard now
   enforces, on EVERY update: (a) `id`/`tenant_id`/`import_id`/`row_number`/
   `created_at` are immutable; (b) a `failed` row may transition only to an
   allowed ledger outcome (table CHECK bounds the vocabulary) with `attempt`
   advancing by EXACTLY one, leaving outcome/reason/fields/entity_id/
   conflict_id (+ trigger-maintained `updated_at`) as the only mutable
   columns; (c) terminal rows are immutable; (d) the only terminal-or-failed
   exception is a genuine FK-driven set-null of exactly one existing
   entity/conflict reference with every other business and lineage column
   unchanged; (e) tenant/import cascade cleanup (DELETE) is untouched by this
   before-UPDATE trigger. **Honest guarantee, stated precisely:** a trigger
   cannot cryptographically distinguish a governed RPC from a direct
   service-role UPDATE — what is guaranteed is that NO update of any origin
   can violate that shape. Writer audit under the stricter guard: the
   invalid/conflict/terminal upserts and the recorder already carried
   `attempt = prior + 1`; the PROVENANCE-REPAIR upsert calculated the next
   attempt but omitted `attempt` from its conflict-update clause — fixed
   (`attempt = excluded.attempt`), so repairing over a failed-stuck row is
   itself a counted retry. Adversarial SQL proofs added (suite §7g): moving a
   failed row to another import, or to another tenant even paired with that
   tenant's REAL import (a shape the composite FKs alone would accept),
   renumbering, id rewrite, created_at rewrite, uncounted retry, +2 retry,
   terminal reason tweak, set-null+move, set-null+reason, set-null+attempt —
   ALL rejected by the guard (raise_exception asserted, not FK errors);
   failed→failed and failed→invalid via the recorder count attempts;
   failed→created/updated/conflict via the row RPC retry with attempt+1;
   genuine Person-delete entity set-null and conflict-delete set-null
   preserve outcome/attempt/lineage; import-delete and tenant-delete cascades
   still remove ledger rows.
2. **"Matched person vanished" left a source row with no durable outcome.**
   The matched branch returned `{'action':'invalid','reason':'matched person
   vanished'}` WITHOUT writing a `marketing_import_row_results` row — the
   Edge counted it invalid, finalisation saw an unprocessed row, and the
   "durable outcome for every row" invariant was broken. → The race (Person
   deleted between evidence resolution and its `FOR UPDATE` lock) now RAISES
   SQLSTATE `40001`: the row's transaction rolls back atomically, the
   existing Edge error path records the durable `failed` outcome through
   `marketing_import_row_outcome`, and a later retry re-resolves identity
   from live data and completes normally. The RPC can no longer return
   `action:'invalid'` without its terminal ledger row (the only remaining
   invalid returns are immediately preceded by the ledger upsert). Proofs:
   the recorder→retry progression (failed attempt 1 → row-RPC retry →
   terminal attempt 2) is proven deterministically in §7g — exactly the
   vanished-person recovery path — plus a source/contract assertion that
   `marketing_import_contact_row` contains the `40001` raise and no longer
   contains the unrecorded-invalid return shape. (The in-flight race window
   itself is not deterministically reproducible from single-session SQL;
   this is the strongest practical proof for the SQL/HTTP architecture.)
3. **Single-contact assignment could resurrect an inactive tag.**
   `marketing_tag_bulk` and imports rejected inactive-tag assignment, but the
   redefined `marketing_tag_mutate(..., 'assign', ...)` checked only tenant
   existence. → `assign` now LOCKS the tag row (`FOR UPDATE`, the same
   discipline as bulk apply, so a concurrent deactivate serialises) and
   rejects an inactive tag with the existing validation convention (22023,
   same message as bulk); `remove` intentionally stays legal on an inactive
   tag so historical assignments can be cleaned up; deactivation continues to
   preserve existing assignments; reactivation restores assignability.
   Permission boundary and operation shapes unchanged. Proofs: SQL suite §4
   (assign→22023 with zero writes, history preserved, remove-while-inactive,
   reactivate→assignable) and the SAME four behaviours over the service-role
   PostgREST path in `marketing-admin.test.mjs` (55/55).

### Verification matrix (explicit statuses, post-correction — 2026-07-29)

| Boundary / check | Status |
|---|---|
| `supabase/tests/marketing_admin.test.sql` — 14 sections covering EVERY corrected finding across ALL THREE passes (new in pass 3: §7g structural transition guard — a failed row cannot be moved to another import, nor to another tenant even paired with that tenant's REAL import, nor renumbered/re-identified/re-dated; uncounted (+0) and over-counted (+2) retries rejected; recorder failed→failed/invalid and row-RPC failed→created/updated/conflict all counted attempt+1; terminal reason tweaks and set-null-with-smuggled-change rejected; genuine Person/conflict-delete FK set-nulls preserve outcome+attempt+lineage; import- and tenant-delete cascades intact; vanished-person contract — the row RPC source contains the retryable 40001 raise and no longer contains the unrecorded-invalid return shape; §4 pass-3 additions — single-contact assign of an INACTIVE tag → 22023 with zero writes, remove stays legal while inactive, reactivation restores assignability; new in pass 2: §7d sealed-defaults truth — settings changed after preview change nothing, retired sealed stage / deactivated sealed tag → 22023 requiring a new preview with NO failed row outcome, missing sealed defaults rejected; §7e governed ledger — late failed-markers return the authoritative terminal outcome, recorder rejects terminal outcomes, failed→terminal retries with attempts, provenance-with-missing-ledger repair + truthful re-finalisation, name-only collision → bounded conflict with zero merge in preview AND apply, completed finalisation full-shape idempotency; §7f structural tenant binding — cross-tenant import/conflict/person references violate composite FKs, delete/truncate revoked; §3/§4 additions — hostile-grant viewer denied at tag create/assign/remove/admin, tag_mutate/tag_admin exact per-op shapes): settings strictness (explicit nulls, string-"true" booleans, quiet_hours key allowlist + fractional rejection, no-op rejection, IANA timezone, markup footer, unknown stage/keys, non-admin actor) + bound history (composite-FK cross-tenant rejection, duplicate-version rejection, update raise + no client delete privilege) + MK409; lifecycle (per-op arg allowlists, immutable keys, untouched template, ATOMIC dual-representation default via BOTH paths + no-drift assertions, set_default/reorder concurrency evidence + no-op rejection, retire_preview active-vs-historical honesty, ACTIVE-ONLY retirement with version transitions + per-relationship lifecycle events + durable remap evidence + preserved historical rows); access (restricted + hostile-raw-grant inertness, VIEWER CEILING at resolver/grant-RPC/mutation-RPCs, idempotent no-ops without duplicate audits, MK423 lockout, denied-manager rejection, cross-tenant rejection); tags (governance no-ops, duplicate-safe unambiguous bulk counts, preflight→apply CONTRACT enforcement incl. mismatch, bulk_ref + actor/source on assignments, inactive-tag safety, 1-200 bounds); segment AST (depth-5 rejection BEFORE descent, 111-node tree rejected DURING traversal, ad-hoc path same limits, unknown keys at every level, mixed shapes, strict scalars, reversed ranges, duplicate tags, vocabularies, explicit Preview errors); segment lifecycle (immutable versions, update no-ops, archive/reactivate updated_at tokens + no-ops, VERSION-CAPTURED evaluation + stale expected_version leaving stored count untouched, strict cursors + next_cursor paging); imports (structural row-RPC validation: foreign import P0002, unsealed options, out-of-range rows, unknown keys/types; sealed-contract + foreign-sealed-tag rejection; EVIDENCE CONVERGENCE: email→A+phone→B conflict with correctly-labelled evidence and zero mutation, external→A+email→B conflict, ambiguous+unique conflict, invalid-endpoint evidence → safe new Person, secondary-identifier match, honest invalid lifecycle/type rows in preview AND apply, safe company resolution incl. ambiguity + no orphans, verified-field protection, per-row idempotency, durable outcomes for every row); state machine (failed→retryable, retry of ONLY the failed row with attempt tracking, cumulative totals preserved across retries, completed idempotency, no-seal rejection); audit (equal-timestamp full-walk pagination with zero skips/dups, typed-cursor validation, PII-safe detail projection probe); service-role-only boundaries incl. the new RPCs | **PASS** (local dev DB + fresh clean-chain DB + upgraded DB) |
| `scripts/marketing-admin.test.mjs` — real GoTrue JWTs over PostgREST: 11 RPC denials; settings + history + MK409; **CONCURRENT last-manager self-denial race (exactly one succeeds, one MK423/MK409, ≥1 manager remains)**; viewer ceiling with hostile raw grants (resolver inert + table write denied + RPC execute denied + grant-RPC refusal + tag CREATE/ASSIGN denied through the service-role path); segment version-capture race (stale expected_version → MK409, stored count untouched); contract-bound duplicate-safe bulk tagging; **PARALLEL same-row import applies → exactly ONE Person**; **CONCURRENT apply + failed-marker → the row ends TERMINAL, never downgraded**; **CONCURRENT different rows sharing one source+external id → exactly ONE canonical Person (other namespaces independent)**; **CONCURRENT finalisations → one consistent durable total, and a COMPLETED import finalised concurrently returns identical FULL totals to both callers**; pass-3 single-contact tag lifecycle over the service-role path (deactivate → assign 22023, history survives, remove-while-inactive, reactivate → assignable) | **PASS** (55/55) |
| Phase 1+2 regressions: `marketing_foundation` + `marketing_hardening` + `marketing_contacts` SQL suites · contacts mjs 42/42 · access mjs 25/25 · unit `node --test` 52/52 (openfolk 23 + segment-builder round-trip/shape 10 + marketing gate 6 + NEW pure import proofs 13: deterministic profile choice incl. foreign/wrong-entity/wrong-source/inactive/ambiguous rejection + masking policy with verbatim-PII denial) · product-alignment · lint on changed files (clean; `capability-registry.ts` deliberately keeps its documented pre-existing non-prettier formatting — this pass REVERTED the accidental 500-line auto-format rewrite) · `tsc --noEmit` clean repo-wide · production build (npm, Vercel parity) · `git diff --check` | **PASS** (pass-3 re-runs: 3 regression SQL suites, contacts + access mjs ALL PASS, import-pure 13/13, segment-builder + gate 16/16, `tsc --noEmit` clean, npm production build, `git diff --check` clean; openfolk/product-alignment/lint were pass-2 results not re-run in the narrow pass 3) |
| Clean full chain — 83 migrations (82 tracked + corrected Phase 3; the concurrent untracked `20260830120000` phone-ops migration is EXCLUDED from this claim) applied to a fresh disposable container, then all 4 marketing SQL suites + `control_plane` + `automation_engine` regressions | **PASS** (re-proven on the pass-3 migration file) |
| Upgrade path from committed HEAD `24b4497` — tracked chain + seeded person/contact-point/relationship → corrected Phase 3 applies run-once; seeded data preserved; table delta exactly +3 (`marketing_settings_history`, `marketing_segment_versions`, `marketing_import_row_results`); default-stage invariant holds with NO drift; all 4 marketing suites pass on the upgraded DB | **PASS** (re-proven after pass 3) |
| Authenticated Edge HTTP — `marketing-admin-http` now also encodes: malformed-JSON 400s, unknown-key 400s, settings no-op 400, audit next_cursor paging, DISABLED→role-aware not_enabled + owner re-enable path, segment version-race 409 + archive token 400, bulk preflight CONTRACT flow, and the **EXACT DEFAULT UI-SHAPED import** (no profile_id, source_system='generic', contact_options.source='csv_upload' → resolved+persisted profile id, sealed contract, successful canonical apply, mapping-override re-preview, row_results download); plus the pre-existing `data-import.test.mjs` | **NOT RUN** — no local edge runtime exists and none may be installed; `marketing-admin-http` exits 3 (re-verified after pass 3: endpoint 503, NOT-RUN, exit 3); `data-import.test.mjs` fails against the absent runtime exactly as before this phase. Blocker: deploy or `supabase functions serve` |
| Populated responsive visual QA | **Preview** — the access gate fail-closes before data loads without a served runtime; fail-closed states verified; to complete on staging |
| Capability registry | `marketing.settings` / `marketing.segments` / `marketing.tags` added, `marketing.contacts` / `marketing.imports` updated (correction-pass wording) — ALL **Preview** until the authenticated HTTP + populated visual proofs pass. Nothing delivery-related is marked Live |

### Corrected checkpoint scope (recomputed from Git after the correction pass)

Pass 3 changed no scope membership: its edits live entirely inside four
already-in-scope paths (`20260831120000_marketing_admin_phase3.sql`,
`tests/marketing_admin.test.sql`, `scripts/marketing-admin.test.mjs`, this
ledger).

Exactly **31 paths** (11 modified + 20 created; correction pass 2 added modified `supabase/functions/_shared/imports/profile.ts` — additive pure `chooseImportProfile` — and created `supabase/functions/_shared/imports/redact.ts` + `scripts/import-pure.test.mjs`; the earlier "12 created / 7 modified / 21→22 paths" report was miscounted and is retracted):
modified — `IMPLEMENTATION_LEDGER.md`, `MarketingContacts.tsx`,
`capability-registry.ts`, `lib/marketing/access.ts` (+role on denied verdicts),
`lib/marketing/contacts.ts`, `routes/marketing.tsx`, `supabase/config.toml`
(**partial-stage: marketing hunks ONLY — the `[functions.phone-operations]`
hunk belongs to concurrent phone-ops work**),
`functions/_shared/imports/profile.ts` (additive pure `chooseImportProfile`),
`functions/data-import/index.ts`,
`functions/marketing-access/index.ts` (disabled-recovery role),
`functions/marketing-contacts/index.ts`;
created — `scripts/import-pure.test.mjs`, `scripts/marketing-admin.test.mjs`,
`scripts/marketing-admin-http.test.mjs`, `MarketingImports.tsx`,
`MarketingSegments.tsx`, `MarketingSettings.tsx`, `MarketingTags.tsx`,
`lib/marketing/{admin,call,gate,imports,segment-builder,segments}.ts`,
`lib/marketing/{gate,segment-builder}.test.ts`,
`functions/_shared/imports/redact.ts`,
`functions/marketing-admin/index.ts`, `functions/marketing-segments/index.ts`,
`migrations/20260831120000_marketing_admin_phase3.sql`,
`tests/marketing_admin.test.sql`.
(The enumeration previously omitted three acknowledged paths — `profile.ts`,
`import-pure.test.mjs`, `redact.ts` — while correctly counting 31; corrected
here, documentation-only, at checkpoint time.)
The concurrent untracked phone-ops/telephony/product-review/run-checkpoint
work is preserved byte-for-byte and stays OUTSIDE this scope.

**Honest limitations / external configuration still required:** no senders,
delivery, Gmail scopes, campaign transmission or Ads connectors (Phases 4-8);
notification routing stores intent only (no delivery mechanism exists to act on
it yet); import owner mapping remains a safe best-effort exact-email match to a
same-tenant operational profile (unmatched → no owner, documented); history-row
retries require re-selecting the previewed file (checksum-verified) — the raw
CSV is never stored server-side; segment-builder tag pickers list the first
page of tenant tags; HTTP + populated visual gates blocked on a served edge
runtime; local mjs/SQL proofs normalise phone identity at the DB layer
(edge-side UK E.164 normalisation is exercised only by the staged HTTP flow).

## 13 · Phase 4 — Workspace senders & governed test-send delivery (2026-07-29; built + correction passes §13b/§13c/§13d; COMMITTED as the local Phase 4 checkpoint on top of 6e64b0b — not pushed, not deployed, not launch-proven)

One additive run-once migration `20260901120000_marketing_sender_delivery.sql`
(+ composite tenant uks on `email_accounts` / `google_workspace_mailboxes` /
`automation_intents` / `profiles` / `automation_execution_attempts` (incl. a
(tenant, intent, id) key that binds an attempt reference to ITS OWN intent) —
additive indexes only, no engine behaviour change). The §13b correction pass
was applied IN PLACE to this uncommitted migration (no corrective follow-up
migration for never-committed schema).

### Reused seams (audited before design; nothing duplicated)
`email_accounts` + `email_oauth_tokens` (granted-scope truth), Workspace
connection/mailboxes + `getDelegatedToken` family (new MINIMAL
`getDelegatedGmailSendToken`: gmail.send only, mailbox subject), the frozen
Automation Engine (registries + `automation_claim_and_start` /
`automation_finalize_execution` / `automation_resolve_unknown_execution` /
envelope hash — all UNCHANGED, including the approval guard), the adapter
registry (one import + one entry), `platform_jobs` + `enqueueJob` /
`enqueueAutomationExecution` + a 17th worker handler
`marketing.delivery_sync`, `email_messages`
(tenant/provider/provider_message_id convergence) + the EXISTING
`interactions.sync` projector (the ONLY Interaction writer), the canonical
marketing permission resolver (existing keys `marketing.senders.manage` /
`marketing.campaigns.test`), `marketing_settings.default_sender_profile_id`
(dangling since Phase 1 — now FK-bound), settings history, audit/event
conventions.

### What is implemented (post-correction)
- **HONEST TEST-SEND AUTHORITY.** A Phase-4 test send is an explicitly
  authorised, DELEGATED test action by an actor holding canonical
  `marketing.campaigns.test`: intent type **`send_marketing_test_email`**
  (requires_approval FALSE, external, high-risk), decision
  **AUTOMATION_AUTHORISED** with all review routing flags false and
  `automationIntent.requiresApproval` false, and **NO `automation_approvals`
  row exists or is fabricated** — an Operations requester is not a tenant
  senior, and the earlier draft's fabricated `tenant_senior` approval is
  RETRACTED (§13b-1). The actor, tenant, permission basis, recipient, sender,
  request and irreversible external classification are preserved in the
  immutable package, intent envelope, Action, event and audit history. The
  frozen engine approval guard is untouched: Phase-5 broadcasts must register
  their own bulk intent type and/or approval-requiring package, and the guard
  still demands a matching approval wherever one is required (guard-proven).
  The Operational Mode re-check applies unchanged (reversibility honestly
  IRREVERSIBLE → executes only where the mode permits irreversible work).
- **`marketing_sender_profiles`** — exactly one immutable source mailbox
  (composite tenant FKs incl. `created_by`/`updated_by` → profiles; FK
  set-null on source removal is the only lineage change; never re-pointable/
  re-addressable/movable); header-bound display fields validated at WRITE
  time (control chars/CR-LF rejected, reply-to format checked at create AND
  update); exact updated_at token; no client DELETE.
- **CANONICAL LIVE READINESS** (`marketing_sender_readiness` / `_all`) — ONE
  derivation from CURRENT AUTHORITATIVE SOURCE STATE: OAuth = real gmail
  account row (provider/status/auth_state) + stored token + exact gmail.send
  in the STORED grant; DWD = the actual mailbox + ITS OWN connection (correct
  under multiple Workspace connections) + recorded send-scope mint evidence.
  Used by enablement, capability sync, test-send acceptance, the overview and
  (via RPC) the adapter at execution time. Cached sender columns are display
  evidence only. `tenant_connectors.health_status` is 'healthy' ONLY while a
  READY sender exists; otherwise the capability is disabled and health drops
  to the bounded 'unknown'.
- **Default sender** — composite FK; default must be an ENABLED sender
  (trigger, any caller); the current default cannot be disabled directly
  (trigger); governed disable clears the default first, versioned + audited.
- **Registration** — capability `email.send_marketing` (external, high) +
  operational outcome `marketing_email_submitted` ("submitted ≠ delivered") +
  contract (adapter v1) + the TEST-ONLY intent type. ZERO tenant enablement
  seeded (SQL-proven, fixture-scoped locally + globally on the clean chain).
- **Test send** (`marketing_test_send_request`) — canonical resolver check,
  STRICT single same-tenant profile recipient, bounded content, DB rate limit
  (3/min, 10/hour, MK429), and REQUEST-FINGERPRINT idempotency: a canonical
  sha256 over (request id + actor + sender + recipient + the full frozen
  content hash) is stored on the delivery and compared transactionally —
  byte-equivalent replays converge on the same intent/delivery; a reused id
  with ANY differing frozen input raises stable **MK412** and creates
  NOTHING (proven: no intent/action/decision/delivery delta).
- **Adapter** `connectors/marketing_email.ts` — mutation-free; the provider
  message is built from the **FROZEN ENVELOPE ONLY** (sender edits after the
  request can never change what is sent — engine-claim proven in SQL +
  source-scan proven in node); EXACT envelope allowlist (undeclared fields —
  bcc/html/recipient_emails/anything — rejected before any provider
  interaction); EXECUTION-TIME ACTOR AUTHORITY recheck through the canonical
  resolver (removed/moved/denied actors block permanently; pure
  `evaluateActorAuthority` node-proven for all four cases); canonical
  readiness recheck via the SQL RPC; hardened MIME (quoted-string display
  names — quotes/commas/angle-brackets/backslashes can never break or spoof
  From; RFC 2047 for Unicode; RFC 2045 76-char base64 body wrapping;
  deterministic Message-ID); conservative classification (429 transient;
  uncertain 5xx/lost → UNKNOWN frozen, never auto-resent).
- **Delivery projection** — `marketing_deliveries` (+ request_fingerprint) +
  append-only events; EVERY reference composite-FK tenant-bound
  (actor/recipient/person/intent/attempt — the attempt FK also binds THE SAME
  INTENT; delivery-event attempts and email origin refs likewise). The
  transition guard is FACTUAL for every caller including the service role:
  each move must agree with the CURRENT intent state, and 'submitted'
  additionally requires a same-tenant same-intent SUCCEEDED attempt whose
  external reference equals the recorded provider message id (thread
  agreeing) — fabricated submission is structurally impossible (adversarially
  proven). Provider facts are write-once and settable only by the submitted
  transition. On confirmed submission the reconciler upserts the canonical
  outbound `email_messages` row AND enqueues the STANDARD `interactions.sync`
  job under its existing deterministic key (idempotent against the active-key
  index; the cron shares the same key) — the canonical projector remains the
  single Interaction writer; the suite proves one-Interaction convergence via
  a labelled test-side simulation of the projector's exact upsert contract.
  Failed/unknown deliveries create NO canonical email row and NO projection
  job.
- **`marketing_test_send_status`** — STRICT at the DB boundary: object-only
  args, `limit` the only key, integer 1–50; fractions/strings/extra keys →
  22023 (SQL + PostgREST + staged HTTP proofs).
- **Edge** `marketing-senders` — as before, plus MK412 → REQUEST_MISMATCH
  (409) and per-sender readiness from `marketing_sender_readiness_all` (each
  DWD mailbox against ITS OWN connection — finding 9). **UI** — readiness/
  remediation from the canonical states; per-connection Workspace rows.
- **Conformance** — gate (d) unchanged in intent (non-marketing adapters keep
  the original ban); gate (j) strengthened: test-only intent type, no
  fabricated approval in the migration, one provider call, unknown-freeze, no
  status claim, full registration. CONFORMANCE PASS.

### §13b · Correctness/security pass (2026-07-29) — 14 findings, all corrected in place
1. **Fabricated tenant_senior approval** (an Operations actor recorded as a
   tenant-senior approver) → RETRACTED; delegated-authority model above; no
   approval row; engine approval guard untouched and re-proven for the
   broadcast boundary.
2. **Mutable sender content leaked into "frozen" sends** (adapter substituted
   current from_name/reply_to/signature) → frozen-envelope-only MIME;
   adversarial proofs (SQL claim-envelope + node source-scan + MIME tests).
3. **No execution-time actor authority recheck** → canonical-resolver recheck
   in the adapter; pure decision helper proven for denied/removed/moved/valid.
4. **Envelope accepted undeclared fields** → exact allowlist; bcc/html/
   recipient_emails/sneaky/missing/wrong-type all rejected.
5. **Unbound tenant references** (created_by/updated_by/actor/recipient/
   person/attempt/event-attempt/email-origin) → composite tenant FKs
   everywhere incl. same-intent attempt binding; adversarial FK proofs.
6. **Service role could fabricate delivery states** → factual transition
   guard anchored to intent/attempt state + provider-id agreement +
   write-once-by-submission; adversarial fabrication proofs; legitimate
   reconciler re-proven.
7. **Idempotency keyed on request_id alone** → canonical request fingerprint;
   MK412 stable conflict; zero-side-effect mismatch proof.
8. **Readiness from cached sender columns** → canonical LIVE readiness (see
   above) wired through enable/capability/test/adapter/overview; degradation
   tests (scope stripped/auth revoked/account disabled/token lost).
9. **Single-connection assumption in overview** → per-mailbox connection
   resolution; two-connection test (healthy sender unaffected by the degraded
   connection).
10. **Weak MIME/display-name handling + unwrapped base64** → quoted-string
    escaping/RFC 2047 + 76-char wrapping + write-time sender-field validation.
11. **Lax status RPC** → strict DB-boundary contract.
12. **"Eligible for projection" claimed as projection** → deterministic
    standard-job enqueue on confirmed submission + explicit simulation-labelled
    convergence proof; the Deno worker/projector runtime execution remains a
    deploy-gated proof and is stated as such.
13. **Conformance gate** — kept narrow; strengthened (see above).
14. **Documentation** — this section, SENDER_SETUP, AUTOMATION_ENGINE,
    capability registry and test headers corrected; no tenant-senior claim, no
    frozen-send-with-mutable-content claim, no projected-vs-eligible blur, no
    provider exactly-once claim, no cached-state health claim survives.

### §13c · Final integrity correction (2026-07-29) — 6 findings, corrected in place (still uncommitted)

1. **Fabricated delivery INSERTS + terminal-fact rewrites** — the delivery
   guard was UPDATE-only, so the service role's INSERT privilege could create
   a delivery already `submitted`/`failed`/`executing`/`unknown` with
   arbitrary provider facts, and terminal facts were only checked when status
   changed. Now `BEFORE INSERT OR UPDATE`: a delivery is BORN `queued` with NO
   execution attempt, provider facts, submission time or failure
   classification, must reference a same-tenant PENDING
   `send_marketing_test_email` / `email.send_marketing` intent, and must
   AGREE with that intent's frozen envelope (delivery id, sender, recipient
   profile+email, actor, request id, content hash). On update,
   `execution_attempt_id` and `failure_class` may only change WITH a factual
   status transition (terminal facts therefore pinned forever), provider
   facts may only be set by the transition INTO submitted, `failed` requires
   a failure classification + a same-intent failure attempt, `submitted`
   forbids one. Adversarials: direct insert of each fabricated state, birth
   facts, envelope forgery, non-Phase-4 intent type, succeeded-intent sibling
   insert, post-terminal attempt swap/detach/rewrite — all rejected.
2. **Delivery-event lineage** — events carried only a `(tenant, attempt)` FK,
   so a same-tenant different-intent attempt could be cited and arbitrary
   history appended. Events now carry `automation_intent_id` (composite FK
   `(tenant_id, delivery_id, automation_intent_id)` → deliveries' new
   `(tenant_id, id, automation_intent_id)` unique key) and the attempt FK
   binds `(tenant_id, automation_intent_id, execution_attempt_id)` — an
   attempt from another intent is impossible BY SHAPE (catalog-asserted). A
   guard makes fictional history impossible for every caller: `to_status`
   must equal the delivery's ACTUAL status, a cited attempt must be the
   delivery's own recorded attempt, the single initial event is null→queued
   (also a partial unique index), and every later event must continue the
   chain (`from_status` = previous `to_status`; guard-assigned `seq`, which
   also orders the status read deterministically). Both production insertion
   sites updated; events stay append-only.
3. **Exact, self-refreshing readiness/capability truth** — OAuth readiness
   now requires `auth_state` EXACTLY `'ok'` (`unknown`/unrecognised are
   `auth_invalid`), a SAME-TENANT stored token, and the EXACT
   whitespace-token `gmail.send` scope via new SQL `marketing_scope_has`
   (substring `position()` removed everywhere — `gmail.send.extra` /
   `gmail.sendfoo` can never authorise; matches the TypeScript helper's
   contract). `email_oauth_tokens` gains a MANDATORY, VALIDATED composite
   tenant FK to its account — per §13d the migration FAILS LOUDLY (with the
   row count and an operator-verifiable repair hint) if inconsistent legacy
   rows exist; it can never complete without the constraint; every Phase-4
   token read (SQL, adapter, Edge verify) is tenant-filtered regardless. Capability truth is
   now TRIGGER-REFRESHED from the authoritative source tables (account
   status/auth-state/address; token insert/update/delete; Workspace mailbox
   + connection state; sender source FK set-null) — tenants with no sender
   profile untouched; the overview re-syncs before reading capability/health;
   the request RPC and adapter still re-derive readiness independently. The
   degradation batteries (SQL + PostgREST) mutate ONLY source state — zero
   manual sync calls (scan-proven).
4. **RFC 2047 long-Unicode headers** — the encoder emitted ONE encoded word
   per value, breaching the 75-char encoded-word limit for long Unicode
   subjects/display names. Now: code-point-safe 45-byte chunking (a UTF-8
   sequence is never split; every word decodes alone under a fatal decoder),
   every word ≤75 chars including its wrapper, words folded with CRLF+SPACE
   continuations, no physical line near the 998 hard limit, decoding
   reconstructs the exact original, short ASCII byte-identical. Proven at the
   MAXIMUM bounds (300-char subject, 120-char display name, mixed
   2/3/4-byte characters).
5. **Stale claims** — AUTOMATION_ENGINE.md's migration row said
   `send_marketing_email`; corrected to `send_marketing_test_email` (the SQL
   suite's negative assertion that the OLD name does not exist remains,
   clearly purposed). The migration comment claiming an "ACTIVE" recipient
   profile corrected — `profiles` has no active state, so none is claimed.
   SENDER_SETUP.md now records the trigger-refreshed capability model;
   AUTOMATION_ENGINE.md records the fail-closed adapter reads.
6. **Fail-closed authority reads** — the adapter conflated "the database
   answered NO" with "the database could not answer" on every mandatory
   pre-provider read. Now settings/actor/resolver/sender/readiness/
   capability/recipient/token reads each check `.error` explicitly: a read or
   resolver failure is a SAFE RETRYABLE pre-provider `failed_transient`
   (nothing was sent; consistent with the engine's retry contract — the
   previous readiness-error `unknown` over-freeze is corrected to transient),
   while a genuine missing/moved/denied actor, sender, capability or
   recipient stays PERMANENT. Proven by MOCKED ADAPTER-BOUNDARY tests running
   the real `execute()` against a scripted client: 8 read-failure cases →
   transient with zero provider calls; genuine negatives → permanent; the
   fully healthy script still submits through exactly one provider call.

#### §13c verification matrix (2026-07-29)
| Check | Result |
|---|---|
| `git diff --check` | **PASS** (clean) |
| Pure suite `node --test scripts/marketing-senders-pure.test.mjs` (now 24 tests: +3 RFC 2047 long-value, +1 fail-closed source scan, +3 mocked adapter-boundary) | **PASS** 24/24 |
| SQL suite `supabase/tests/marketing_senders.test.sql` (insert/event adversarials, catalog FK shapes, trigger-driven degradation battery with zero manual sync calls) | **PASS** on the dev DB, the fresh clean chain AND the upgraded 6e64b0b DB |
| PostgREST suite `scripts/marketing-senders.test.mjs` (+5 trigger-driven capability checks over the real boundary) | **PASS** ×2 (36 checks, re-run-safe) |
| HTTP suite `scripts/marketing-senders-http.test.mjs` | **NOT RUN — exit 3** (no local Edge runtime; honestly reported) |
| Engine regressions: `automation_engine` / `execution_reliability` / `email_reliability` / `response_approval_atomicity` | **PASS** on the clean chain AND the dev DB |
| Marketing Phase 0–3 regressions: `marketing_foundation` / `marketing_hardening` / `marketing_admin` / `marketing_contacts` SQL + `marketing-access` / `marketing-contacts` / `marketing-admin` mjs | **PASS** (SQL on both DBs; mjs ALL PASS) |
| `bash scripts/intelligence-conformance.sh` | **PASS** |
| `npx tsc --noEmit` · focused lint (changed files) · production build (npm) | **PASS** |
| Fresh clean chain — 84 migrations (committed track + corrected Phase 4; untracked phone-ops excluded) on a fresh `supabase/postgres` container (stubbed `storage.buckets` + auth columns the services normally provide) | **PASS** |
| Upgrade from committed HEAD `6e64b0b` — 83 committed migrations + seeded marketing/email/workspace/intent/message data → corrected Phase 4 applied ONCE (second apply fails loudly); +3 tables; ZERO enablement; pre-existing email rows keep null origin; token tenant FK added (data consistent); sync triggers installed; full SQL suite passes on the upgraded DB | **PASS** |
| Targeted scans: no fabricated approval · no mutable sender content in MIME · guard is BEFORE INSERT OR UPDATE · event attempt FK binds tenant+intent · no substring scope check remains · auth_state must be exactly 'ok' · zero manual sync calls in the degradation battery · no stale positive `send_marketing_email` reference | **PASS** (8/8) |

Still true after §13c (and, post-§13d, at the local Phase 4 checkpoint
commit): NOT pushed, NOT deployed; NO real email has ever been sent; the Edge
HTTP + worker runtime proofs remain deploy-gated; execution still requires a
mode permitting irreversible external work. (The §13b/§13c/§13d passes all
ran while the work was still uncommitted, as their headings record.)

### §13d · Micro-correction (2026-07-29) — 2 findings, corrected in place (still uncommitted)

1. **The OAuth tenant FK is never silently skipped.** §13c's do-block warned
   and continued when inconsistent legacy `email_oauth_tokens` rows existed —
   leaving the database without the invariant the documentation claims. Now
   the migration FAILS LOUDLY (errcode 23514, exact mismatched-row count, an
   operator-verifiable repair hint: copy the redundant token tenant from the
   canonical account AFTER verification) and can NEVER report success without
   the validated `(tenant_id, email_account_id) → email_accounts (tenant_id,
   id)` constraint; the existing-constraint check is scoped to
   `public.email_oauth_tokens` by `conrelid`, not a global name match; the
   plain ADD CONSTRAINT validates existing rows (never NOT VALID). Suite now
   asserts the FK exists, is table-scoped AND `convalidated`, and that
   mismatched token inserts/updates die on the FK (the insert probe targets a
   token-less account so the per-account unique key cannot mask the FK).
   Upgrade proofs: consistent data → validated FK; DIRTY data (a seeded
   mismatched token) → the migration FAILS with the §13d error and, run
   `--single-transaction`, leaves nothing behind; after the documented repair
   the same migration succeeds and the FK is validated.
2. **Every persisted delivery field binds to the frozen intent.** The §13c
   insert guard compared ids/request/hash but not the persisted CONTENT — a
   service-role caller could copy a legitimate `content_hash` while inserting
   different subject/body/from/reply-to/signature/content-version, plus a
   free-chosen correlation id and any shape-valid fingerprint, splitting the
   Marketing/canonical projection from what the adapter actually sends. The
   guard now requires exact agreement (null semantics included) on purpose,
   subject, body_text, from_name, reply_to, signature_text, content_version
   — alongside the existing delivery id/sender/recipient profile+email/
   actor/request id/content hash — binds `correlation_id` to the INTENT
   ROW's correlation, and RECOMPUTES the request fingerprint through the new
   single canonical `marketing_request_fingerprint()` (now also the request
   RPC's implementation, so the two can never drift); a shape-valid 64-hex
   forgery is rejected. Adversarials: 8 one-field mutations of a copied
   legitimate pending delivery (subject, body, from name, reply-to,
   signature, content version, correlation, fingerprint) all rejected; the
   EXACT copy passes the guard and dies only on uniqueness (the legitimate
   request path is untouched); the stored fingerprint equals the canonical
   recomputation; the reconciled canonical email body is asserted
   byte-consistent with the frozen content.

#### §13d verification matrix (2026-07-29)
| Check | Result |
|---|---|
| `git diff --check` · `npx tsc --noEmit` · focused lint · production build (npm) | **PASS** |
| SQL suite on the dev DB, the fresh clean chain (84 migrations) and the upgraded-from-`6e64b0b` DB | **PASS** (all assertions) |
| Upgrade proof incl. DIRTY-data path: mismatched legacy token → migration FAILS loudly (nothing applied under `--single-transaction`); documented repair → success + validated FK | **PASS** |
| PostgREST suite ×2 (re-run-safe) · pure suite 24/24 | **PASS** |
| Engine + email reliability (+ execution reliability, approval atomicity) regressions; Marketing 0–3 SQL + mjs regressions; intelligence conformance | **PASS** |
| Targeted scans: no warning-only FK path (`raise warning` absent); constraint never NOT VALID; every delivery content field compared in the insert guard; fingerprint recomputed via the single canonical function (definition + 2 call sites); unrelated files untouched | **PASS** |

### Honest limitations
- Gmail has NO provider idempotency key: exactly-once is OUR machinery
  (deterministic intent idempotency + single-success unique index +
  unknown-freeze + human review). The deterministic Message-ID exists for
  MANUAL reconciliation only — "not found" is never treated as safe-to-resend.
- Execution requires an operational mode permitting irreversible external
  work (trusted/optimisation); in discovery/assisted the intent parks
  mode-blocked with its real reason — recorded, surfaced, and correct.
- The adapter refreshes an expiring OAuth token in-memory only (it performs no
  writes); durable refresh persistence stays with the ingestion sync path.
- The Deno worker shell + Edge HTTP run only when deployed/served: local
  proofs drive the REAL SQL engine RPCs with stubbed provider results; the
  adapter transport was never executed against Google and NO email was sent.
  The end-to-end worker-executed Interaction projection is enqueue-proven +
  contract-proven locally; its runtime execution is a deploy-gated proof.
- APPLICATION request idempotency (fingerprint convergence) ≠ PROVIDER
  delivery semantics: "submitted" = Gmail accepted the request; unknown =
  frozen for review; canonical email ingestion and Interaction projection are
  separate, later, canonical stages.
- `marketing_deliveries.purpose` is 'test' only; Phase 5 extends vocabulary.

### Verification matrix (post-correction — 2026-07-29)
| Check | Status |
|---|---|
| `supabase/tests/marketing_senders.test.sql` — 10 sections incl. §13b adversarials: sources (per-mailbox connections), create (write-time header validation, hostile grant, dup idempotency), structure (creator/updater/actor/recipient/person/attempt/origin composite FKs; same-intent attempt binding; re-point/move rejection), registration honesty (test-only intent, requires_approval FALSE, no bulk intent, zero enablement), LIVE readiness (multi-connection truth, enable gate, capability+health degradation on scope/auth/status/token loss), test send (delegated authority — NO approvals row; fingerprint convergence + MK412 with zero writes; MK429; strict status contract), E2E via REAL engine RPCs (frozen envelope survives sender edits; fabrication adversarials — executing-intent, in-flight attempt, mismatched provider id, missing id — all rejected; legitimate reconcile submits; interactions.sync job enqueued once; ingestion convergence; simulated projector one-Interaction proof; failed/unknown → no email row/no job; unknown frozen + appended resolution + review task), cross-tenant lineage, observability, cascade, service-role-only | **PASS** (dev DB + clean-chain + upgraded DB) |
| `scripts/marketing-senders-pure.test.mjs` — 17 node tests: exact envelope allowlist (incl. bcc/html/recipient_emails/sneaky + missing/wrong-type), actor authority (denied/removed/moved/valid), display-name quoting (quotes/commas/angles/backslash/Unicode), 76-char base64 wrapping + long body, deterministic Message-ID + frozen reply-to/signature, injection vectors, sanitized responses, conservative classification (5xx = unknown), FROZEN guard × delegated-test package (trusted allows with NO approval; assisted/discovery withhold; BROADCAST boundary distinct — approval still required incl. wrong-kind + type-gate; capability/connector/contract/supersession/unknown/prior-success/cross-tenant), adapter source-scan (env-only MIME, resolver + readiness rechecks, one fetch, no getStatus) | **PASS** (17/17) |
| `scripts/marketing-senders.test.mjs` — PostgREST + real GoTrue JWTs: 12 RPC denials + table write denied; lifecycle + readiness-gated capability; parallel same-request convergence; NO fabricated approval; MK412 mismatch; strict status at the DB boundary; stubbed claim→finalize→reconcile with ONE canonical email row; disable clears default; history survives; random-id fixtures with honest append-only residue note | **PASS** (31/31, re-run-safe) |
| `bash scripts/intelligence-conformance.sh` (incl. strengthened gate j) | **PASS** |
| Marketing regressions (4 SQL suites) + admin 55/55 + access/contacts mjs + `automation_engine` / `execution_reliability` / `email_reliability` / `response_approval_atomicity` + import-pure 13 + builder/gate 16 | **PASS** (`reliability_vertical.test.sql` NOT RUN — pgTAP absent locally, pre-existing) |
| `npx tsc --noEmit` · focused lint · production build (npm) · `git diff --check` | **PASS** |
| Clean full chain — 84 migrations (83 committed-track + corrected Phase 4; untracked phone-ops EXCLUDED) + suites on a fresh container | **PASS** (corrected migration) |
| Upgrade from committed HEAD `6e64b0b` — seeded marketing/email/workspace/interaction/intent data survives; run-once; +3 tables; ZERO enablement; origin columns null for pre-existing rows | **PASS** (corrected migration) |
| Authenticated Edge HTTP (`marketing-senders-http` + REQUEST_MISMATCH / no-approval / strict-limit additions) | **NOT RUN** — no local edge runtime; exits 3 (verified) |
| Populated visual QA | **Preview** — fail-closed gate without a served runtime; to complete on staging |
| REAL provider send | **NEVER EXECUTED** — stubbed results only; live proof requires deploy + re-consent/DWD scope + permitting mode + an explicit user-authorised recipient/send |

### Phase 4 checkpoint scope (COMMITTED locally as one checkpoint on top of 6e64b0b; 23 paths)
Modified (11): this ledger, `docs/reference/AUTOMATION_ENGINE.md`,
`docs/reference/BACKEND_RUNTIME.md`, `scripts/intelligence-conformance.sh`,
`src/components/app/MarketingSettings.tsx`, `src/lib/capability-registry.ts`,
`supabase/config.toml` (**partial-stage: marketing hunks ONLY**),
`supabase/functions/_shared/connectors/index.ts`,
`supabase/functions/_shared/gmail_oauth.ts`,
`supabase/functions/_shared/google_workspace.ts`,
`supabase/functions/_shared/worker_handlers/index.ts`.
Created (12): `docs/product/marketing-crm/SENDER_SETUP.md`,
`scripts/marketing-senders-http.test.mjs`, `scripts/marketing-senders-pure.test.mjs`,
`scripts/marketing-senders.test.mjs`, `src/components/app/MarketingSenders.tsx`,
`src/lib/marketing/senders.ts`,
`supabase/functions/_shared/connectors/marketing_email.ts`,
`supabase/functions/_shared/marketing_email.ts`,
`supabase/functions/_shared/worker_handlers/marketing_delivery_sync.ts`,
`supabase/functions/marketing-senders/index.ts`,
`supabase/migrations/20260901120000_marketing_sender_delivery.sql`,
`supabase/tests/marketing_senders.test.sql`.
Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
byte-for-byte outside this scope.

## 14 · Phase 5 — Broadcasts end to end (2026-07-29; BUILT + locally proven, UNCOMMITTED on c739a39)

One campaign model, one audience truth, one provider transport. Everything
below is ADDITIVE around the existing seams: `marketing_campaigns` stays the
only campaign identity; segments stay saved queries; eligibility stays
`marketing_endpoint_eligibility`; every send goes through the FROZEN
Automation Engine and the ONE registered Gmail Marketing adapter. No second
workflow engine, queue, person table, activity feed, sender, permission
resolver or provider transport was created.

### Schema (migration `20260902120000_marketing_broadcasts.sql`)
- `marketing_campaigns` gains version (optimistic concurrency),
  current_revision_id, active_snapshot_id, schedule evidence
  (schedule_local/timezone/schedule_at/schedule_fold), launch_public_base_url,
  cancelled facts, composite tenant FKs on every profile/sender/segment ref,
  and a `BEFORE INSERT OR UPDATE` guard enforcing the legal machine
  (draft→review→approved→scheduled/active→paused/completed/cancelled→archived)
  with FACTUAL anchoring for every caller incl. service role: approved needs
  a real approval of the current revision; scheduled/active need a USED launch
  confirmation bound to the active snapshot; completed is impossible while any
  recipient is pending/preparing/queued/executing/UNKNOWN; lifecycle facts
  move only with their transitions; the launched bundle is pinned.
- IMMUTABLE `marketing_campaign_revisions` (subject, preview, ONE safe
  authored body — plain text + {{token}} + [label](https://url) only, no HTML
  in — allowlisted tokens {first_name,last_name,display_name,company_name},
  explicit fallbacks, content hash, sender+segment+segment_version binding).
- APPEND-ONLY `marketing_campaign_approvals` (campaign version + revision +
  hash + sender + segment version + approver + authority basis + decision +
  correlation) and `marketing_campaign_events` (guard-assigned seq; events
  must record the ACTUAL status and continue the recorded chain).
- IMMUTABLE `marketing_audience_snapshots` + `marketing_audience_members`:
  EVERY segment candidate gets a member row — included (frozen endpoint +
  destination + personalisation context) or excluded with exact reason codes
  (unknown_preference, unsubscribed, hard_suppression, no_contact_point,
  invalid_destination, duplicate_shared_destination [fail-closed, both
  sharers], missing_personalisation). Counts equal rows; snapshot hash covers
  the full member set + bindings.
- ONE-USE `marketing_launch_confirmations` (challenge DIGEST only, actor- and
  snapshot-bound, 15-minute expiry, launch idempotency fingerprint;
  refreshing preflight SUPERSEDES prior unused confirmations — stale
  preflight can never launch). No client select policy exists at all.
- LEASE-SAFE `marketing_broadcast_dispatches` (pending→preparing→queued→
  executing→submitted|skipped|failed|unknown|cancelled; FOR UPDATE SKIP
  LOCKED claims with lease recovery; guard: born pending mirroring an
  INCLUDED member, facts move only with transitions, unknown is never
  rewritten into a retry; generation column reserved for future re-dispatch).
- DIGEST-ONLY `marketing_unsubscribe_tokens` (sha-256 digest unique; the
  plaintext exists only inside the frozen envelope URL; expiry/revocation/
  single-use recorded; no client select policy).
- `marketing_deliveries` extended (campaign/revision/snapshot/member/dispatch/
  person/contact point/unsubscribe token/body_html/preview/generation +
  purposes test|broadcast + statuses +skipped/+cancelled). The Phase-4 guard
  and reconciler are REPLACED by supersets — every Phase-4 invariant
  preserved verbatim and re-proven by the untouched Phase-4 suites. Broadcast
  inserts must agree with the frozen envelope INCLUDING the full campaign
  lineage and a PREPARING dispatch; 'skipped' is anchored to an engine-
  recorded policy_* refusal; 'cancelled' to a cancelled intent.
- Canonical projection: `email_messages` + origin_campaign_id/origin_person_id
  (composite FKs); `interactions.related_campaign_id` (composite FK) written
  by the EXISTING projector from origin columns — the projector remains the
  only Interaction writer; later Gmail ingestion converges on the same row.
- `marketing_settings.max_bulk_recipients` guardrail (default 500, 1..10000).
- `serviceos_schedule_defs()` replaced ADDITIVELY: every existing schedule
  preserved + `serviceos-marketing-broadcast` → marketing-broadcast-scheduled-
  sync (MARKETING_BROADCAST_SECRET, every minute). Adding the definition
  installs NOTHING remotely — an operator must run serviceos_schedule_all().

### Automation registration + honest approval model
`send_marketing_broadcast_email` on the EXISTING email.send_marketing
capability: external, high risk, supports_status_lookup FALSE,
**requires_approval TRUE**. Every recipient gets the complete lineage in ONE
transaction (`marketing_broadcast_create_lineage`): canonical Action →
immutable Decision Package (AUTOMATION_REQUIRES_APPROVAL, routing
tenantReviewRequired) → intent with the FULL frozen envelope (rendered
subject/text/HTML, sender identity, unsubscribe URL + token id, campaign/
revision/snapshot/member/dispatch/approval lineage, content + request hashes)
→ pinned approved_payload_hash → **append-only automation_approvals row,
approver_kind tenant_senior, naming the GENUINE owner/admin who confirmed the
launch under canonical marketing.campaigns.launch** (an Operations actor can
never be labelled tenant_senior — the resolver ceiling + RPC gates + the
execution-time authority all enforce it) → idempotent engine enqueue.
Deterministic request id `bc-<member>-g<generation>`; the delivery-insert
guard recomputes the canonical fingerprint.

### Suppression race closure (three checks, one authority)
1. Audience snapshot (preflight) — canonical eligibility per candidate.
2. `marketing_broadcast_recipient_bundle`/`create_lineage` — the SAME
   `marketing_broadcast_authority_core` BEFORE any intent exists; ineligible
   recipients are skipped with the exact policy code and NO engine rows.
3. The adapter calls `marketing_broadcast_send_authority(delivery)`
   IMMEDIATELY before its single Gmail call (campaign ACTIVE, exact bound
   revision/snapshot/member, launch approval still valid — approver still a
   same-tenant owner/admin holding launch —, sender enabled+ready, capability
   enabled, person/point/destination unchanged, CURRENT eligibility exactly
   'subscribed'). Refusals are permanent policy_* results the reconciler
   projects as SKIPPED (never failed); authority READ errors are safe
   retryable pre-provider failures. There is NO override path.

### Launch, scheduling, workers
Preflight (launch authority only) builds the immutable snapshot + returns
masked samples + a one-use challenge. Launch verifies challenge digest,
actor, campaign version/revision binding, supersession and expiry; replaying
the same request converges; a changed reuse is a stable MK412; parallel
launches create ONE launch + one dispatch per included member (advisory-lock
serialised; PostgREST-proven). Scheduling resolves tenant-timezone local
times with DST truth: nonexistent times → MK414; ambiguous times demand an
explicit fold (earlier|later) → MK415; evidence (local, tz, UTC instant,
fold) is stored. The secret-gated scheduler fn only DISCOVERS due campaigns
(guarded scheduled→active + idempotent dispatch materialisation) and enqueues
platform jobs. The dispatch worker (marketing.broadcast_dispatch, registered
in the existing worker registry) leases ≤10 recipients (SKIP LOCKED + lease
recovery), defers in quiet hours (scheduler re-drives), renders via the pure
deterministic renderer from FROZEN inputs only, creates lineage
transactionally, enqueues engine execution + the existing delivery_sync
reconciler, and continues only while safe claimable work remains. Pause stops
claims AND the pre-provider authority; cancel terminates pending dispatches
outright and cancels ONLY still-pending intents through the engine's legal
transition (executing/unknown work is never rewritten); resume re-activates
without re-dispatching anything that exists — never a submitted or unknown
recipient. Completion is DERIVED (marketing_broadcast_check_completion) on
every terminal path; unknown blocks it until the engine's appended
resolution.

### Unsubscribe (public, non-enumerating)
Opaque 48-hex tokens; DIGEST-only storage; no email/Person id in any URL.
`marketing-unsubscribe` (verify_jwt=false, shares NO tenant-user auth code):
GET → minimal accessible confirmation page; POST (form or RFC-8058 one-click
`List-Unsubscribe=One-Click`) → idempotent apply. Valid, invalid, expired,
revoked and replayed tokens receive IDENTICAL generic responses. A valid
first use appends ONE unsubscribed communication preference + converges ONE
active hard suppression + ONE controlled event + audit, with campaign/
dispatch lineage in evidence — and takes effect immediately (live
eligibility). The MIME carries the visible footer link + List-Unsubscribe +
List-Unsubscribe-Post headers. Launch fails honestly (MK428/CONFIG_REQUIRED)
when MARKETING_PUBLIC_BASE_URL is not configured.

### Click tracking — deliberately NOT implemented
No redirect endpoint exists; approved links are preserved verbatim;
reporting returns clicked = null ("unavailable"), never a fabricated count.
tenant tracking_enabled remains configuration only. A safe implementation
(server-stored destinations, opaque tokens, no open redirects) is a future
phase; nothing unsafe was shipped instead.

### Edge/API surface
`marketing-campaigns` (requireTenantUser + canonical resolver double gate;
exact per-action key allowlists): list/detail (marketing.view) ·
create/revise/duplicate/audience_preview/submit_review (operational role +
campaigns.draft) · test_send (operational role + campaigns.test; sends the
CURRENT revision through the Phase-4 governed test path with fallbacks-or-
[token] rendering and no fabricated unsubscribe link) · request_changes/
approve/preflight/launch/schedule/pause/resume/cancel/archive (owner/admin +
campaigns.launch) · report/recipient_page (reporting.view) · health. Stable
errors: VERSION_CONFLICT/REQUEST_MISMATCH/GUARDRAIL/DST_INVALID/
DST_AMBIGUOUS/CONFIRMATION_EXPIRED/CONFIG_REQUIRED/FORBIDDEN/…; no token
digests, raw tokens, credentials or unbounded recipient lists in any
response. `marketing-broadcast-scheduled-sync` is secret-gated;
`marketing-unsubscribe` is public by design. config.toml gained ONLY the
three marketing entries (phone-operations hunk untouched).

### UI
`MarketingCampaigns` replaces the Campaigns card: Broadcasts (operational) ·
Sequences (Preview) · Templates (Preview) · Objectives & Reporting (Preview
except the real broadcast report) · AI Drafting (Preview — explicitly states
no model generates content). List (status/owner/sender/segment/revision/
schedule/snapshot counts/submitted-skipped-failed-unknown/last activity),
guided editor (sender/segment pickers, personalisation help + fallbacks,
text preview, test send), prominent preflight (counts, exact exclusion
breakdown, masked samples, snapshot hash, refresh-requires-reconfirmation
copy), explicit launch dialog (real-email warning, exact included count,
submitted≠delivered, execution-time suppression recheck, pause limitation,
no exactly-once for unknown), factual report tiles with UNKNOWN visually
loud, bounded recipient drill-down, configuration-required and
permission-gated states. Hidden controls are not the boundary.

### Verification matrix (2026-07-29, local)
| Check | Result |
|---|---|
| `supabase/tests/marketing_broadcasts.test.sql` — 13 sections: authority ceilings (hostile grant inert, explicit deny wins), lifecycle machine + fabrication battery + append-only chains, audience truth (9-candidate breakdown exact; counts = immutable rows; refresh = new snapshot; guardrail MK413; segment-drift MK409; base-URL MK428), launch (challenge digest, actor binding, stale-confirmation MK409, DST MK414/MK415+fold, replay convergence, MK412, empty-audience refusal, excluded-member dispatch impossible), worker (SKIP LOCKED lease, wrong-worker MK423, digest-verified token, forged-token refusal, full engine lineage incl. genuine tenant_senior approval + pinned hash, frozen content survives sender/person edits, submitted projection + structural campaign/person provenance + ingestion convergence + completion), suppression races (pre-dispatch skip with ZERO engine rows; endpoint-change + unsubscribe blocks pre-provider; policy refusal projects SKIPPED not failed, no email row), pause/resume/cancel (claims stop; only pending intents cancel via the legal engine transition; resume creates nothing), unknown freeze (blocks completion; never re-dispatched; appended resolution submits), unsubscribe (idempotent, non-enumerating, digest-only, immediate effect), reporting (facts only; clicked/delivered null; stable pagination), cross-tenant + RLS + service-role-only, tenant cascade WITH append-only guards | **PASS** (dev DB) |
| `scripts/marketing-broadcasts-pure.test.mjs` — 18 tests: personalisation (allowlist, malformed braces, fallbacks, control-strip, injection-inert), rendering (deterministic dual derivation, escaping, hostile labels, footer in both bodies), multipart MIME (alternative parts byte-exact, one-click headers, folded/bounded, injection), discriminated envelopes (exact allowlists both ways), frozen guard × approval model (no approval → APPROVAL_REQUIRED; tenant_senior satisfies; wrong kind/expired never), mocked adapter boundary (policy skip pre-provider with ZERO calls; authority read error → transient; paused blocks; approver de-authorised blocks; healthy path = ONE multipart call; 429 transient; 5xx frozen unknown) | **PASS** 18/18 |
| `scripts/marketing-broadcasts.test.mjs` — PostgREST + real GoTrue JWTs: 11 RPC denials + 2 table-write denials; ops-cannot-approve at the direct RPC; PARALLEL identical launches converge (one launch, 2 dispatches, no dupes) + MK412; PARALLEL workers claim DISJOINT recipients; bundle→lineage→engine→reconcile with tenant_senior approval naming the real owner + ONE canonical email with campaign/person provenance; completion honest while work remains; report clicked=null | **PASS** ×2 (re-run-safe) |
| Phase 0–4 regressions (marketing_foundation/hardening/admin/contacts/senders SQL + senders-pure 24 + senders mjs + access/contacts/admin mjs) | **PASS** |
| Engine regressions (automation_engine / execution_reliability / email_reliability / response_approval_atomicity) | **PASS** |
| `bash scripts/intelligence-conformance.sh` (gate (j) narrowly EVOLVED: exactly the two registered marketing intents; broadcast registered approval-required; genuine tenant-senior lineage + pre-provider authority recheck required; every internal-adapter ban unchanged) | **PASS** |
| `npx tsc --noEmit` · focused lint · production build (npm) · `git diff --check` | **PASS** |
| Fresh clean chain (85 migrations, phone-ops excluded) + suites | **PASS** |
| Upgrade from committed HEAD `c739a39` with seeded campaign/segment/sender/preference/suppression/email/interaction data → run-once, +8 tables, data survives, Phase-4+5 suites pass on the upgraded DB | **PASS** |
| Authenticated Edge HTTP (`marketing-broadcasts-http`) | **NOT RUN — exit 3** (no local Edge runtime; honestly staged) |
| Populated visual QA | **NOT RUN / Preview** — the access gate requires a served authenticated runtime; nothing is claimed |
| REAL broadcast/provider send | **NEVER EXECUTED** — stubbed engine results only; NO email of any kind was sent |

### Honest limitations
- No real email was sent; the adapter transport, Edge HTTP, worker runtime,
  scheduler cron and the public unsubscribe endpoint run only when deployed.
- Click tracking is not implemented (clicked = null, never zero); delivered/
  opened/replied/bounced are provider-unreported and stay null.
- Preference and engine-attempt ledgers are append-only BY PLATFORM DESIGN,
  so tenants with recorded preferences/attempts are undeletable; the cascade
  proof uses preference-free lineage (Phase-4 precedent), with dispatch
  cascade proven from the catalog.
- Quiet-hours deferral is scheduler-redriven (bounded 1-minute polling only
  while a campaign is active with pending work).
- "submitted" = Gmail accepted the request; Gmail offers no idempotency key —
  unknown results freeze for review and are never blindly retried.

### External configuration required before any live broadcast
1. Deploy migration 20260902120000 + the marketing-campaigns /
   marketing-unsubscribe / marketing-broadcast-scheduled-sync functions + the
   shared worker bundle (platform-worker redeploy).
2. Set MARKETING_BROADCAST_SECRET and re-run serviceos_schedule_all() (cron
   is never installed implicitly).
3. Set MARKETING_PUBLIC_BASE_URL to the public functions origin serving
   marketing-unsubscribe (launch fails honestly without it).
4. Gmail gmail.send re-consent / Workspace DWD grant (Phase-4 SENDER_SETUP).
5. An operational mode permitting irreversible external work.
6. Explicit user authorisation for any real test or broadcast send.

### Phase 5 file scope (uncommitted)
Modified: this ledger, `docs/reference/AUTOMATION_ENGINE.md`,
`docs/reference/BACKEND_RUNTIME.md`, `docs/product/marketing-crm/SENDER_SETUP.md`,
`scripts/intelligence-conformance.sh`, `src/lib/capability-registry.ts`,
`src/routes/marketing.tsx`, `supabase/config.toml` (marketing entries only),
`supabase/functions/_shared/marketing_email.ts`,
`supabase/functions/_shared/connectors/marketing_email.ts`,
`supabase/functions/_shared/worker_handlers/index.ts`,
`supabase/functions/_shared/worker_handlers/interactions_sync.ts` (§14e — the
projector now actually writes the `related_campaign_id` the migration adds).
Created: `docs/product/marketing-crm/BROADCAST_SETUP.md`,
`scripts/marketing-broadcasts-http.test.mjs`,
`scripts/marketing-broadcasts-pure.test.mjs`, `scripts/marketing-broadcasts.test.mjs`,
`src/components/app/MarketingCampaigns.tsx`, `src/lib/marketing/campaigns.ts`,
`supabase/functions/_shared/worker_handlers/marketing_broadcast_dispatch.ts`,
`supabase/functions/marketing-broadcast-scheduled-sync/index.ts`,
`supabase/functions/marketing-campaigns/index.ts`,
`supabase/functions/marketing-unsubscribe/index.ts`,
`supabase/migrations/20260902120000_marketing_broadcasts.sql`,
`supabase/tests/marketing_broadcasts.test.sql`.
Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
byte-for-byte outside this scope.

## 14e · Phase 5 — independent adversarial audit pass (2026-07-30, uncommitted)

An independent audit re-verified the §14 claims against the running code
rather than the build report. **Nine defects were confirmed by executable
probes before any edit** and corrected in the SAME uncommitted draft; those
probes became regression locks (SQL §14a–§14g, two pure renderer tests, three
PostgREST checks). Everything else in §14 was re-proven, not restated.

| # | Confirmed defect (probe evidence) | Severity | Correction |
|---|---|---|---|
| 1 | **Pre-Phase-5 campaigns were a governed dead end.** A skeleton `marketing_campaigns` row has no event history; `revise` succeeded but EVERY later transition failed the event-chain guard (`P0001 the first campaign event must be the initial null -> draft record`), so it could never be reviewed, approved or launched — contradicting the documented bootstrap route | High (launch-readiness) | `marketing_campaign_seed_event_chain()` records EXACTLY the initial `null → draft` fact for a chain-less draft, called by `revise` and `transition`; a chain-less non-draft row gets a stable 22023 instead of a raw trigger error. Proven end to end on a genuinely UPGRADED database |
| 2 | **Resuming a paused scheduled campaign sent 7 days early.** `resume` forced `active` and materialised dispatches immediately, so pause+resume was an early launch of an unreached schedule | High (irreversible external effect) | `paused → scheduled` added to the legal machine; `resume` returns an unreached schedule to `scheduled` (schedule evidence preserved, zero dispatches) and only activates when the instant has arrived or the campaign was already active. The scheduler still fires at the original time |
| 3 | **Recipient data could inject live links into approved mail.** The renderer substituted personalisation FIRST and then scanned the RESULT for `[label](url)`, so a contact whose stored name contained markdown link syntax became a real `<a href>` in the HTML part — a phishing destination the approver never saw | High (content trust / security) | Links are extracted from the APPROVED body first; personalisation is substituted into the runs and labels afterwards and never re-scanned. Hostile values survive as inert escaped text; the anchor set equals the approved set |
| 4 | **Sub-hour DST folds were silently resolved.** The ±1-hour probe cannot see Lord Howe's 30-minute fold: `2026-04-05 01:45` occurs twice and one of the two instants was picked without asking | Medium (schedule truth) | The fold probe now covers the real candidate offsets (15/20/30/45/60/90/120 min), nearest first. The 1-hour London fold (MK415) and the spring-forward gap (MK414) behave exactly as before |
| 5 | **`revise` accepted an unvalidated campaign identity** — a 5000-character control-character name was written where `create` bounds it to 120 clean chars | Medium (input integrity) | `revise` validates name/description with the same bounds as `create`; a rejected revision changes nothing |
| 6 | **Out-of-sequence transitions leaked raw trigger exceptions.** `submit_review` on an approved campaign, `pause` on a draft and `archive` on an active campaign reached the guard as `P0001`, which the Edge maps to `INTERNAL` 500 | Medium (API contract) | Every action states its legal precondition in the RPC, so these are stable `22023 → INVALID_REQUEST 400` |
| 7 | **A lost execution enqueue stranded a recipient forever.** A crash after the lineage transaction committed but before `enqueueAutomationExecution` leaves a `queued` dispatch with a `pending` intent; claims only take pending/lease-expired work, the reconciler's ttl runs out, and the campaign can never reach a truthful terminal state | Medium (reliability) | Bounded recovery sweep in the dispatch worker re-enqueues such intents (idempotent at the job key AND the engine claim RPC); the scheduler tenant scan now covers `pending` **and** `queued` |
| 8 | **A new helper shipped client-reachable.** `marketing_campaign_seed_event_chain` (added by this pass) defaulted to `PUBLIC EXECUTE` because the grants block is a hand-kept list | High (authority boundary) | Added to the revoke/grant list, and the SQL suite now enumerates Phase-5 functions **from the catalog**, so any future helper missing its revoke fails loudly. Negative control: granting it to `authenticated` makes the suite fail with that exact message |
| 9 | **Preflight was quadratic at the documented ceiling.** `jsonb_set` accumulation copied the whole accumulator per candidate: measured 0.22s at 500, 3.0s at 2000, **66s at the 10000 ceiling** — one transaction holding the campaign row lock, beyond ordinary gateway timeouts | Medium (launch-readiness) | Rewritten set-based (one ordered pass; counts, breakdown, samples and member rows all derive from the same frozen rows). Measured after: **0.043s at 500, 0.82s at 10000**. Ordering, hash coverage, the exact 9-candidate exclusion breakdown and immutability are unchanged and re-proven |

Two smaller corrections landed in the same pass: a recipient leased by a
worker when the campaign is cancelled is now recorded `cancelled` rather than
returned to `pending` (it can never be sent, so "pending" was untrue), and
`interactions.related_campaign_id` — which the migration adds and the header
claimed the projector wrote — is now actually written by the existing
projector (it was always null, so the documented structural campaign linkage
did not exist). The projector sets it only when the source row carries
`origin_campaign_id`, so it stays safe against a database that predates the
column. A supporting index `(tenant_id, status, created_at)` was added for the
worker claim path, which the campaign-first index could not serve. The launch
dialog gained real dialog semantics (`role="dialog"`, `aria-modal`, a labelled
title, initial focus, a Tab trap and Escape) — it confirms irreversible
external sending.

**Areas re-verified with no defect found** (evidence, not opinion): no Phase-5
function is SECURITY DEFINER (catalog check — so this phase introduces no
`search_path` exposure); cross-tenant lineage is structurally impossible via
composite FKs (suite §11 plus FK-violation probes); every bounded read's
un-predicated sub-select is protected by a composite tenant FK; the launch
confirmation binds tenant/campaign/version/revision/snapshot/actor and is
one-use, expiring and supersedable; the engine's `approved_payload_hash`
(which covers `parameters`) is what prevents content substitution between
approval and provider execution — the SQL side deliberately does not
re-render, and that alternative trust chain is sufficient because the adapter
builds MIME from the frozen envelope only; unsubscribe returns a
byte-identical generic response for valid, uppercase, short, non-hex,
SQL-shaped and null tokens, stores only the digest, leaks no plaintext into
audit rows or events, and cannot touch another recipient; concurrent first use
converges to one preference, one suppression and one event; `mapDbError` never
returns a raw database message.

### Verification performed by the audit pass (2026-07-30)

| Check | Result |
|---|---|
| `supabase/tests/marketing_broadcasts.test.sql` — 13 original sections + **§14a–§14g adversarial locks** (legacy adoption, scheduled pause/resume, out-of-sequence transitions, revise identity bounds, sub-hour DST fold, audience boundaries 0/1/cap/cap+1, cancellation while leased) + the catalog-driven grant lock | **PASS** on the dev DB, a fresh clean-chain DB and an upgraded-from-`c739a39` DB |
| `scripts/marketing-broadcasts-pure.test.mjs` — 18 original + **2 new renderer locks** (recipient data can never introduce a link; hostile values cannot break the HTML structure or the unsubscribe link) | **PASS 20/20** |
| `scripts/marketing-broadcasts.test.mjs` — the original RPC/concurrency proof + **the REAL SQL-built envelope validated against the adapter's exact allowlist** (drift lock), **concurrent unsubscribe convergence**, **the orphan-intent recovery contract** | **PASS**, 4 consecutive runs (re-run safe) |
| Phase 0–4 regressions (`marketing_foundation/hardening/admin/contacts/senders` SQL; access/contacts/admin/senders mjs; senders-pure 24/24) | **PASS** |
| Engine regressions (`automation_engine`, `execution_reliability`, `email_reliability`, `response_approval_atomicity`) | **PASS** on dev + clean chain |
| `bash scripts/intelligence-conformance.sh` | **PASS** (gate (j) unchanged by this pass) |
| Clean full chain (85 migrations, phone-ops excluded) from FINAL bytes + all suites | **PASS** |
| Upgrade from the committed Phase-4 head with seeded campaign/segment/sender/preference/suppression/email/interaction data | **PASS** — exactly +8 tables (175→183), every seeded row preserved, and the legacy skeleton adopted into the governed lifecycle through to preflight |
| Run-once discipline (second application of the migration) | **PASS** — fails loudly (`relation "marketing_campaign_revisions" already exists`) |
| `npx tsc --noEmit` · focused ESLint on every changed TS/TSX file · `npm run build` · `git diff --check` | **PASS** |
| Authenticated Edge HTTP (`marketing-broadcasts-http`) | **NOT RUN — exit 3** (no local Edge runtime; unchanged) |
| Populated visual QA | **NOT RUN** — static inspection + production build only; no served authenticated runtime exists |
| REAL provider send | **NEVER EXECUTED** — no email of any kind was sent |

## 10 · Restart-safe "next phase"
**Next (after the Phase-5 checkpoint): Phase 6 — Sequences** (on the proven
Broadcasts foundation, §14): ordered multi-step sequences (send email / wait
duration / wait-until-window / tag / lifecycle / owner / follow-up steps),
Person-based enrolments with the selected contact point retained, manual +
segment enrolment with deduplication, pause/resume, bounded batch leases,
exits on unsubscribe/hard-bounce/reply/conversion/manual/lifecycle, per-step
and overall factual reporting. Reuse the Phase-5 seams exactly: revisions for
step content, the SAME `send_marketing_broadcast_email`-style governed
delivery per step-send (or a registered sequence intent type with the same
approval honesty), the ONE send authority, the dispatch/lease pattern and the
unsubscribe system. Before starting: commit the Phase-5 checkpoint
(partial-stage `supabase/config.toml` marketing entries only); when deployed,
run the staged HTTP suites and complete [SENDER_SETUP.md](SENDER_SETUP.md) +
[BROADCAST_SETUP.md](BROADCAST_SETUP.md).

**Superseded Phase-5 plan (delivered above, §14):** campaign
create/revise/approve/schedule/launch/pause/archive, audience snapshot +
exclusion reasons, per-recipient governed delivery through the SAME
`email.send_marketing` capability with suppression re-checked at execution,
retry-safe launch queueing, reporting that distinguishes submitted from
delivered/opened only when evidence exists.

**Superseded Phase-4 plan (delivered above):** Sender profiles over
discovered Workspace mailboxes (choose permitted Marketing senders, from-name/
reply-to/signature, default sender, health/capacity, test send, disable without
history loss); the minimum `gmail.send` scope + re-consent + scope reporting;
the provider-neutral delivery adapter contract with `email.send_marketing` as
the FIRST `external_side_effect=true` Automation Engine capability (schema +
policy + enablement + idempotency + audit + adapter + contract row — never a
parallel sender); append-only delivery attempts projecting canonical outbound
Interactions. Before starting: commit the Phase-3 checkpoint (staging only the
marketing hunks of `supabase/config.toml`), and when any marketing fn is
deployed, run ALL staged HTTP scripts (`marketing-access-http`,
`marketing-contacts-http`, `marketing-admin-http`, `data-import.test.mjs`)
plus populated visual QA before marking anything Live.
