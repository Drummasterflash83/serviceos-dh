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
| 2 | Contacts vertical slice | Not started |
| 3 | Settings, segments, imports | Not started |
| 4 | Workspace sender & governed delivery | Not started |
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

## 10 · Restart-safe "next phase"
**Next: Phase 2 — Contacts vertical slice.** Build the server-side Contact projection
over `people` + `contact_relationships` + `contact_points`: paginated/sorted/filtered
query edge function, inclusion-setting behaviour, lifecycle/owner updates (audited), tag
+ eligibility, suppression visibility, provenance, linked interaction history, and the
Person detail integration (evolve the Customer Card, never a second profile). Exact
prompt in the final Phase-1 report.
