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

| Phase | Title                                                             | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit & design reconciliation                                     | **Done** (this ledger)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1     | Foundations (shell, route, schema, permissions, config)           | **COMMITTED as `7cf1dcf`** (`feat(marketing): add secure tenant-scoped foundation`). Shell, route, schema, permissions and config. The `marketing-access` authenticated **HTTP path remains unexecuted locally** (no served edge runtime) and is deploy-gated — see §11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2     | Contacts vertical slice                                           | **COMMITTED as `24b4497`** (`feat(marketing): add governed contacts vertical slice`, 2026-07-29 — partial-staged `supabase/config.toml` marketing hunk only). One consistent record in §11: mandatory-key create idempotency (key lock before ledger read — no same-key duplicate People, ever), tenant-safe bounded identity evidence, strict payload shapes at both boundaries, single-row relationship filters, exact contact-point concurrency tokens (set_primary removed), invalid-evidence-aware eligibility, current-relationship card projection, true key-based event dedup, run-once release migration (no destructive drops). NOT launch-proven — HTTP proofs NOT RUN, populated visual QA Preview.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3     | Settings, access admin, lifecycle, tags, segments, imports, audit | **COMMITTED as `6e64b0b`** (`feat(marketing): add governed admin, segments and imports`). Three correction passes + DB/PostgREST-proven — see §12; pass 3 (§12c) fixed 3 findings. Authenticated HTTP remains deploy-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4     | Workspace sender & governed delivery (test-send vertical)         | **COMMITTED as `c739a39`** (`feat(marketing): add governed senders and test delivery`). Correctness/security pass (14 findings, §13b) + final integrity pass (6 findings, §13c) + §13d micro-correction. Sender profiles composite-FK bound to existing Gmail-OAuth/Workspace mailboxes; canonical live readiness; `email.send_marketing` external/high with the TEST-ONLY `send_marketing_test_email` intent (`requires_approval` FALSE — an explicitly authorised DELEGATED test action under `marketing.campaigns.test`; no approval row is fabricated, and the frozen approval guard still protects the broadcast boundary); frozen-envelope-only delivery; request-fingerprint idempotency; factual delivery states. NOT deployed; NO real email ever sent; HTTP staged exit 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5     | Broadcasts end to end                                             | **COMMITTED as `48674be`** (`feat(marketing): add governed broadcasts`, 2026-07-30 — partial-staged `supabase/config.toml` marketing hunk only). Independent adversarial audit passed with **nine confirmed defects fixed — see §14 and §14e**. One campaign model, immutable audience snapshots, governed launch confirmation, leased dispatch and evidence-based reporting. NOT deployed; NO real email ever sent; authenticated Edge HTTP and populated visual QA remain deploy-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6     | Governed Sequences & scheduler                                    | **COMMITTED as `60cc18f`** (`feat(marketing): add governed sequences and scheduler`, 2026-07-30) — built, locally proven and INDEPENDENTLY AUDITED TWICE; NOT pushed/deployed. Nine defects were confirmed against executing code and corrected: six in the first pass (§15c) and three in the second (§15d). One campaign identity (`campaign_type = 'sequence'`); immutable bundle-hashed revisions + ordered steps; Person-based, revision- and endpoint-pinned enrolments from an immutable batch recording EVERY candidate; one-use digest-only activation and enrolment confirmations; a lease-safe `marketing.sequence_advance` worker with waits resolved deterministically in SQL on the database clock; the approval-required `send_marketing_sequence_email` intent with genuine tenant_senior lineage; the INTERNAL `marketing.contact_action` capability executed only through existing governed RPCs; evidence-only exits; truthful completion (open ≠ closed ≠ completed); operational health; an accessible Sequences UI. **Follow-up creation stays configuration-gated** at authoring, in the UI and at canonical Action creation until `('core','Action')` state transitions exist. NOT deployed; NO email ever sent; authenticated Edge HTTP, populated visual QA, scheduler installation, provider authorisation and real sending remain explicit launch gates.                                                                                                                                                                                                                                                                                             |
| 7     | Templates, Objectives & Honest Reporting, Governed AI Drafting    | **BUILT + locally proven + INDEPENDENTLY AUDITED (§16b: six reproduced defects corrected, four initial UI defects corrected) + PRODUCTION-READINESS PASS COMPLETE (§16c: all seven Template mutations request-idempotent through the canonical request-key ledger; every recorded accessibility/forbidden-state gap closed) — CHECKPOINT-READY, the content of this checkpoint commit** (2026-07-31, §16). One safe content model (Template revisions + AI proposals reuse `marketing_campaign_validate_content` verbatim); exact-revision pinning with byte-match-enforced lineage; the ADDITIVE `marketing_campaign` target kind on canonical `objective_links` with a governed validator + append-only relationship history (a link records INTENT; nothing is ever fabricated into measurements/health/contribution); one reporting projection COMPOSING the canonical per-type reports (jsonb-equality proven); `ai.generate_marketing_draft` through the frozen Automation Engine (delegated `requires_approval=false` honestly, Vault-only credentials, immutable proposals + human revisions, acceptance writes DRAFTS only). NOT pushed/deployed; NO model request ever made; NO email ever sent; authenticated Edge HTTP exit 3 and populated visual QA NOT RUN — they remain explicit launch gates with provider verification and the first authorised generation.                                                                                                                                                                                                                                                                                                    |
| 8     | Ads lead capture, attribution, metrics & source health            | **COMMITTED as `df8b6c5`** (`feat(marketing): add governed ads lead capture and attribution`, 2026-08-01 — partial-staged `supabase/config.toml` marketing hunk only). INDEPENDENTLY AUDITED (§17b: eleven confirmed defects reproduced and corrected, each with a regression lock that first fails against the defective code) (2026-07-31, §17). Versioned/audited Ad Sources (provider/mode immutable, request-id idempotent mutations, append-only version history, archive recoverable); ONE operational ingestion mode — the provider-neutral SIGNED WEBHOOK (HMAC-SHA256 over timestamp + raw bytes, per-source Vault-brokered secret shown once, opaque non-enumerable route key, ±300s freshness, constant-time compare, ONE generic 401 for every auth failure with zero writes); append-only event ledger (identical replays converge + count; same-id/different-body = digest-only conflict); `marketing.ad_lead_process` worker → ONE canonical inbound Interaction per event + canonical identity resolution (`marketing_create_contact` superset with honest `ad_lead` provenance; ambiguity → the EXISTING `marketing_identity_conflicts` review path; NO subscription ever invented); append-only attribution touchpoints (unique per event, write-once person link, derived first/last touch); append-only metric facts with supersession — CPL only when genuinely derivable, else null + exact reason. Meta/Google Ads/LinkedIn/Sheet truthfully Not connected (no adapter, no manual sync, nothing fabricated); no scheduled sync registered (nothing polls); NO provider contacted, NO real lead, NO email, NO model call; HTTP exit 3; visual QA NOT RUN. |
| 9     | Marketing platform seams (connections, sync, observability)       | **COMMITTED as `70e67cc`** (`feat(marketing): Phase 9 platform seams (connections, sync, observability)`, 2026-08-01 — partial-staged `supabase/config.toml` marketing hunk only) (§18). The provider-connection SEAM layer with ZERO adapters implemented: `marketing_provider_accounts` with a guard-enforced lifecycle (preview → connecting → connected → error → revoked; `connected` reachable ONLY through the service-role adapter seam with non-empty verification evidence — the public connect action lands truthfully in error/`no_adapter` with BOTH transitions recorded); Vault-only credentials with mark-BEFORE-store idempotent rotation and the bounded 86400 s overlap clock (the Phase-8 F3/F4 contract, same constant); a lease-safe single-flight sync engine (`marketing_provider_sync_runs` + request/claim/complete) with truthful MK430 refusal for every non-connected account and the attempts >= 10 poison retirement; the SCHEDULED path is due-computation only — NO cron registered, nothing polls; computed freshness (never_run / error / stale / fresh, each with its reason); the `marketing.provider_sync` worker handler completes claims honestly as failed/`no_adapter`; an accessible Connections panel with per-section retryable errors, no fake spend/CPL/connected ever. Function namespace `marketing_provider_%`, locked BOTH directions — the committed Phase-8 catalog lock passes undisturbed alongside it. NOT deployed; NO provider contacted; NO credential usable; HTTP + populated visual QA + PostgREST-boundary mjs remain launch gates.                                                                               |
| 10A   | Provider sync hardening (simulator, boundary closure)             | **BUILT + locally proven at EVERY local boundary — UNCOMMITTED, CHECKPOINT-READY** (2026-08-01, §19). The deterministic `serviceos_test_provider` simulator (env-gated, ABSENT from the production catalogue) closes the functional loop through the REAL code paths: adapter-aware connect (worker-validated through the seam), bounded external-account discovery + governed selection, canonical digest-deduped revision-superseded provider facts, honest account reporting (mixed currencies null+reason, zero-lead CPL null, absence never zero), idempotent scheduled enqueue, drain-job priming, revocation retiring queued work. PROVEN at four boundaries: SQL suites (fail-before/pass-after), pure suites, PostgREST (47 assertions), and a genuinely SERVED local Edge runtime + the real platform-worker (120 assertions across two deterministic three-tenant journey rounds: healthy / degraded / failing+security). ZERO real provider adapters exist; Meta/Google Ads/LinkedIn/Sheet remain truthfully Not connected with recorded blockers (§19). NOT deployed; no cron installed; populated visual QA NOT RUN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 10B   | Reviewed real-provider adapters + launch                          | Not started — BLOCKED on external prerequisites (provider app registrations, developer tokens, OAuth product decisions, live credentials); see §19 provider matrix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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

| Brief concept       | Canonical repo reality                                                                                                                                                                                                                       | Evidence                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Person              | `people` (`id, tenant_id, company_id→companies, display_name, first_name, last_name, primary_email, primary_phone, address_text, postcode, metadata, verified, created_source`)                                                              | `supabase/migrations/20260709120000_customer_cards_foundation.sql:50`, extended `20260709140000_identity_engine.sql` |
| Company             | `companies` (`id, tenant_id, name, domain, phone, address_text, postcode, metadata, verified, created_source`)                                                                                                                               | `20260709120000_...:27`                                                                                              |
| Person↔Company      | **single nullable FK** `people.company_id`. No many-to-many join table exists.                                                                                                                                                               | `20260709120000_...:53`                                                                                              |
| Identity resolution | edge `identity-resolve` → `_shared/worker_handlers/identity_resolve.ts`, pure `_shared/identity.ts`. Confidence vocab `UNKNOWN\|POSSIBLE\|LIKELY\|CONFIRMED\|REJECTED`; deterministic (exact email/phone/domain), **no silent name merges**. | `_shared/identity.ts:15,150`                                                                                         |
| Weak-match review   | `interaction_match_suggestions` (`match_level confirmed\|likely\|possible\|rejected`, `confidence numeric(5,4)`, `evidence jsonb`, `status pending\|accepted\|rejected\|superseded`) — evidence-led proposals, never silent merges.          | `20260709120000_...:120`                                                                                             |

**Contact points:** there is **no customer-side multi-value contact-point table**
today — only scalar `people.primary_email` / `people.primary_phone`. The staff-only
`communication_endpoints` (Control Plane, `20260821120000`) is the prior-art _shape_
(channel / endpoint_kind / normalized_value / effective-dated) but is operator-gated
and staff-scoped. → **Phase 1 adds a canonical `contact_points` table** mirroring that
shape for customer People (not marketing-bespoke), so the platform gains a real
multi-endpoint model. Scalar `primary_email/phone` remain the fast path.

### 1.2 Interactions, events, graph, cards, objectives (REUSE — project additively)

| Brief concept                    | Canonical repo reality                                                                                                                                                                                                                                                                                                                          | Evidence                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| One interaction history          | `interactions` — idempotency `unique (tenant_id, source_table, source_id)`; `direction inbound\|outbound\|internal\|unknown`; `related_person_id/company_id`; `processing_status pending→ready→enriched`. Projected by **hardcoded** per-channel projectors.                                                                                    | `20260708140000_interactions.sql:16`; `_shared/worker_handlers/interactions_sync.ts` |
| Event bus                        | `platform_events` (dotted `domain.noun.verb`; idempotent partial-unique on pending subject). Helper `publishEvent()`/`markEventsConsumed()`.                                                                                                                                                                                                    | `20260709150000_platform_events.sql:22`; `_shared/events.ts`                         |
| Business Graph                   | `graph_nodes`/`graph_edges`/`graph_events`. Node **types are data** (`domain_entity_types`); **projection is hardcoded code** (`business_graph_sync.ts`). Confidence = 1.0 FK / <1.0 inferred.                                                                                                                                                  | `20260709160000_business_graph.sql`; `_shared/business_graph.ts`                     |
| Customer Cards                   | `customer_cards` — **one card per person**. `customer_card.sync` spread-merges `context: {...existing, projection}`, so a `context.marketing` blob **survives every re-sync**. Respect `locked_fields`.                                                                                                                                         | `20260709120000_...:80`; `_shared/worker_handlers/customer_card_sync.ts:353`         |
| Objectives & Outcomes            | `objectives`, `metric_definitions`, `measurements`, `objective_links` (relation `supports\|contributes_to\|…`; `target_kind` incl. `graph_node\|intelligence_object`, **no `campaign`/`interaction`**). Attribution is **measurement-evidence gated** (opens/clicks never count); verified business-outcome evidence types are **empty in v1**. | `20260720120000_objectives.sql:167`; `_shared/intelligence/objectives.ts`            |
| Generic observation/action store | `intelligence_objects` (`object_type` data-registered, RACI hot-cache, evidence, `source_interactions[]`, `source_entities[]`). Reusable for operational marketing signals, **not** strategic objectives.                                                                                                                                       | `20260716120200_intelligence_objects.sql:11`                                         |

### 1.3 Automation Engine & connectors (REUSE — no parallel sender)

- **Governed execution:** `automation_intents` (immutable `parameters`, `idempotency_key`,
  `capability_key`, `correlation_id`, `approved_payload_hash`), capability registry
  `automation_connector_capabilities`, intent-type registry `automation_intent_types`,
  **execution contract** `automation_capability_contracts` (a capability cannot be
  claimed/executed without an _enabled_ contract row), append-only
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

| Brief requirement                                     | Exists?                                       | Resolution                                                                  |
| ----------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| Canonical People/Companies                            | ✅ Reuse                                      | Project Contacts over `people`+`companies`                                  |
| Multi-value contact points (customer)                 | ❌ Missing                                    | **Add** canonical `contact_points` (Phase 1)                                |
| Contact relationship + lifecycle + owner + provenance | ❌ Missing                                    | **Add** `contact_relationships` + `marketing_lifecycle_stages` (Phase 1)    |
| Communication preference (append-only)                | ❌ Missing                                    | **Add** `communication_preferences` (Phase 1)                               |
| Hard suppression (fail-closed)                        | ❌ Missing                                    | **Add** `contact_suppressions` (Phase 1)                                    |
| Tags + Person↔Tag                                     | ❌ Missing                                    | **Add** `marketing_tags` + `contact_tag_assignments` (Phase 1)              |
| Versioned dynamic segments                            | ❌ Missing                                    | **Add** `marketing_segments` (Phase 1 skeleton; eval Phase 3)               |
| Campaign umbrella + state machine                     | ❌ Missing                                    | **Add** `marketing_campaigns` (Phase 1 skeleton; delivery Phase 4–5)        |
| Immutable audience snapshot                           | ❌ Missing                                    | Phase 5 (`campaign_audience_snapshots`)                                     |
| Tenant marketing settings (versioned)                 | ❌ Missing                                    | **Add** `marketing_settings` (Phase 1)                                      |
| Granular marketing permissions + per-user grants      | Partial (`profiles.role`, `authority_grants`) | **Add** `marketing_permissions` vocab + `marketing_access_grants` (Phase 1) |
| Protected `/marketing` route reusing `/app` shell     | ❌                                            | **Add** `AppChrome` extraction + `src/routes/marketing.tsx` (Phase 1)       |
| Governed delivery via Automation Engine               | ✅ Engine exists; capability missing          | Phase 4 (`email.send_marketing` capability + adapter)                       |
| Preview-first import                                  | ✅ Reuse                                      | Phase 3 (contact import profile seed)                                       |
| Interactions/graph/cards/objectives projection        | ✅ Reuse                                      | Phase 4/5/9 (additive projectors, `context.marketing`)                      |

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
  - indexes + constraints + platform vocabulary/template seeds. Additive, idempotent.
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

| Brief scenario                                                             | Phase | Phase-1 state                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Permissions: admin grants a user Marketing access                          | P1/P3 | schema + canonical resolver **DB-proven** (grant + deny paths); admin UI P3                                                                                                    |
| Permissions: user without access can't see nav / open `/marketing`         | P1    | **DB-proven structurally** (RLS denies direct reads without `marketing.view` — bypass closed); client gate implemented; **HTTP path of the access fn NOT yet exercised** (§7f) |
| Permissions: viewer can't mutate via direct Edge call                      | P1    | **DB-proven**: no client write policies; materialise RPC execute revoked from authenticated/anon; fn restricts materialisation to owner/admin (HTTP proof pending §7f)         |
| Contacts: discovered Person appears by default; inclusion setting followed | P2    | config flag `include_all_discovered` laid ✅; query P2                                                                                                                         |
| Suppression cannot be bypassed                                             | P4/5  | schema fail-closed **DB-proven** for all three scopes (destination/person/contact-point)                                                                                       |
| UI states truthful (Live/Preview/Not connected)                            | P1    | ✅ — and section reality labels now derive from the capability registry                                                                                                        |

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

| #   | Finding (confirmed)                                                                                                                                                                             | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `marketing-access` materialised config **before** checking permissions; unchecked query results; silent fallback to role defaults on grant-read errors; full config returned to any tenant user | Function rewritten as a thin, fail-closed shell over **canonical DB authorities**: permissions resolved FIRST via RPC `marketing_effective_permissions`; every result checked; any resolver/config error → HTTP 500 with no access and an `audit_logs` row; denied callers get ONLY `{can_view:false, reason}` (no settings/stages/permissions/role); materialisation is owner/admin-only via the service-role-only RPC `marketing_materialise_defaults` — checking access never mutates config                                                                                                                                                  |
| 2   | **Direct-read bypass**: RLS gated only on `tenant_id = current_tenant_id()`, so a same-tenant user without `marketing.view` could read every Marketing table directly                           | **Structural RLS enforcement** (approach 2, documented): one canonical resolver — `marketing_role_defaults` (defaults as data) + `marketing_effective_permissions` (SECURITY DEFINER; role defaults ∪ explicit grants ∖ explicit denies; `marketing_enabled` gate; fail-closed) — wrapped by `marketing_has_permission()` and required by every protected table's SELECT policy. Grants table requires `marketing.access.manage`. Vocabulary tables stay platform-readable (authority_permissions convention). The Edge Function consumes the SAME resolver — no duplicated authority                                                            |
| 3   | Single-column FKs allowed cross-tenant lineage under a service-role bug                                                                                                                         | `marketing_tenant_guard()` trigger (canonical `automation_vertical_tenant_guard` pattern, jsonb-based for mixed row shapes) on all 10 marketing tables: person/company/contact-point/tag/segment refs must match the row's tenant; lifecycle stage keys must exist for the tenant (or template); ALL profile-reference columns (owner/created_by/updated_by/recorded_by/assigned_by/approved_by/launched_by/profile_id/granted_by) must name an existing profile **in the same tenant** (see §6b — the initial tenantless-profile allowance was itself a finding and was removed)                                                                |
| 4   | `contact_points` unique `(tenant, channel, normalized_value)` forced one Person per endpoint — contradicting shared-device handling and "no silent merges"                                      | Uniqueness moved to **per-Person**: `(tenant, person, channel, normalized_value)`; shared endpoints across People are allowed and surface as ambiguity for identity review; non-unique lookup index `(tenant, channel, normalized_value)` retained; **one primary per (person, channel)** enforced by partial unique index. Scalar `people.primary_email/phone` documented as the canonical fast path until a governed backfill                                                                                                                                                                                                                  |
| 5   | `timezone` defaulted every tenant to `Europe/London` (Drummonds assumption)                                                                                                                     | Default now `UTC` (no canonical tenant-timezone source exists — `tenants` has none). Drummonds receives `Europe/London` as tenant configuration via Settings (Phase 3) or a tenant-data seed, never as schema/application logic. Remaining sweep: relationship/lifecycle defaults are universal template vocabulary from the brief, `reply_handling` is a mode default — no tenant-specific values remain in the migration. Frontend note: the shared `/app` chrome's "Drummond Heating/DH" branding is **pre-existing** shell behaviour carried over unchanged, recorded as platform debt (tenant-branding source), not introduced by Marketing |
| 6   | Capability registry claimed `marketing.route` LIVE/`proven:true` with the HTTP layer unexecuted                                                                                                 | Both `marketing.route` and `marketing.lifecycle` downgraded to `PREVIEW`/unproven with explanations distinguishing DB-proof from HTTP-proof; `/marketing` section cards read their reality label FROM the registry (`getCapability`) so the UI can never out-claim it                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | Prior "migration applies" evidence was a direct psql run onto a drifted local DB                                                                                                                | Full **clean-chain** (81 migrations, fresh disposable container) and **upgrade-path** (chain→20260827 head, seed data, apply marketing, data preserved, +13 tables exactly) proofs — see §7. Local dev DB drift documented below                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | Template rows `tenant_id is null` needed review                                                                                                                                                 | Confirmed canonical: identical to `import_profiles` platform defaults. Protections verified: no client write policies anywhere (service-role only), template reads now ALSO require `marketing.view`, materialisation copies template→tenant rows only, tenant renames/retirements touch only tenant rows, count-guard + partial unique indexes make the copy race-safe. Kept on repository evidence                                                                                                                                                                                                                                             |
| 9   | Suppression dedup only covered non-null destinations                                                                                                                                            | Three-scope active dedup: destination `(tenant,channel,normalized_value)`, person `(tenant,channel,person)` when no destination/point recorded, contact-point `(tenant,contact_point)`; plus `contact_suppressions_target_check` (a suppression must name a target). Lifting preserves history/actor/evidence and allows re-suppression                                                                                                                                                                                                                                                                                                          |
| 10  | 553-line formatting-only churn in `capability-registry.ts`; ledger claims ahead of reality                                                                                                      | File restored to original formatting via `git checkout` + entries re-added in the file's own compact style (diff is now additive); this ledger reconciled (this section, §0, §5, §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

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

| Check                                                                       | Result |
| --------------------------------------------------------------------------- | ------ |
| Hardened migration applies to the local dev stack (self-upgrade over draft) | ✅     |

**(b) Clean full-chain migration (fresh disposable `supabase/postgres:17.6.1.141` container)**

| Check                                                                                                                                       | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All **81** repo migrations apply in canonical order (no name/order/object conflicts, no function/RLS replacement regressions)               | ✅                                                                                                                                                           |
| `marketing_foundation` + `marketing_hardening` + pre-existing `control_plane` + `automation_engine` SQL suites pass on the resulting schema | ✅ (env bootstrap shim documented: minimal `storage.buckets` + GoTrue's `is_sso_user`/`is_anonymous` columns, which services provision in real environments) |

**(c) Upgrade-path migration (second disposable container)**

| Check                                                                        | Result                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain through the previous head `20260827120000` applies                     | ✅                                                                                                                                                                     |
| Seeded tenant/person/interaction data, then applied the marketing foundation | ✅ applied cleanly; **data preserved**; table delta exactly +13 (12 domain tables + `marketing_role_defaults`); no drops of unrelated objects; no history manipulation |
| Both marketing SQL suites pass on the upgraded database                      | ✅                                                                                                                                                                     |

**(d) RLS & structural integrity (real database boundary)**

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Result                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `supabase/tests/marketing_foundation.test.sql` (isolation, write-denial, append-only, dest-suppression, RLS-enabled, seeds)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ✅ ALL ASSERTIONS PASSED                                        |
| `supabase/tests/marketing_hardening.test.sql` — resolver verdicts (owner/admin/ops/viewer/granted-viewer/denied-admin/disabled-tenant/unknown-profile); same-tenant viewer & denied-admin read ZERO from all 11 protected tables; granted viewer reads; grants need `access.manage`; cross-tenant zero; authenticated writes + RPC execute denied; 12 cross-tenant reference classes rejected + valid same-tenant rows accepted + null-actor rows allowed; **tenantless profiles rejected as actors with AND without an active platform.controlplane.admin grant**; materialise-RPC actor integrity (cross-tenant/tenantless rejected, null audited as 'service'); **authenticated role can execute only the self-only resolver wrapper** (arbitrary-profile resolver → insufficient_privilege); shared endpoints/dup-person/primary rules; 3-scope suppression dedup + target check + lift/re-suppress | ✅ ALL ASSERTIONS PASSED (local dev DB AND both disposable DBs) |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ✅ clean                                                        |

**(e) Data-logic boundary (real RPCs via PostgREST — NOT copied logic)**

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `scripts/marketing-access.test.mjs` — resolver verdicts over real auth users; **authenticated grant boundary over real GoTrue JWTs via PostgREST** (self-resolve OK; cross-profile and cross-tenant resolve → 42501; pure-anonymous → 42501 on both resolver functions); service role resolves specified profiles; materialise RPC blocked for anon (42501); idempotent materialisation + single audit row; UTC default; disabled-tenant strips owner | ✅ 25/25 PASS |
| `node --test src/lib/marketing/permissions.test.ts` (client mirror, advisory)                                                                                                                                                                                                                                                                                                                                                                         | ✅ 6/6        |

**(f) Authenticated HTTP boundary — NOT EXERCISED (honest)**

| Check                                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/marketing-access-http.test.mjs` (full contract: owner/admin, ops non-materialising, minimal viewer deny, explicit grant, explicit deny, 401, idempotency) | ⏸ **NOT-RUN (exit 3)** — no edge runtime exists locally and none may be installed; the script refuses to fake success. **Required staging verification:** serve `marketing-access` (deploy or `supabase functions serve`) and run this script with staging env; it must print "ALL PASS (real HTTP boundary exercised)" before `marketing.route` may be marked Live/proven |

**(g) Regression + build**

| Check                                              | Result                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:openfolk` / `npm run verify:product` | ✅ 23/23 / passed                                                                                                                                                                                                                                               |
| ESLint on changed files                            | ✅ clean on all changed files except `capability-registry.ts`, which deliberately keeps its pre-existing (non-prettier) formatting to avoid 550 lines of unrelated churn — repo-wide lint separately fails on ~1,977 pre-existing violations in untouched files |
| `npm run build` (production)                       | ✅                                                                                                                                                                                                                                                              |
| Visual QA                                          | ✅ re-verified after hardening (fail-closed states unchanged)                                                                                                                                                                                                   |

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
  > 1 → `ambiguous` with bounded (≤6, `truncated` flagged) minimal candidates
  > (person_id, display_name, matched_on[]) + durable `marketing_identity_conflicts`
  > record whose `identifiers` field lists, PER supplied identifier, exactly which
  > People matched it (mixed email/phone matches are never mislabelled); every
  > evidence query joins the candidate Person back to the tenant on BOTH sides
  > (corrupt cross-tenant contact-point refs can never leak a foreign Person id)
  > and stored candidate arrays are bounded (25 ids + per-identifier truncated
  > flag). Concurrency & idempotency (mandatory): `p_idempotency_key` and a REAL
  > same-tenant actor are required (null → 22023 before any write); the
  > tenant+key advisory lock is taken FIRST, before the ledger read, so same-key
  > racers — including name-only creates — can never both see an empty ledger
  > and each commit a Person; the ledger returns/conflicts before any identity or
  > Person mutation; only then the per-identifier locks (email then phone,
  > deterministic) serialise overlapping identities; the unique (tenant, key)
  > constraint stays as defence in depth. The fingerprint is canonical stored
  > JSON (jsonb text, sorted keys — collision-free by construction) over EVERY
  > material field: display/first/last name, normalised email/phone, company,
  > owner, relationship type, lifecycle stage; identical retry returns the stored
  > result, any material difference → 55000. Different keys with identical
  > name-only input intentionally remain two People.
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

| Boundary / check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/tests/marketing_contacts.test.sql` — 20 sections: inclusion + classified definition; SINGLE-ROW relationship filters (all supplied predicates — lifecycle/type/status/owner/relationship-source — on ONE row; cross-row combinations proven non-matching; the matching row is the projected relationship; no duplication); invalid input 22023s incl. the TYPED cursor contract (null v rejected for name/created, non-object and v-less cursors rejected, never ignored); pagination name + NULL-heavy last-contact asc/desc (no gaps/dups, null-v cursors round-trip); eligibility normalisation/linkage/mismatch/malformed/invalid-primary/scope-ranked precedence + same-scope resubscribe + INVALID-SCALAR-EVIDENCE (invalid point matching the scalar → invalid; usable alternative still selected); formatted-scalar suppression visibility; per-identifier ambiguity evidence (mixed email/phone never mislabelled) + conflict event; mandatory-key fingerprint idempotency (all material fields incl. first/last names; payload + actor conflicts; NULL key and NULL actor → 22023 with no writes); §9b STRICT SHAPES + relationship contract (array/scalar/empty changes, expected_version-without-id, allow_new-with-id, non-active status on create, non-boolean flags → 22023 with ZERO writes/audits/events); explicit relationship targeting + mandatory version + no-op rejection + allow_new + reactivation; owner persistence/validation; Customer Card current-relationship projection (relationship_id included; historical-row edit never overwrites the card); per-field event types + payloads + transition accumulation; §11b TRUE key-based event dedup (same k + different timestamps → one transition, current unchanged; new k appends; empty k → 22023); contact-point update with EXACT concurrency token + protection + before/after audit evidence + conflict AUDIT on endpoint edits; §12b no-op edit semantics + removed set_primary shorthand + invalid-primary rejection + stale-token-on-primary MK409; tag events incl. tag.created; corrupted cross-tenant fixtures incl. §15b EVIDENCE leakage (foreign Person ids never in candidates/identifiers/candidate_person_ids on create or edit paths); authenticated RPC denial | **PASS** (local + clean-chain + upgraded DBs)                                                                                                                                                                                  |
| `scripts/marketing-contacts.test.mjs` — real GoTrue JWTs: 9 RPCs denied 42501 (authenticated + anon); service end-to-end; byte-identical different-key parallel creates → one Person; **OVERLAPPING-identity parallel creates → one Person, one existing**; **SAME-KEY name-only parallel creates → exactly ONE Person, identical results (key lock, no orphan duplicate)**; **same-key identified parallel → one Person**; identical retry returns stored result; same key + changed payload → 55000; **same key + changed first_name → 55000**; **null key → 22023 with no writes**; **different-key identical name-only → two People intentionally allowed**; ambiguity + per-identifier evidence; MK409 stale version; update surface; **concurrent contact-point updates → one winner + one MK409**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **PASS** (42/42)                                                                                                                                                                                                               |
| `scripts/marketing-access.test.mjs` (regression) 25/25 · foundation + hardening SQL suites · unit 6/6 · openfolk 23/23 · product-alignment · lint (changed files) · `tsc --noEmit` clean repo-wide (the one error it found — a too-narrow tag-helper type in `MarketingContacts.tsx` — was a Phase-2 defect, fixed this pass) · production build · `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PASS**                                                                                                                                                                                                                       |
| Clean full chain (82 migrations = 81 tracked + the contacts migration, fresh disposable container; the unrelated untracked telephony migration from a concurrent session is excluded from Phase-2 scope) + 5 SQL suites (foundation, hardening, contacts, control_plane, automation_engine)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS** (re-proven after the verification-pass fixes)                                                                                                                                                                         |
| Upgrade path (tracked chain → committed head 7cf1dcf → seed people/relationship/contact-point/preference/suppression → corrected 20260829 applies as a normal RUN-ONCE migration — no destructive drops, no reapplication claim; data preserved; table delta exactly +2; all 3 marketing suites pass on the upgraded DB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **PASS** (re-proven after the final correction pass)                                                                                                                                                                           |
| Authenticated Edge HTTP (`marketing-access-http` / `marketing-contacts-http`, now covering create/retry/fingerprint-conflict/ambiguous/update/cp-update/stale-version/invalid-cursor/**null-v cursor accepted for last_contact + rejected for created**/**wholly no-op update → 400**/**missing AND explicit-null idempotency key → 400**/**array body / array changes / array person → 400**/**expected_version without relationship_id → 400**/per-mutation denials/safe bodies/cross-tenant)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **NOT RUN** — no edge runtime exists locally and none may be installed; scripts exit 3 rather than fake success (re-confirmed this pass: both exit 3). Blocker: deploy or `supabase functions serve` on a machine with the CLI |
| Populated responsive UI QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Preview** — blocked by the same runtime gap (the access gate fail-closes before data loads); fail-closed error state verified in-browser. To complete on staging                                                             |
| Capability registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `marketing.*` remain **Preview** until the HTTP proofs pass. Phase 2 is safe as a LOCAL CHECKPOINT; it is **not launch-proven** until HTTP + visual gates pass                                                                 |

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

## 12 · Phase 3 — Settings, access admin, lifecycle, tags, segments, imports, audit (2026-07-29; built, CORRECTION-PASSED, COMMITTED as `6e64b0b`)

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
   _(Refined in §12c: as written in pass 2 the trigger returned NEW
   unconditionally for any `failed` row — an update shaped like a retry could
   also rewrite id/tenant/import/row/created_at, and the set-null exemption
   did not compare those fields either. Pass 3 pins identity/lineage on EVERY
   update and counts retries; the pass-2 wording overstated what was
   enforced.)_
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
   cascade cleanup still works. _(Retracted from this item: "updates only
   through the governed failed→terminal transition." A trigger cannot know
   its caller, so it can never restrict updates to the governed RPCs — and
   the pass-2 trigger did not even constrain a failed row's update shape.
   §12c states the honest structural guarantee now enforced.)_
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

| Boundary / check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_admin.test.sql` — 14 sections covering EVERY corrected finding across ALL THREE passes (new in pass 3: §7g structural transition guard — a failed row cannot be moved to another import, nor to another tenant even paired with that tenant's REAL import, nor renumbered/re-identified/re-dated; uncounted (+0) and over-counted (+2) retries rejected; recorder failed→failed/invalid and row-RPC failed→created/updated/conflict all counted attempt+1; terminal reason tweaks and set-null-with-smuggled-change rejected; genuine Person/conflict-delete FK set-nulls preserve outcome+attempt+lineage; import- and tenant-delete cascades intact; vanished-person contract — the row RPC source contains the retryable 40001 raise and no longer contains the unrecorded-invalid return shape; §4 pass-3 additions — single-contact assign of an INACTIVE tag → 22023 with zero writes, remove stays legal while inactive, reactivation restores assignability; new in pass 2: §7d sealed-defaults truth — settings changed after preview change nothing, retired sealed stage / deactivated sealed tag → 22023 requiring a new preview with NO failed row outcome, missing sealed defaults rejected; §7e governed ledger — late failed-markers return the authoritative terminal outcome, recorder rejects terminal outcomes, failed→terminal retries with attempts, provenance-with-missing-ledger repair + truthful re-finalisation, name-only collision → bounded conflict with zero merge in preview AND apply, completed finalisation full-shape idempotency; §7f structural tenant binding — cross-tenant import/conflict/person references violate composite FKs, delete/truncate revoked; §3/§4 additions — hostile-grant viewer denied at tag create/assign/remove/admin, tag_mutate/tag_admin exact per-op shapes): settings strictness (explicit nulls, string-"true" booleans, quiet_hours key allowlist + fractional rejection, no-op rejection, IANA timezone, markup footer, unknown stage/keys, non-admin actor) + bound history (composite-FK cross-tenant rejection, duplicate-version rejection, update raise + no client delete privilege) + MK409; lifecycle (per-op arg allowlists, immutable keys, untouched template, ATOMIC dual-representation default via BOTH paths + no-drift assertions, set_default/reorder concurrency evidence + no-op rejection, retire_preview active-vs-historical honesty, ACTIVE-ONLY retirement with version transitions + per-relationship lifecycle events + durable remap evidence + preserved historical rows); access (restricted + hostile-raw-grant inertness, VIEWER CEILING at resolver/grant-RPC/mutation-RPCs, idempotent no-ops without duplicate audits, MK423 lockout, denied-manager rejection, cross-tenant rejection); tags (governance no-ops, duplicate-safe unambiguous bulk counts, preflight→apply CONTRACT enforcement incl. mismatch, bulk_ref + actor/source on assignments, inactive-tag safety, 1-200 bounds); segment AST (depth-5 rejection BEFORE descent, 111-node tree rejected DURING traversal, ad-hoc path same limits, unknown keys at every level, mixed shapes, strict scalars, reversed ranges, duplicate tags, vocabularies, explicit Preview errors); segment lifecycle (immutable versions, update no-ops, archive/reactivate updated_at tokens + no-ops, VERSION-CAPTURED evaluation + stale expected_version leaving stored count untouched, strict cursors + next_cursor paging); imports (structural row-RPC validation: foreign import P0002, unsealed options, out-of-range rows, unknown keys/types; sealed-contract + foreign-sealed-tag rejection; EVIDENCE CONVERGENCE: email→A+phone→B conflict with correctly-labelled evidence and zero mutation, external→A+email→B conflict, ambiguous+unique conflict, invalid-endpoint evidence → safe new Person, secondary-identifier match, honest invalid lifecycle/type rows in preview AND apply, safe company resolution incl. ambiguity + no orphans, verified-field protection, per-row idempotency, durable outcomes for every row); state machine (failed→retryable, retry of ONLY the failed row with attempt tracking, cumulative totals preserved across retries, completed idempotency, no-seal rejection); audit (equal-timestamp full-walk pagination with zero skips/dups, typed-cursor validation, PII-safe detail projection probe); service-role-only boundaries incl. the new RPCs | **PASS** (local dev DB + fresh clean-chain DB + upgraded DB)                                                                                                                                                                                                                                        |
| `scripts/marketing-admin.test.mjs` — real GoTrue JWTs over PostgREST: 11 RPC denials; settings + history + MK409; **CONCURRENT last-manager self-denial race (exactly one succeeds, one MK423/MK409, ≥1 manager remains)**; viewer ceiling with hostile raw grants (resolver inert + table write denied + RPC execute denied + grant-RPC refusal + tag CREATE/ASSIGN denied through the service-role path); segment version-capture race (stale expected_version → MK409, stored count untouched); contract-bound duplicate-safe bulk tagging; **PARALLEL same-row import applies → exactly ONE Person**; **CONCURRENT apply + failed-marker → the row ends TERMINAL, never downgraded**; **CONCURRENT different rows sharing one source+external id → exactly ONE canonical Person (other namespaces independent)**; **CONCURRENT finalisations → one consistent durable total, and a COMPLETED import finalised concurrently returns identical FULL totals to both callers**; pass-3 single-contact tag lifecycle over the service-role path (deactivate → assign 22023, history survives, remove-while-inactive, reactivate → assignable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS** (55/55)                                                                                                                                                                                                                                                                                    |
| Phase 1+2 regressions: `marketing_foundation` + `marketing_hardening` + `marketing_contacts` SQL suites · contacts mjs 42/42 · access mjs 25/25 · unit `node --test` 52/52 (openfolk 23 + segment-builder round-trip/shape 10 + marketing gate 6 + NEW pure import proofs 13: deterministic profile choice incl. foreign/wrong-entity/wrong-source/inactive/ambiguous rejection + masking policy with verbatim-PII denial) · product-alignment · lint on changed files (clean; `capability-registry.ts` deliberately keeps its documented pre-existing non-prettier formatting — this pass REVERTED the accidental 500-line auto-format rewrite) · `tsc --noEmit` clean repo-wide · production build (npm, Vercel parity) · `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PASS** (pass-3 re-runs: 3 regression SQL suites, contacts + access mjs ALL PASS, import-pure 13/13, segment-builder + gate 16/16, `tsc --noEmit` clean, npm production build, `git diff --check` clean; openfolk/product-alignment/lint were pass-2 results not re-run in the narrow pass 3)      |
| Clean full chain — 83 migrations (82 tracked + corrected Phase 3; the concurrent untracked `20260830120000` phone-ops migration is EXCLUDED from this claim) applied to a fresh disposable container, then all 4 marketing SQL suites + `control_plane` + `automation_engine` regressions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS** (re-proven on the pass-3 migration file)                                                                                                                                                                                                                                                   |
| Upgrade path from committed HEAD `24b4497` — tracked chain + seeded person/contact-point/relationship → corrected Phase 3 applies run-once; seeded data preserved; table delta exactly +3 (`marketing_settings_history`, `marketing_segment_versions`, `marketing_import_row_results`); default-stage invariant holds with NO drift; all 4 marketing suites pass on the upgraded DB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PASS** (re-proven after pass 3)                                                                                                                                                                                                                                                                   |
| Authenticated Edge HTTP — `marketing-admin-http` now also encodes: malformed-JSON 400s, unknown-key 400s, settings no-op 400, audit next_cursor paging, DISABLED→role-aware not_enabled + owner re-enable path, segment version-race 409 + archive token 400, bulk preflight CONTRACT flow, and the **EXACT DEFAULT UI-SHAPED import** (no profile_id, source_system='generic', contact_options.source='csv_upload' → resolved+persisted profile id, sealed contract, successful canonical apply, mapping-override re-preview, row_results download); plus the pre-existing `data-import.test.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **NOT RUN** — no local edge runtime exists and none may be installed; `marketing-admin-http` exits 3 (re-verified after pass 3: endpoint 503, NOT-RUN, exit 3); `data-import.test.mjs` fails against the absent runtime exactly as before this phase. Blocker: deploy or `supabase functions serve` |
| Populated responsive visual QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Preview** — the access gate fail-closes before data loads without a served runtime; fail-closed states verified; to complete on staging                                                                                                                                                           |
| Capability registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `marketing.settings` / `marketing.segments` / `marketing.tags` added, `marketing.contacts` / `marketing.imports` updated (correction-pass wording) — ALL **Preview** until the authenticated HTTP + populated visual proofs pass. Nothing delivery-related is marked Live                           |

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
   - connection state; sender source FK set-null) — tenants with no sender
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

| Check                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                    | **PASS** (clean)                                                          |
| Pure suite `node --test scripts/marketing-senders-pure.test.mjs` (now 24 tests: +3 RFC 2047 long-value, +1 fail-closed source scan, +3 mocked adapter-boundary)                                                                                                                                                                                                       | **PASS** 24/24                                                            |
| SQL suite `supabase/tests/marketing_senders.test.sql` (insert/event adversarials, catalog FK shapes, trigger-driven degradation battery with zero manual sync calls)                                                                                                                                                                                                  | **PASS** on the dev DB, the fresh clean chain AND the upgraded 6e64b0b DB |
| PostgREST suite `scripts/marketing-senders.test.mjs` (+5 trigger-driven capability checks over the real boundary)                                                                                                                                                                                                                                                     | **PASS** ×2 (36 checks, re-run-safe)                                      |
| HTTP suite `scripts/marketing-senders-http.test.mjs`                                                                                                                                                                                                                                                                                                                  | **NOT RUN — exit 3** (no local Edge runtime; honestly reported)           |
| Engine regressions: `automation_engine` / `execution_reliability` / `email_reliability` / `response_approval_atomicity`                                                                                                                                                                                                                                               | **PASS** on the clean chain AND the dev DB                                |
| Marketing Phase 0–3 regressions: `marketing_foundation` / `marketing_hardening` / `marketing_admin` / `marketing_contacts` SQL + `marketing-access` / `marketing-contacts` / `marketing-admin` mjs                                                                                                                                                                    | **PASS** (SQL on both DBs; mjs ALL PASS)                                  |
| `bash scripts/intelligence-conformance.sh`                                                                                                                                                                                                                                                                                                                            | **PASS**                                                                  |
| `npx tsc --noEmit` · focused lint (changed files) · production build (npm)                                                                                                                                                                                                                                                                                            | **PASS**                                                                  |
| Fresh clean chain — 84 migrations (committed track + corrected Phase 4; untracked phone-ops excluded) on a fresh `supabase/postgres` container (stubbed `storage.buckets` + auth columns the services normally provide)                                                                                                                                               | **PASS**                                                                  |
| Upgrade from committed HEAD `6e64b0b` — 83 committed migrations + seeded marketing/email/workspace/intent/message data → corrected Phase 4 applied ONCE (second apply fails loudly); +3 tables; ZERO enablement; pre-existing email rows keep null origin; token tenant FK added (data consistent); sync triggers installed; full SQL suite passes on the upgraded DB | **PASS**                                                                  |
| Targeted scans: no fabricated approval · no mutable sender content in MIME · guard is BEFORE INSERT OR UPDATE · event attempt FK binds tenant+intent · no substring scope check remains · auth_state must be exactly 'ok' · zero manual sync calls in the degradation battery · no stale positive `send_marketing_email` reference                                    | **PASS** (8/8)                                                            |

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

| Check                                                                                                                                                                                                                                                                    | Result                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `git diff --check` · `npx tsc --noEmit` · focused lint · production build (npm)                                                                                                                                                                                          | **PASS**                  |
| SQL suite on the dev DB, the fresh clean chain (84 migrations) and the upgraded-from-`6e64b0b` DB                                                                                                                                                                        | **PASS** (all assertions) |
| Upgrade proof incl. DIRTY-data path: mismatched legacy token → migration FAILS loudly (nothing applied under `--single-transaction`); documented repair → success + validated FK                                                                                         | **PASS**                  |
| PostgREST suite ×2 (re-run-safe) · pure suite 24/24                                                                                                                                                                                                                      | **PASS**                  |
| Engine + email reliability (+ execution reliability, approval atomicity) regressions; Marketing 0–3 SQL + mjs regressions; intelligence conformance                                                                                                                      | **PASS**                  |
| Targeted scans: no warning-only FK path (`raise warning` absent); constraint never NOT VALID; every delivery content field compared in the insert guard; fingerprint recomputed via the single canonical function (definition + 2 call sites); unrelated files untouched | **PASS**                  |

### Visual-QA findings — both PROVEN, FIXED, regression-locked

| #      | Severity                                | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Fix                                                                                                                                                                      | Lock                                                         |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| F-VQA1 | High (functional; latent since Phase 8) | `marketing-access` returned the caller's `role` ONLY on denied verdicts, so `access?.role` was undefined for every authorised user → the owner/admin affordance mirror (Phase-8 F10) NEVER rendered: the entire Ads + Connections management surface (New source / New connection / connect / credential / sync / revoke) was invisible to genuine owners in the real UI. Server security unaffected (every gate re-enforced server-side). Found the moment populated visual QA first ran | the allowed verdict now carries the caller's OWN role (self-information; the deny path always had it) — `marketing-access/index.ts` + the `MarketingAccess` type comment | served-HTTP suite asserts the allowed verdict carries `role` |
| F-VQA2 | Low (visual)                            | Phase-8 provider-tile "Not connected" badges overflowed their cards at tablet width (768px) — no wrap, clipped text                                                                                                                                                                                                                                                                                                                                                                       | `flex-wrap` + `shrink-0 whitespace-nowrap` on the badge row in `MarketingAds.tsx`                                                                                        | verified visually at 768/375 after HMR                       |

Also corrected in passing: the credential_set response note was stale for the
env-gated test provider ("nothing can use it yet") — it is now adapter-aware
and stays byte-honest for real providers.

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

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Status                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_senders.test.sql` — 10 sections incl. §13b adversarials: sources (per-mailbox connections), create (write-time header validation, hostile grant, dup idempotency), structure (creator/updater/actor/recipient/person/attempt/origin composite FKs; same-intent attempt binding; re-point/move rejection), registration honesty (test-only intent, requires_approval FALSE, no bulk intent, zero enablement), LIVE readiness (multi-connection truth, enable gate, capability+health degradation on scope/auth/status/token loss), test send (delegated authority — NO approvals row; fingerprint convergence + MK412 with zero writes; MK429; strict status contract), E2E via REAL engine RPCs (frozen envelope survives sender edits; fabrication adversarials — executing-intent, in-flight attempt, mismatched provider id, missing id — all rejected; legitimate reconcile submits; interactions.sync job enqueued once; ingestion convergence; simulated projector one-Interaction proof; failed/unknown → no email row/no job; unknown frozen + appended resolution + review task), cross-tenant lineage, observability, cascade, service-role-only | **PASS** (dev DB + clean-chain + upgraded DB)                                                                                                               |
| `scripts/marketing-senders-pure.test.mjs` — 17 node tests: exact envelope allowlist (incl. bcc/html/recipient_emails/sneaky + missing/wrong-type), actor authority (denied/removed/moved/valid), display-name quoting (quotes/commas/angles/backslash/Unicode), 76-char base64 wrapping + long body, deterministic Message-ID + frozen reply-to/signature, injection vectors, sanitized responses, conservative classification (5xx = unknown), FROZEN guard × delegated-test package (trusted allows with NO approval; assisted/discovery withhold; BROADCAST boundary distinct — approval still required incl. wrong-kind + type-gate; capability/connector/contract/supersession/unknown/prior-success/cross-tenant), adapter source-scan (env-only MIME, resolver + readiness rechecks, one fetch, no getStatus)                                                                                                                                                                                                                                                                                                                                                                 | **PASS** (17/17)                                                                                                                                            |
| `scripts/marketing-senders.test.mjs` — PostgREST + real GoTrue JWTs: 12 RPC denials + table write denied; lifecycle + readiness-gated capability; parallel same-request convergence; NO fabricated approval; MK412 mismatch; strict status at the DB boundary; stubbed claim→finalize→reconcile with ONE canonical email row; disable clears default; history survives; random-id fixtures with honest append-only residue note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS** (31/31, re-run-safe)                                                                                                                               |
| `bash scripts/intelligence-conformance.sh` (incl. strengthened gate j)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS**                                                                                                                                                    |
| Marketing regressions (4 SQL suites) + admin 55/55 + access/contacts mjs + `automation_engine` / `execution_reliability` / `email_reliability` / `response_approval_atomicity` + import-pure 13 + builder/gate 16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **PASS** (`reliability_vertical.test.sql` NOT RUN — pgTAP absent locally, pre-existing)                                                                     |
| `npx tsc --noEmit` · focused lint · production build (npm) · `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS**                                                                                                                                                    |
| Clean full chain — 84 migrations (83 committed-track + corrected Phase 4; untracked phone-ops EXCLUDED) + suites on a fresh container                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **PASS** (corrected migration)                                                                                                                              |
| Upgrade from committed HEAD `6e64b0b` — seeded marketing/email/workspace/interaction/intent data survives; run-once; +3 tables; ZERO enablement; origin columns null for pre-existing rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS** (corrected migration)                                                                                                                              |
| Authenticated Edge HTTP (`marketing-senders-http` + REQUEST_MISMATCH / no-approval / strict-limit additions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **NOT RUN** — no local edge runtime; exits 3 (verified)                                                                                                     |
| Populated visual QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Preview** — fail-closed gate without a served runtime; to complete on staging                                                                             |
| REAL provider send                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **NEVER EXECUTED** — stubbed results only; live proof requires deploy + re-consent/DWD scope + permitting mode + an explicit user-authorised recipient/send |

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

## 14 · Phase 5 — Broadcasts end to end (2026-07-29/30; BUILT + locally proven + independently audited, COMMITTED as `48674be`)

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

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_broadcasts.test.sql` — 13 sections: authority ceilings (hostile grant inert, explicit deny wins), lifecycle machine + fabrication battery + append-only chains, audience truth (9-candidate breakdown exact; counts = immutable rows; refresh = new snapshot; guardrail MK413; segment-drift MK409; base-URL MK428), launch (challenge digest, actor binding, stale-confirmation MK409, DST MK414/MK415+fold, replay convergence, MK412, empty-audience refusal, excluded-member dispatch impossible), worker (SKIP LOCKED lease, wrong-worker MK423, digest-verified token, forged-token refusal, full engine lineage incl. genuine tenant_senior approval + pinned hash, frozen content survives sender/person edits, submitted projection + structural campaign/person provenance + ingestion convergence + completion), suppression races (pre-dispatch skip with ZERO engine rows; endpoint-change + unsubscribe blocks pre-provider; policy refusal projects SKIPPED not failed, no email row), pause/resume/cancel (claims stop; only pending intents cancel via the legal engine transition; resume creates nothing), unknown freeze (blocks completion; never re-dispatched; appended resolution submits), unsubscribe (idempotent, non-enumerating, digest-only, immediate effect), reporting (facts only; clicked/delivered null; stable pagination), cross-tenant + RLS + service-role-only, tenant cascade WITH append-only guards | **PASS** (dev DB)                                                                                   |
| `scripts/marketing-broadcasts-pure.test.mjs` — 18 tests: personalisation (allowlist, malformed braces, fallbacks, control-strip, injection-inert), rendering (deterministic dual derivation, escaping, hostile labels, footer in both bodies), multipart MIME (alternative parts byte-exact, one-click headers, folded/bounded, injection), discriminated envelopes (exact allowlists both ways), frozen guard × approval model (no approval → APPROVAL_REQUIRED; tenant_senior satisfies; wrong kind/expired never), mocked adapter boundary (policy skip pre-provider with ZERO calls; authority read error → transient; paused blocks; approver de-authorised blocks; healthy path = ONE multipart call; 429 transient; 5xx frozen unknown)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **PASS** 18/18                                                                                      |
| `scripts/marketing-broadcasts.test.mjs` — PostgREST + real GoTrue JWTs: 11 RPC denials + 2 table-write denials; ops-cannot-approve at the direct RPC; PARALLEL identical launches converge (one launch, 2 dispatches, no dupes) + MK412; PARALLEL workers claim DISJOINT recipients; bundle→lineage→engine→reconcile with tenant_senior approval naming the real owner + ONE canonical email with campaign/person provenance; completion honest while work remains; report clicked=null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **PASS** ×2 (re-run-safe)                                                                           |
| Phase 0–4 regressions (marketing_foundation/hardening/admin/contacts/senders SQL + senders-pure 24 + senders mjs + access/contacts/admin mjs)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PASS**                                                                                            |
| Engine regressions (automation_engine / execution_reliability / email_reliability / response_approval_atomicity)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **PASS**                                                                                            |
| `bash scripts/intelligence-conformance.sh` (gate (j) narrowly EVOLVED: exactly the two registered marketing intents; broadcast registered approval-required; genuine tenant-senior lineage + pre-provider authority recheck required; every internal-adapter ban unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS**                                                                                            |
| `npx tsc --noEmit` · focused lint · production build (npm) · `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS**                                                                                            |
| Fresh clean chain (85 migrations, phone-ops excluded) + suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **PASS**                                                                                            |
| Upgrade from committed HEAD `c739a39` with seeded campaign/segment/sender/preference/suppression/email/interaction data → run-once, +8 tables, data survives, Phase-4+5 suites pass on the upgraded DB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **PASS**                                                                                            |
| Authenticated Edge HTTP (`marketing-broadcasts-http`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **NOT RUN — exit 3** (no local Edge runtime; honestly staged)                                       |
| Populated visual QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **NOT RUN / Preview** — the access gate requires a served authenticated runtime; nothing is claimed |
| REAL broadcast/provider send                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **NEVER EXECUTED** — stubbed engine results only; NO email of any kind was sent                     |

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

## 14e · Phase 5 — independent adversarial audit pass (2026-07-30; nine confirmed defects fixed, COMMITTED as `48674be`)

An independent audit re-verified the §14 claims against the running code
rather than the build report. **Nine defects were confirmed by executable
probes before any edit** and corrected in the SAME uncommitted draft; those
probes became regression locks (SQL §14a–§14g, two pure renderer tests, three
PostgREST checks). Everything else in §14 was re-proven, not restated.

| #   | Confirmed defect (probe evidence)                                                                                                                                                                                                                                                                                                                                         | Severity                            | Correction                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Pre-Phase-5 campaigns were a governed dead end.** A skeleton `marketing_campaigns` row has no event history; `revise` succeeded but EVERY later transition failed the event-chain guard (`P0001 the first campaign event must be the initial null -> draft record`), so it could never be reviewed, approved or launched — contradicting the documented bootstrap route | High (launch-readiness)             | `marketing_campaign_seed_event_chain()` records EXACTLY the initial `null → draft` fact for a chain-less draft, called by `revise` and `transition`; a chain-less non-draft row gets a stable 22023 instead of a raw trigger error. Proven end to end on a genuinely UPGRADED database      |
| 2   | **Resuming a paused scheduled campaign sent 7 days early.** `resume` forced `active` and materialised dispatches immediately, so pause+resume was an early launch of an unreached schedule                                                                                                                                                                                | High (irreversible external effect) | `paused → scheduled` added to the legal machine; `resume` returns an unreached schedule to `scheduled` (schedule evidence preserved, zero dispatches) and only activates when the instant has arrived or the campaign was already active. The scheduler still fires at the original time    |
| 3   | **Recipient data could inject live links into approved mail.** The renderer substituted personalisation FIRST and then scanned the RESULT for `[label](url)`, so a contact whose stored name contained markdown link syntax became a real `<a href>` in the HTML part — a phishing destination the approver never saw                                                     | High (content trust / security)     | Links are extracted from the APPROVED body first; personalisation is substituted into the runs and labels afterwards and never re-scanned. Hostile values survive as inert escaped text; the anchor set equals the approved set                                                             |
| 4   | **Sub-hour DST folds were silently resolved.** The ±1-hour probe cannot see Lord Howe's 30-minute fold: `2026-04-05 01:45` occurs twice and one of the two instants was picked without asking                                                                                                                                                                             | Medium (schedule truth)             | The fold probe now covers the real candidate offsets (15/20/30/45/60/90/120 min), nearest first. The 1-hour London fold (MK415) and the spring-forward gap (MK414) behave exactly as before                                                                                                 |
| 5   | **`revise` accepted an unvalidated campaign identity** — a 5000-character control-character name was written where `create` bounds it to 120 clean chars                                                                                                                                                                                                                  | Medium (input integrity)            | `revise` validates name/description with the same bounds as `create`; a rejected revision changes nothing                                                                                                                                                                                   |
| 6   | **Out-of-sequence transitions leaked raw trigger exceptions.** `submit_review` on an approved campaign, `pause` on a draft and `archive` on an active campaign reached the guard as `P0001`, which the Edge maps to `INTERNAL` 500                                                                                                                                        | Medium (API contract)               | Every action states its legal precondition in the RPC, so these are stable `22023 → INVALID_REQUEST 400`                                                                                                                                                                                    |
| 7   | **A lost execution enqueue stranded a recipient forever.** A crash after the lineage transaction committed but before `enqueueAutomationExecution` leaves a `queued` dispatch with a `pending` intent; claims only take pending/lease-expired work, the reconciler's ttl runs out, and the campaign can never reach a truthful terminal state                             | Medium (reliability)                | Bounded recovery sweep in the dispatch worker re-enqueues such intents (idempotent at the job key AND the engine claim RPC); the scheduler tenant scan now covers `pending` **and** `queued`                                                                                                |
| 8   | **A new helper shipped client-reachable.** `marketing_campaign_seed_event_chain` (added by this pass) defaulted to `PUBLIC EXECUTE` because the grants block is a hand-kept list                                                                                                                                                                                          | High (authority boundary)           | Added to the revoke/grant list, and the SQL suite now enumerates Phase-5 functions **from the catalog**, so any future helper missing its revoke fails loudly. Negative control: granting it to `authenticated` makes the suite fail with that exact message                                |
| 9   | **Preflight was quadratic at the documented ceiling.** `jsonb_set` accumulation copied the whole accumulator per candidate: measured 0.22s at 500, 3.0s at 2000, **66s at the 10000 ceiling** — one transaction holding the campaign row lock, beyond ordinary gateway timeouts                                                                                           | Medium (launch-readiness)           | Rewritten set-based (one ordered pass; counts, breakdown, samples and member rows all derive from the same frozen rows). Measured after: **0.043s at 500, 0.82s at 10000**. Ordering, hash coverage, the exact 9-candidate exclusion breakdown and immutability are unchanged and re-proven |

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

| Check                                                                                                                                                                                                                                                                                                                   | Result                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_broadcasts.test.sql` — 13 original sections + **§14a–§14g adversarial locks** (legacy adoption, scheduled pause/resume, out-of-sequence transitions, revise identity bounds, sub-hour DST fold, audience boundaries 0/1/cap/cap+1, cancellation while leased) + the catalog-driven grant lock | **PASS** on the dev DB, a fresh clean-chain DB and an upgraded-from-`c739a39` DB                                                                     |
| `scripts/marketing-broadcasts-pure.test.mjs` — 18 original + **2 new renderer locks** (recipient data can never introduce a link; hostile values cannot break the HTML structure or the unsubscribe link)                                                                                                               | **PASS 20/20**                                                                                                                                       |
| `scripts/marketing-broadcasts.test.mjs` — the original RPC/concurrency proof + **the REAL SQL-built envelope validated against the adapter's exact allowlist** (drift lock), **concurrent unsubscribe convergence**, **the orphan-intent recovery contract**                                                            | **PASS**, 4 consecutive runs (re-run safe)                                                                                                           |
| Phase 0–4 regressions (`marketing_foundation/hardening/admin/contacts/senders` SQL; access/contacts/admin/senders mjs; senders-pure 24/24)                                                                                                                                                                              | **PASS**                                                                                                                                             |
| Engine regressions (`automation_engine`, `execution_reliability`, `email_reliability`, `response_approval_atomicity`)                                                                                                                                                                                                   | **PASS** on dev + clean chain                                                                                                                        |
| `bash scripts/intelligence-conformance.sh`                                                                                                                                                                                                                                                                              | **PASS** (gate (j) unchanged by this pass)                                                                                                           |
| Clean full chain (85 migrations, phone-ops excluded) from FINAL bytes + all suites                                                                                                                                                                                                                                      | **PASS**                                                                                                                                             |
| Upgrade from the committed Phase-4 head with seeded campaign/segment/sender/preference/suppression/email/interaction data                                                                                                                                                                                               | **PASS** — exactly +8 tables (175→183), every seeded row preserved, and the legacy skeleton adopted into the governed lifecycle through to preflight |
| Run-once discipline (second application of the migration)                                                                                                                                                                                                                                                               | **PASS** — fails loudly (`relation "marketing_campaign_revisions" already exists`)                                                                   |
| `npx tsc --noEmit` · focused ESLint on every changed TS/TSX file · `npm run build` · `git diff --check`                                                                                                                                                                                                                 | **PASS**                                                                                                                                             |
| Authenticated Edge HTTP (`marketing-broadcasts-http`)                                                                                                                                                                                                                                                                   | **NOT RUN — exit 3** (no local Edge runtime; unchanged)                                                                                              |
| Populated visual QA                                                                                                                                                                                                                                                                                                     | **NOT RUN** — static inspection + production build only; no served authenticated runtime exists                                                      |
| REAL provider send                                                                                                                                                                                                                                                                                                      | **NEVER EXECUTED** — no email of any kind was sent                                                                                                   |

## 15 · Phase 6 — Governed Sequences & scheduler (2026-07-30; COMMITTED as `60cc18f` — built, locally proven, INDEPENDENTLY AUDITED TWICE with nine corrections; not pushed/deployed)

One campaign identity, one delivery transport, one authority. Everything below
is ADDITIVE around the existing seams: `marketing_campaigns` stays the only
campaign identity (a sequence is `campaign_type = 'sequence'`, a vocabulary
the Phase-1 foundation already allowed); eligibility stays
`marketing_endpoint_eligibility`; work dispatch stays `platform_jobs`; every
side effect goes through the FROZEN Automation Engine. No second workflow
engine, queue, scheduler framework, Person model, campaign identity, activity
feed, permission resolver or provider transport was created.

### Repository audit that preceded the design

`campaign_type in ('broadcast','sequence')` already existed; the Phase-5
campaign guard, revisions/approvals/events/confirmations, segments and
audience-snapshot patterns, `marketing_endpoint_eligibility`,
`marketing_tag_mutate`, `marketing_classify_contact`, `marketing_validate_owner`,
the ONE Gmail adapter with its pre-provider authority, the engine capability/
contract/adapter registry, `platform_jobs` + the worker registry + leases +
continuations, `serviceos_schedule_defs()`/`serviceos_schedule_all()`,
secret-gated scheduled functions, `marketing_event_append`, the health
patterns and `marketing_effective_permissions` were all mapped and REUSED. The
canonical work spine for a follow-up was confirmed to be
`intelligence_objects` (`object_class = 'action'`) — what `work-projection`
reads — with NO generic governed creation path, so Phase 6 added one rather
than a Marketing-only task table.

### Schema (migration `20260903120000_marketing_sequences.sql`)

- IMMUTABLE `marketing_sequence_revisions` (sender, IANA timezone, quiet
  hours, entry/re-enrolment policy, validated exit rules, policy-block action,
  step count, bundle hash over the WHOLE journey) + IMMUTABLE
  `marketing_sequence_steps` (stable key, order, type, validated config,
  config hash, human summary). No executable code, no unvalidated templates.
- APPEND-ONLY `marketing_sequence_approvals` binding campaign version,
  revision, bundle hash, sender and the owner/admin approver.
- IMMUTABLE `marketing_enrolment_batches` + `marketing_enrolment_candidates`:
  every candidate recorded once, enrolled or excluded with exact reasons
  (`unknown_preference`, `unsubscribed`, `hard_suppression`,
  `no_contact_point`, `invalid_destination`, `duplicate_shared_destination`,
  `missing_personalisation`, `already_enrolled`, `reenrolment_not_permitted`).
- `marketing_sequence_enrolments`: PERSON-based, revision-PINNED,
  endpoint-PINNED, with current step, next-eligible instant, generation,
  deterministic dedup key and append-only exit facts.
- `marketing_sequence_executions`: append-only per (enrolment, revision, step,
  generation) — a UNIQUE INDEX makes "at most one active logical execution"
  structural, and the persisted `scheduled_for` is immutable so a retry can
  never make a wait drift.
- ONE-USE `marketing_sequence_confirmations` (digest only, actor-, revision-
  and batch-bound, 15-minute expiry, superseded by any relevant change). No
  client select policy exists at all.
- `marketing_deliveries` gains sequence provenance and the `sequence` purpose;
  the Phase-4/5 delivery guard and reconciler are REPLACED by supersets — every
  earlier invariant preserved verbatim and re-proven by the unchanged suites.
- The campaign guard is likewise a SUPERSET: broadcast rules unchanged, with
  factual anchoring added for sequence approval, activation, closure and
  completion. `paused → draft` is added FOR SEQUENCES ONLY (editing a paused
  sequence).

### Automation registration

- `send_marketing_sequence_email` on the EXISTING `email.send_marketing`
  capability — external, high risk, `supports_status_lookup` FALSE,
  **requires_approval TRUE**, with a real append-only `automation_approvals`
  row (`approver_kind = tenant_senior`) naming the GENUINE owner/admin who
  approved the immutable revision. Its own pre-provider authority is
  `marketing_sequence_send_authority`.
- NEW INTERNAL capability `marketing.contact_action`
  (`external_side_effect = false`, risk medium) with five intent types:
  `marketing_apply_tag`, `marketing_remove_tag`, `marketing_change_lifecycle`,
  `marketing_assign_owner`, `marketing_create_follow_up`. `requires_approval`
  is FALSE **honestly** — these are internal tenant-data changes authorised by
  the owner/admin approval recorded on the revision; no approval row exists or
  is fabricated, and the Decision Package records `AUTOMATION_AUTHORISED` with
  delegated authority rather than a fake review requirement.
- The `marketing_actions` adapter makes NO network call and writes NO table
  directly: tag/lifecycle/owner go through `marketing_tag_mutate` and
  `marketing_classify_contact`; the follow-up goes through
  `marketing_sequence_create_follow_up`, which creates the canonical work item
  AND seeds `object_state_history` in one transaction, idempotently on the
  execution id.

### Race closure (three checks, one authority)

1. Enrolment preflight — canonical eligibility per candidate.
2. `marketing_sequence_step_bundle` / `…_create_email_lineage` — the SAME
   `marketing_sequence_authority_core` BEFORE any intent exists; a refusal
   skips with the exact policy code and creates ZERO engine rows, then either
   exits the enrolment or steps over it per the APPROVED policy.
3. The adapter calls `marketing_sequence_send_authority` IMMEDIATELY before
   its single Gmail call. There is NO override.

### Scheduler, worker and recovery

`marketing-sequence-scheduled-sync` (secret-gated, `MARKETING_SEQUENCE_SECRET`)
only DISCOVERS due tenants and enqueues `platform_jobs`. The registered
`marketing.sequence_advance` handler claims ≤10 due steps (SKIP LOCKED, lease
recovery), resolves WAIT steps in SQL from the factual arrival time, defers
email steps in quiet hours, renders through the SAME pure renderer as
Broadcasts (including its link-injection protection), creates lineage
transactionally, enqueues engine execution, reconciles internal actions, runs
the same orphaned-intent recovery sweep as Phase 5, and continues only while
claimable work remains. Adding the schedule definition installs NOTHING — an
operator must run `serviceos_schedule_all()`.

### Editing, pausing and completion truth

An ACTIVE sequence refuses an in-place edit: pause first. Revising then creates
a NEW immutable revision and returns the sequence to draft. **Live enrolments
stay pinned to the revision they entered on and are never migrated** — proven,
and the pin is immutable for every caller. Completion is three distinct states:
open/active (accepting enrolment) → closed (an explicit operator act) →
completed (derived only once closed AND nothing is live).

### Exits — evidence only

Unsubscribe and hard suppression always stop future sends (not configurable).
A reply exits only from a canonical INBOUND `email_messages` row on the
PROVIDER THREAD this sequence actually sent — never subject text, and an
unrelated inbound email is proven not to exit. Lifecycle exits require the
Person's CURRENT active relationship to have reached the configured stage.
**Hard bounces are never inferred**: this pipeline receives no provider bounce
evidence, so bounce exits stay unproven rather than invented.

### Edge/API surface

`marketing-sequences` (requireTenantUser + canonical resolver double gate;
exact per-action key allowlists): list/detail/enrolment_list (marketing.view) ·
create/revise/validate (operational role + campaigns.draft) ·
approve/request_changes/preflight_activation/activate/preflight_enrolment/
confirm_enrolment/pause/resume/cancel/close/archive/enrolment_* (owner/admin +
campaigns.launch) · report (reporting.view) · health. Stable errors:
VERSION_CONFLICT / REQUEST_MISMATCH / GUARDRAIL / CONFIRMATION_EXPIRED /
CONFIG_REQUIRED / LOCKOUT / FORBIDDEN / NOT_FOUND / INVALID_REQUEST. No raw
database messages, tokens, digests, credentials or unbounded enrolment lists in
any response. `config.toml` gained ONLY the two Phase-6 entries (the phone-ops
hunk is untouched).

### UI

`MarketingSequences` replaces the Sequences Preview card, keeping the exact
internal order (Broadcasts · Sequences · Templates · Objectives & Reporting ·
AI Drafting). Broadcasts stays operational; Sequences becomes operational;
Templates, Objectives & Reporting and AI Drafting remain honestly Preview.
List (status, sender, revision, enrolment counts, next due, held count),
guided builder (ordered steps with move-up/down — no new drag-and-drop
dependency — per-type configuration, personalisation guidance and explicit
fallbacks, exit-rule configuration, a read-only step validator), enrolment
preflight with exact exclusion reasons and MASKED samples, an explicit
activation dialog stating every consequence (real email, immutable revision,
pinning, suppression rechecks, no recall after provider acceptance), detail
timeline, bounded enrolment drill-down with pause/resume/remove, and factual
reporting where delivered/opened/clicked/bounced read **Unavailable**, never
zero. Dialogs have `role="dialog"`, `aria-modal`, labelled titles, initial
focus, a Tab trap and Escape.

### Verification matrix (2026-07-30, local)

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Result                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_sequences.test.sql` — 14 sections: authority ceilings (viewer/ops denied, hostile grant inert, explicit deny wins, cross-tenant actor rejected), step-config validation (unknown token, undeclared key, cross-tenant tag, wait-first refusal), lifecycle + fabrication battery, immutable revisions/steps/approvals, one-use digest-only activation (wrong challenge, wrong actor, replay convergence, MK412), enrolment batch truth (4 candidates → 1 eligible with exact reasons; counts = rows; guardrail MK413 persists nothing; already_enrolled), worker leases + wrong-worker MK423 + full engine lineage with a GENUINE tenant_senior approval + canonical email projection + advancement-exactly-once, wait determinism + immutable persisted instant, internal action lineage (registered internal capability, NO fabricated approval, AUTOMATION_AUTHORISED), completion truth (open ≠ closed ≠ completed), suppression race closure with ZERO engine rows, reply correlation (unrelated email does NOT exit; thread evidence does; idempotent), DST (30-minute Lord Howe fold resolves by stored policy; gap moves forward deterministically; 1-hour fold intact), pause/resume/cancel, revision PINNING, cross-tenant + RLS + catalog grant boundary, reporting truth | **PASS** (dev DB, clean-chain DB, upgraded DB)                                                                                                                                                                                                                                               |
| `scripts/marketing-sequences-pure.test.mjs` — 17 tests: the exact sequence envelope allowlist (every omission fails, undeclared field refused, unsubscribe link required in BOTH bodies, Person-not-profile, header injection), three-way purpose discrimination, the contact-action envelope + intent-type coherence, and MOCKED adapter boundaries (the sequence authority is consulted — not the broadcast one — with ZERO provider calls on refusal; an authority read error is transient; the healthy path sends ONE multipart call; the internal adapter makes no network call, refuses cross-tenant, honours an email-only precondition, fails truthfully on a deactivated tag, refuses a foreign Person, converges idempotently on a follow-up retry)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **PASS 17/17**                                                                                                                                                                                                                                                                               |
| `scripts/marketing-sequences.test.mjs` — PostgREST + real GoTrue JWTs: 15 RPC denials + 3 table-write/read denials; ops-cannot-approve at the direct RPC; PARALLEL identical activations converge; PARALLEL identical enrolment confirmations create each Person EXACTLY once; PARALLEL workers claim DISJOINT steps; the REAL SQL-built envelope validates against the adapter allowlist (drift lock); full lineage → engine → canonical email projection → advancement; wait resolved in SQL; recovery + due-discovery contracts; reporting truth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **PASS**                                                                                                                                                                                                                                                                                     |
| Phase 0–5 regressions (foundation/hardening/admin/contacts/senders/broadcasts SQL; access/contacts/admin/senders/broadcasts mjs; senders-pure 24, broadcasts-pure 20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PASS**                                                                                                                                                                                                                                                                                     |
| Engine regressions (`automation_engine`, `execution_reliability`, `email_reliability`, `response_approval_atomicity`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PASS** on dev + clean chain                                                                                                                                                                                                                                                                |
| `bash scripts/intelligence-conformance.sh` (gate (j) narrowly EVOLVED: exactly the THREE registered marketing intents; the sequence intent approval-required with genuine tenant-senior lineage; its own pre-provider authority recheck; `marketing.contact_action` registered `external_side_effect=false` with an outcome contract; the internal adapter proven to make NO network call and to use ONLY the canonical governed RPCs. Every existing rule unchanged — it CAUGHT a real violation during the build, when the adapter briefly wrote tables directly)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **PASS**                                                                                                                                                                                                                                                                                     |
| Clean full chain (86 migrations, phone-ops excluded) from FINAL bytes + all suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS**                                                                                                                                                                                                                                                                                     |
| Upgrade from the committed Phase-5 head `48674be` with seeded campaign/segment/sender/preference/suppression/email/interaction data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **PASS** — exactly +8 tables (183→191), all seeded rows preserved, suites pass on the upgraded DB                                                                                                                                                                                            |
| Run-once discipline (second application)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **PASS** — fails loudly (`relation "marketing_sequence_revisions" already exists`)                                                                                                                                                                                                           |
| `npx tsc --noEmit` · focused ESLint on every changed TS/TSX file · `npm run build` · `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS**                                                                                                                                                                                                                                                                                     |
| Authenticated Edge HTTP (`marketing-sequences-http`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **NOT RUN — exit 3** (no local Edge runtime; honestly staged). The probe was hardened during this phase to detect a served runtime POSITIVELY — see the file-scope note — after it was found that an unserved gateway returning 500 was misread as "served" by the inherited exclusion check |
| Populated visual QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **NOT RUN / Preview** — no served authenticated runtime exists; build + typecheck + static inspection are NOT visual verification                                                                                                                                                            |
| REAL provider send                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **NEVER EXECUTED** — stubbed engine results only; NO email of any kind was sent                                                                                                                                                                                                              |

### Honest limitations

- No real email was sent. The adapter transport, Edge HTTP, worker runtime and
  scheduler cron only run when deployed.
- Click tracking is not implemented (clicked = null, never zero);
  delivered/opened/replied/bounced are provider-unreported and stay null.
  Replies are counted ONLY where canonical thread evidence exists.
- Hard-bounce exits are configured but can never fire until a real bounce
  evidence pipeline exists. That is stated, not simulated.
- Event-triggered enrolment is NOT installed: no second event engine and no
  hidden poller. It is Preview in the UI and reserved in the policy vocabulary.
- A `create_follow_up` step creates a genuine canonical work item that the
  Command Centre projection reads. PRE-EXISTING platform gap (not introduced
  here): the platform seeds `state_definitions`/`state_transitions` for
  `('serviceos'|'productos','Action')` but not for `('core','Action')`, so
  `work-transition` cannot yet MOVE any core Action — including those Phase 4/5
  already create. Creation and surfacing are real; the transition seed is a
  platform change outside Marketing scope.
- Quiet-hours and wait deferral are scheduler-redriven (bounded 1-minute
  polling only while a sequence has due work).
- "submitted" = Gmail accepted the request; unknown results freeze for review
  and are never blindly retried.

### External configuration required before any live sequence

1. Deploy migration 20260903120000 + `marketing-sequences` /
   `marketing-sequence-scheduled-sync` + the shared worker bundle.
2. `MARKETING_PUBLIC_BASE_URL` (an email-bearing sequence cannot activate
   without it) and `MARKETING_SEQUENCE_SECRET`, then re-run
   `serviceos_schedule_all()` — cron is never installed implicitly.
3. Gmail `gmail.send` re-consent / Workspace DWD grant (Phase-4 SENDER_SETUP).
4. An operational mode permitting irreversible external work.
5. Explicit user authorisation for the first live activation and enrolment.

### §15c · Independent hardening audit of Phase 6 (2026-07-30)

Phase 6 was re-audited against the live repository rather than against its own
build report. Six defects were CONFIRMED by executing the real code before any
fix, then corrected and locked with regression tests that were proven to fail
without the fix. The three priority areas the audit was asked to attack first
— wait/claim scheduling under clock skew, concurrent enrolment batches sharing
a Person, and an internal action whose canonical mutation succeeds but whose
later persistence fails — produced one genuine defect (the third, F1); the
first two were probed adversarially and held.

| #   | Confirmed defect                                                                                                                                                                                                                                               | Evidence before the fix                                                                                           | Correction                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | An internal action that succeeded canonically but failed to finalise would, on retry, hit `person already has an active relationship; supply relationship_id` and fail **permanently** — the mutation had already happened                                     | probe: `LIFECYCLE retry FAILS: 22023 \| person already has an active relationship`                                | the adapter now reads the Person's current active relationship first: if it is already at the target it CONVERGES (`converged: true`, no second write); otherwise it updates that exact relationship with its `expected_version`, and a genuine MK409 becomes a permanent `policy_target_changed` rather than a blind retry |
| F2  | An INTERNAL-ONLY journey was governed by EMAIL rules: a Person with no email endpoint was excluded from enrolment, and every tag/lifecycle/owner step was skipped `sender_disabled`, exiting the enrolment `policy_blocked` — on a sequence that sends nothing | probe: `TAG STEP bundle: skipped=true code=sender_disabled`, `ENROLMENT after: status=exited exit=policy_blocked` | authority split into `marketing_sequence_authority_core(..., p_require_email)`; enrolment endpoint is nullable and required **only** when the revision contains a `send_email` step; preflight is send-aware throughout                                                                                                     |
| F3  | A `create_follow_up` step created permanent work nobody could ever progress — the platform has no `('core','Action')` state machine, so `work-transition` can derive no legal move                                                                             | `state_transitions` for Action exist only for `serviceos`/`productos`                                             | gated on the REAL configuration via `marketing_sequence_follow_up_available()`; `marketing_sequence_create` refuses with MK428; the builder withholds the step and the surface says why. No Marketing-specific transition engine was added, and the gate opens by itself once the platform seeds those transitions          |
| F4  | Reply correlation accepted an inbound message that PREDATED the send it claimed to answer                                                                                                                                                                      | a day-old message on the thread exited a live enrolment                                                           | the reply must be `received_at > submitted_at`                                                                                                                                                                                                                                                                              |
| F5  | Reply correlation accepted a message from ANYONE on a reused provider thread                                                                                                                                                                                   | a third party's message exited the wrong Person's enrolment                                                       | the reply must come `from_email` = the endpoint this enrolment addressed                                                                                                                                                                                                                                                    |
| F6  | The enrolment evidence ledger guarded UPDATE but not DELETE, while the documentation called the batch immutable — a record of who was enrolled and why each Person was excluded could be erased                                                                | `delete from marketing_enrolment_candidates` succeeded                                                            | append-only DELETE triggers on `marketing_enrolment_candidates` and `marketing_enrolment_batches`, following the `marketing_delivery_events` precedent                                                                                                                                                                      |

Two findings were investigated and **dismissed with evidence** rather than
"fixed": the schema-wide `anon`/`authenticated` table grants and
`relforcerowsecurity = false` are the platform-wide Supabase pattern (721 tables;
`automation_intents` and `intelligence_objects` included), and every Phase 6
table carries exactly one SELECT-only policy scoped to `current_tenant_id()` AND
`marketing.view` — a bare authenticated session reads 0 rows and can write
nothing. An over-broad first draft of the lineage invariant also flagged
internal actions for lacking approval; the registry confirms that is correct by
design (`marketing.contact_action` is registered `external_side_effect = false`,
`requires_approval = false`), so the invariant now judges each intent by its
REGISTERED contract.

Test sections 15 and 16 were added to `supabase/tests/marketing_sequences.test.sql`:
15 locks F2/F3/F4-F5 behaviourally; 16 asserts whole-run invariants (engine
lineage by registered contract, contiguous step ordering, reporting honesty,
immutability) and each one first proves it has rows to judge, so a teardown can
never let it pass vacuously. Correcting F4/F5 also exposed that the original
reply test's fixture supplied weaker evidence than the rule now demands; that
fixture now supplies a genuine reply (right thread, after the send, from the
enrolled endpoint), which strengthens rather than relaxes it.

### §15d · Second independent hardening pass (2026-07-30)

A second adversarial pass attacked what the first covered thinly. Three further
defects were confirmed against executing code and corrected; every conclusion
below is backed by a command, not an inspection.

| #   | Confirmed defect                                                                                                                                                                                                                                                                  | Evidence before the fix                                                                             | Correction                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | The local-time resolver walked DST gaps in 15-minute steps, so it overshot the first instant that actually exists. Lord Howe Island springs **02:00 → 02:30** (a real 30-minute shift): a requested 02:29 resolved to **02:44**, fourteen minutes late                            | `2026-10-04 02:29 → lands_on 2026-10-04 02:44` while 02:00 and 02:15 both correctly landed on 02:30 | the gap walk now steps one minute, bounded at 180. Severity is bounded and stated honestly: every current caller builds `date + whole hours`, so **no live sequence could have been mis-scheduled** — the defect was latent in a granted, generally-callable resolver |
| G2  | The follow-up gate added in the first pass sat only on authoring and the UI. The generic canonical-Action RPC — the layer that actually mints work — had no gate, so any future caller could still create Actions that appear on a real person's list and can never be progressed | the RPC body contained no reference to `marketing_sequence_follow_up_available()`                   | the seam itself now refuses with MK428 and writes nothing while refusing. It opens automatically when the platform seeds `('core','Action')` transitions                                                                                                              |
| G3  | The adapter mapped that refusal to a **transient** failure, so the Automation Engine would have retried a configuration fact until it exhausted its attempts, and reported a configuration problem as flakiness                                                                   | `MK428` fell through to `transient("work_item_create_failed", …)`                                   | MK428 is classified `permanent("configuration_required", …)`, locked by a pure test proven to fail without the fix (21/22 with the fix removed)                                                                                                                       |

**Staged HTTP probe classification — corrected reasoning, not just a threshold.**
The observed local behaviour is that the API gateway answers _every_ function
path — real names and nonsense names alike — with `HTTP 500
{"message":"An unexpected error occurred"}`. A 500 therefore carries no
information: an unserved gateway and a deployed-but-throwing function are
indistinguishable. Both probes previously printed "endpoint unreachable — serve
the functions", asserting something they could not know and pointing at the
wrong problem during a real outage. The classifier is now a shared, unit-tested
module (`scripts/lib/edge-probe.mjs`, 7 tests) with three verdicts — served /
unserved / **ambiguous** — where only `served` permits a suite to claim a
result. Both the Phase 5 and Phase 6 probes consume it, so they cannot drift.

**Areas probed with no defect found**, each with executable evidence rather than
inspection: tag assign/remove retries converge with zero duplicate rows and zero
duplicate events; the 42 functions Phase 6 adds (derived by diffing `pg_proc`
across the migration, not from a list) all fall inside the catalog test's filter,
so the grant check is genuinely complete; a real upgrade leaves **no** stale
function overloads; `work-projection` and `work-transition` both pass, so the new
Action seam regresses no other consumer.

**Known environmental gap, pre-existing:** `reliability_vertical.test.sql` is a
pgTAP suite and pgTAP is not installed locally; it fails identically on a
database with no Phase 6 applied at all. Eight non-Marketing suites
(`command-centre-http`, `data-import`, `drummond-existing-connection`,
`identity-attribution`, `ownership-resolver`, `provider-oauth-state`,
`provider-onboarding-http`, `tenant-superadmin`) hard-fail locally because they
call Edge functions and lack the honest exit-3 probe pattern. None is touched by
Phase 6; adding that pattern to unrelated suites would be out of scope here.

### Phase 6 file scope — 27 paths (13 modified, 14 created)

**Modified — 13**

1. `docs/product/marketing-crm/IMPLEMENTATION_LEDGER.md` (this ledger)
2. `docs/reference/AUTOMATION_ENGINE.md`
3. `docs/reference/BACKEND_RUNTIME.md`
4. `scripts/intelligence-conformance.sh`
5. `scripts/marketing-broadcasts-http.test.mjs` — a Phase 5 test file
   DELIBERATELY evolved by Phase 6. Honesty correction found during this phase:
   the staged probe treated "not 503/404" as a served runtime, but an unserved
   local gateway answers 500, so the suite could print "a served runtime was
   detected" and exit 0 without observing anything. The second audit then
   established that a 500 is genuinely unattributable — an unserved gateway and
   a deployed-but-throwing function are indistinguishable — so both probes now
   consume the shared three-state classifier and refuse to guess.
6. `scripts/marketing-broadcasts-pure.test.mjs` — also a deliberately evolved
   Phase 5 test file: the adapter intent-type list is now exactly three. An
   accuracy update, not a weakening.
7. `src/components/app/MarketingCampaigns.tsx`
8. `src/lib/capability-registry.ts` — the Marketing Campaigns capability copy,
   corrected to describe what Sequences can actually do today
9. `supabase/config.toml` — the two Phase 6 Marketing entries ONLY; the
   unrelated Phone Operations hunk stays working-tree-only
10. `supabase/functions/_shared/connectors/index.ts`
11. `supabase/functions/_shared/connectors/marketing_email.ts`
12. `supabase/functions/_shared/marketing_email.ts`
13. `supabase/functions/_shared/worker_handlers/index.ts`

**Created — 14**

14. `docs/product/marketing-crm/SEQUENCE_SETUP.md`
15. `scripts/lib/edge-probe.mjs` — the shared served/unserved/ambiguous
    classifier, added by the second audit
16. `scripts/edge-probe.test.mjs` — 7 focused tests for it, added by the second
    audit
17. `scripts/marketing-sequences-http.test.mjs`
18. `scripts/marketing-sequences-pure.test.mjs`
19. `scripts/marketing-sequences.test.mjs`
20. `src/components/app/MarketingSequences.tsx`
21. `src/lib/marketing/sequences.ts`
22. `supabase/functions/_shared/connectors/marketing_actions.ts`
23. `supabase/functions/_shared/worker_handlers/marketing_sequence_advance.ts`
24. `supabase/functions/marketing-sequence-scheduled-sync/index.ts`
25. `supabase/functions/marketing-sequences/index.ts`
26. `supabase/migrations/20260903120000_marketing_sequences.sql`
27. `supabase/tests/marketing_sequences.test.sql`

Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
byte-for-byte outside this scope.

## 16 · Phase 7 — Templates, Objectives & Honest Reporting, Governed AI Drafting (2026-07-31; BUILT + locally proven + INDEPENDENTLY AUDITED (§16b) + production-readiness corrected (§16c) — CHECKPOINT-READY)

One campaign content and evidence layer, additive around the existing seams.
Nothing new competes with anything canonical: NO second campaign model, content
renderer, objective system, AI provenance model, workflow engine, queue,
provider transport, reporting truth or Person/Interaction model was created.

### Seam audit → reuse decisions (evidence-led)

- **One safe content model.** Template revisions, sequence-step templates and
  AI proposals all store EXACTLY the Phase-5 authored shape and every write
  passes `marketing_campaign_validate_content` (the path Phase 6 already
  proved for sequence steps). The Phase-7 content hash
  (`marketing_template_revision_hash`) is content-only — sender/segment stay
  campaign-frozen facts; a Template records no sender and no format knobs
  (`content_format = 'marketing_text_v1'` names the ONE canonical format; no
  configurable brand/format machinery was invented because none exists to
  configure). Preview renders through the ONE deterministic `renderBroadcast`
  with explicitly-labelled SAMPLE data + a placeholder unsubscribe URL.
- **Pinning, not referencing.** "Use in Broadcast/Sequence" copies the exact
  revision content through the CANONICAL authoring RPCs
  (`marketing_campaign_create/revise` and `marketing_sequence_revise` — the
  first two REPLACED with byte-preserving supersets that add ONLY the two
  optional lineage keys; `marketing_sequence_validate_step` likewise). Lineage
  means "this content IS exactly that revision": `marketing_template_lineage_check`
  / `marketing_ai_lineage_check` enforce byte-equality at the RPC layer AND at
  a BEFORE INSERT trigger on `marketing_campaign_revisions`, so a lineage lie
  is structurally impossible even for the service role. Live execution never
  reads the Template row; usage is recorded by AFTER INSERT triggers into the
  append-only `marketing_template_usages` ledger in the same transaction as
  the pin. Using a template in an approved campaign structurally invalidates
  the approval (the proven revise path: new revision + draft).
- **Objectives: the canonical model, extended additively.** The audit (agent
  evidence, `20260720120000_objectives.sql:168`) showed `objective_links` is
  the intended universal relationship but: `target_kind` is an inline CHECK
  with no `campaign` value, `target_ref` is unvalidated text, and links carry
  no history/concurrency model (the engine treats them as mutable "current"
  pointers with append-only assessments as the history). Resolution:
  - CHECK extended additively with `marketing_campaign`; a NEW guard trigger
    validates ONLY that kind (uuid shape, same-tenant campaign existence,
    relation ∈ supports|contributes_to). Other kinds keep byte-identical
    behaviour (suite-proven).
  - `marketing_campaigns.objective_link_id` (composite tenant FK) is the
    campaign's current-pointer; supersede/unlink set the old link
    `approved=false` (removing it from the engine's link-consuming queries)
    WITHOUT deleting it, and every act lands in the append-only
    `marketing_campaign_objective_history` with actor/rationale/campaign
    version. Campaign `version` is the concurrency token (MK409); linking is
    request-id idempotent through the canonical `marketing_request_keys`
    ledger (byte-identical replay converges — the ledger is consulted BEFORE
    the version gate, a defect the suite caught and this pass fixed; changed
    reuse → MK412).
  - The Phase-1 `objective_link_ref` placeholder is CLOSED by a narrow guard
    trigger: legacy/null values stay readable (upgrade-proven with a seeded
    legacy value), new writes are 22023.
  - Links FABRICATE NOTHING: suite-proven zero delta on `measurements`,
    `objective_health` and `objective_contribution_assessments` across
    link/supersede/unlink. `verification_state='approved_link'`,
    `approved=true`, `contribution_state='proposed'` — exactly the vocabulary
    the engine's assessor consumes, whose v1 boundary can only ever produce
    `expected`/`inconclusive` (its `SUPPORTED_OUTCOME_EVIDENCE_TYPES` remains
    empty; untouched).
  - Context honesty: `marketing_campaign_objective_context` reads the LATEST
    canonical health snapshot (missing = `never_evaluated`; >48h = `stale`),
    compares the primary metric ONLY under matching units/currencies
    (mismatch = unknown + exact reason, suite-proven), and shows contribution
    ONLY from `objective_contribution_assessments` — else the explicit
    "No verified contribution evidence" line.
- **Reporting: composition, never re-derivation.** `marketing_reporting_overview`
  and `marketing_reporting_campaign` CALL `marketing_campaign_report` /
  `marketing_sequence_report` per row; the suite asserts jsonb-EQUALITY
  between the composed row and the canonical authority (dev DB + PostgREST),
  so totals reconcile with the existing drill-downs by construction. Filters
  (type/status/objective/factual created_at range/search) validate strictly;
  keyset pagination is the recipient-page contract (page-2 disjoint, no
  phantom page 3); overview totals are campaign COUNTS only — no cross-type
  metric arithmetic is fabricated; nulls stay null through every layer.
  Recipient/enrolment drill-down remains DELEGATED to the canonical
  marketing-campaigns / marketing-sequences actions.
- **AI drafting through the frozen engine, honestly delegated.** The audit
  found the repo's only LLM path (`_shared/openai.ts`, phone pipeline) is a
  direct fetch on a GLOBAL env key outside all capability governance — a
  divergence Phase 7 deliberately does NOT copy. Resolution: register
  `ai.generate_marketing_draft` (external, medium) + intent type
  `generate_marketing_draft` + contract + operational outcome
  `marketing_ai_draft_recorded`; the request RPC mirrors the Phase-4
  delegated-test-send package EXACTLY (AUTOMATION_AUTHORISED, no review
  routing, NO approval row — an explicitly authorised delegated draft action
  under canonical `marketing.campaigns.draft`; reversibility honestly
  IRREVERSIBLE (provider egress + spend), so the mode re-check withholds
  execution in modes requiring reversibility). Tenant enablement is
  `tenant_connector_capabilities` (`openai`) — the registry the engine itself
  enforces — flipped only by `marketing_ai_configure` under a STRUCTURAL
  owner/admin ceiling inside the RPC (hostile `marketing.ai.manage` grants to
  ops proven inert) + the new additive `marketing.ai.manage` permission
  (owner/admin default only; vocabulary now 12).
  Credentials: tenant Vault broker (`provider_secret_store/read`,
  `openai`/`api_key`) — never an env key, never echoed (conformance gate (k)
  scans for `OPENAI_API_KEY|Deno\.env` in the adapter).
- **Provenance mirrors the response-proposal pattern without table reuse**
  (mixing domain ownership was rejected; the PATTERN is reused):
  `marketing_ai_requests` (frozen brief; immutable except write-once close
  facts; status always DERIVED from engine facts — no fabricatable status
  column exists), `marketing_ai_proposals` (IMMUTABLE original + provider,
  model, prompt_version `marketing-draft@1`, prompt/completion tokens,
  finish_reason; unique per intent — regeneration is a NEW request),
  `marketing_ai_revisions` (append-only numbered human edits with editor +
  note). Acceptance goes through the canonical authoring RPCs with AI lineage
  (byte-match to the original OR a recorded revision), writes DRAFTS only,
  and structurally invalidates prior approval (suite-proven: an approved
  campaign returns to draft). Reject preserves the proposal as evidence;
  cancel uses the engine's legal pending→cancelled transition and refuses
  once execution began or a proposal exists.
- **Prompt/data safety.** `_shared/marketing_ai_prompt.ts`: versioned
  deterministic builder (fixed system message with ZERO tenant data; the
  brief in a delimited untrusted-data block; only an explicitly selected
  Objective's TITLE crosses, frozen at request time), exact envelope
  allowlist with hard bounds, and the exact 4-field output schema —
  unsupported fields, truncation (`finish_reason=length`), refusals and
  malformed JSON are stable permanent failures. Full content legality stays
  with the ONE canonical SQL validator, run inside
  `marketing_ai_record_proposal` — invalid model output can never become a
  proposal at all. Prompt injection is NOT claimed impossible; the enforced
  boundary is what leaves the model.
- **Editorial quality guidance** (`_shared/marketing_quality.ts`,
  `marketing-quality@1`): deterministic, ADVISORY-only, clearly labelled "not
  AI, never blocking" in API + UI; thresholds tenant-tunable via the existing
  `marketing_settings.settings.quality` bag; no brand copy. The canonical
  validator remains the only blocker.

### Schema (migration `20260904120000_marketing_templates_reporting_ai.sql`)

+7 tables (upgrade-proven 191→198): `marketing_templates` (identity, version
concurrency, guarded archive facts), IMMUTABLE `marketing_template_revisions`
(content + hash + `source` editor|duplicate|ai_draft + lineage columns),
APPEND-ONLY `marketing_template_usages`, APPEND-ONLY
`marketing_campaign_objective_history`, `marketing_ai_requests` (guarded),
IMMUTABLE `marketing_ai_proposals`, APPEND-ONLY `marketing_ai_revisions`.
Additive on existing tables: `objectives`/`objective_links` `(tenant_id,id)`
unique indexes (composite-FK targets, the Phase-5 pattern);
`objective_links` target-kind CHECK + campaign guard;
`marketing_campaigns.objective_link_id` + `objective_link_ref` freeze guard;
`marketing_campaign_revisions` lineage columns + `source` CHECK extension
('template','ai_draft') + `mcr_lineage_shape` + lineage guard/usage triggers;
`marketing_sequence_steps` usage trigger. Every new tenant table: tenant_id,
composite tenant FKs, RLS SELECT gated on `marketing_has_permission
('marketing.view')`, bounded indexes, append-only guards where evidence,
service-role-only writes with update/delete/truncate revoked on history even
for service_role, no client write policy anywhere. 34 new functions — NONE
SECURITY DEFINER (catalog-asserted), ALL revoked from client roles
(catalog-derived grant lock in the suite fails loudly if any becomes
reachable).

### Edge/API surface

`marketing-templates` (list/detail/create/revise/duplicate/archive/restore/
preview/quality_check/use_in_broadcast/use_in_sequence_step),
`marketing-reporting` (overview/campaign_report/objective_search/
objective_context/link_objective/unlink_objective), `marketing-ai-drafts`
(status/configure/request_generation/request_status/request_list/
proposal_detail/revise/accept/reject/cancel). All: requireTenantUser + the
canonical-resolver double gate, per-action exact key allowlists, stable
`mapDbError` vocabulary (+ CONFIG_REQUIRED for unconfigured AI), no raw DB
errors, no credentials/Vault values/hidden prompts/unbounded lists in any
response; the browser can never plant lineage keys (edge allowlists exclude
them — lineage travels only through the governed use/accept paths).
`config.toml` gained ONLY the three Phase-7 entries (the unrelated Phone
Operations hunk is byte-for-byte untouched). The UI keeps the mandated
internal order and makes Templates, Objectives & Reporting and AI Drafting
operational (AI honestly "Not connected/Configuration required" until an
owner/admin configures a provider); metric cells render null as
"Unavailable" with the server's reason, never 0.

### Deliberately evolved earlier-phase assertions (accuracy, not weakening)

The `marketing.ai.manage` permission grew the vocabulary 11→12:
`marketing_foundation.test.sql` (count), `marketing_hardening.test.sql`
(owner/admin full set + vocabulary count), `scripts/marketing-access.test.mjs`
and `scripts/marketing-access-http.test.mjs` (owner/admin set size) were
updated to the new factual count. The client mirror
(`src/lib/marketing/permissions.ts`) gained the same entry (owner/admin
default only). No other committed test was touched.

### Verification matrix (2026-07-31, local)

| Check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Result                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_templates_reporting_ai.test.sql` — 13 sections: template authority/content/immutability/concurrency/duplicate lineage; pinning + approval invalidation + pin survival + lineage-lie adversarials (RPC and direct-insert); sequence-step pinning; archive semantics; the governed objective link lifecycle incl. registry/validator adversarials, idempotency (converge/MK412), zero-fabrication deltas, honest context (never_evaluated/unit_mismatch/comparable/no-evidence); reporting composition jsonb-equality + strict filters + stable pagination + cross-tenant zero; AI provider honesty + structural config ceiling (hostile grant inert); the governed generation request (frozen brief, NO approval row, MK428/MK429/MK412, immutable request); REAL engine claim → canonical-validator gate (invalid output persists NOTHING) → immutable proposal with provenance → finalize → derived status; human revisions; accept into template/broadcast/sequence (draft-only, approval invalidated, MK409 on stale destination); reject/cancel; RLS + catalog grant lock + no-SECURITY-DEFINER assertion | **PASS** on the dev DB, the fresh clean-chain DB AND the upgraded-from-`60cc18f` DB                                                                                                                         |
| `scripts/marketing-templates-ai-pure.test.mjs` — 20 tests: quality determinism + every rule + thresholds; envelope allowlist/bounds/version; prompt determinism + instruction/data separation + hostile-brief containment; output schema gate; the REAL adapter against a scripted client + mocked fetch (fail-closed transients with ZERO provider calls, permanent refusals, ONE-call healthy path with Vault credential + governed recorder, 429/5xx/network transient, 401 permanent, refusal/truncation/malformed permanent, validator-rejection permanent, recorder-failure bounded transient); source scans (no env key, one fetch site, no getStatus)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS 20/20**                                                                                                                                                                                              |
| `scripts/marketing-templates-ai.test.mjs` — PostgREST + real GoTrue JWTs: 25 RPC denials (authenticated + anon) + table write denial; viewer-without-view reads ZERO rows; tenant-B reads ZERO; PARALLEL identical objective links converge (ONE link, ONE history act); PARALLEL template revisions → ONE winner + ONE MK409; provider configure + hostile-ops denial; the governed generation request; **DRIFT LOCK: the REAL SQL-built envelope validates against the adapter's exact allowlist**; REAL engine claim + stubbed output → ONE proposal; PARALLEL identical accepts → ONE template with AI provenance; overview composition jsonb-equal over PostgREST                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS** (re-run-safe)                                                                                                                                                                                      |
| `scripts/marketing-phase7-http.test.mjs` (shared edge-probe classifier over all three functions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **NOT RUN — exit 3** (unserved 503 locally; honestly staged)                                                                                                                                                |
| Marketing Phase 0–6 regressions (foundation/hardening/contacts/admin/senders/broadcasts/sequences SQL; access/admin/contacts/senders/broadcasts/sequences mjs; senders-pure 24, broadcasts-pure 20, sequences-pure 22, import-pure 13, edge-probe 7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **PASS** (SQL suites on all THREE databases)                                                                                                                                                                |
| Engine/objective/approval regressions (`automation_engine`, `execution_reliability`, `email_reliability`, `response_approval_atomicity`, `objective_health_evaluation`, `objectives_versioning`, `decision_log_immutable`; `automation-dedup` 1/1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS** on dev + clean chain + upgraded DB (SQL)                                                                                                                                                           |
| `work-projection` + `view-as` mjs (the objective_links CHECK extension regresses no existing consumer) · `npm run verify:product` · `npm run test:openfolk` 23/23                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **PASS**                                                                                                                                                                                                    |
| `bash scripts/intelligence-conformance.sh` — including the NEW gate (k): the AI adapter's own contract (one generation intent, ONE provider call, Vault-only credentials, governed-RPC-only persistence, honest delegated registration, no fabricated approval anywhere in the migration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS**                                                                                                                                                                                                    |
| `npx tsc --noEmit` · focused ESLint on every changed/created TS/TSX/MJS file · `npm run build` (production) · `git diff --check` · `node scripts/check-migration-order.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PASS**                                                                                                                                                                                                    |
| Fresh clean chain — 86 committed migrations + Phase 7 from FINAL bytes (untracked phone-ops excluded, as every phase) on a fresh `supabase/postgres:17.6.1.141` container + all 14 suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS**                                                                                                                                                                                                    |
| Upgrade from the EXACT committed head `60cc18f` — seeded campaign (with a LEGACY `objective_link_ref` value), sender, segment, objective+metric+measurement+health+link data → Phase 7 applied ONCE: **exactly +7 tables (191→198)**, every seeded row preserved, legacy ref readable but CLOSED to new writes, lineage columns default null, NO campaign auto-linked, NO template/AI row seeded, capability registered globally with **ZERO tenant enablement**; all 14 suites pass on the upgraded DB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **PASS**                                                                                                                                                                                                    |
| Run-once discipline (second application)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **PASS** — fails loudly (`relation "marketing_templates" already exists`)                                                                                                                                   |
| `reliability_vertical.test.sql`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **NOT RUN** — pgTAP absent locally (pre-existing; fails identically without Phase 7 on `plan(15)`); `queue-collision`/`data-import`-class suites need the remote/served env (pre-existing, documented §15d) |
| Authenticated Edge HTTP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **NOT RUN — exit 3** (no served runtime; the probe classified 503 = unserved)                                                                                                                               |
| Populated visual QA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **NOT RUN** — no served authenticated runtime exists; build + typecheck + static inspection are NOT visual verification                                                                                     |
| REAL model request / REAL email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **NEVER EXECUTED** — provider results mocked at the engine boundary (SQL/PostgREST) or at global fetch (pure); no credential beyond a synthetic local test string ever existed                              |

### Honest limitations

- No model provider is configured anywhere; AI Drafting's runtime state is
  **Not connected/Configuration required** and no generation has ever run.
  The adapter transport was never executed against a real provider.
- ~~Template create/revise/duplicate/use are deliberately NOT request-id
  idempotent~~ **Superseded by the production-readiness correction pass
  (§16c, 2026-07-31): EVERY template mutation now REQUIRES a validated
  `request_id` (`^[A-Za-z0-9_-]{8,64}$`) through the canonical
  `marketing_request_keys` ledger** — create, revise, duplicate,
  archive/restore and both use-in destinations. The fingerprint binds tenant,
  genuine actor, action, resource, expected version and every semantic
  argument; the ledger is consulted BEFORE the version/status gates so a
  byte-identical replay returns the ORIGINAL result even after the resource
  advanced; changed reuse (payload, version or actor) is MK412; the exact
  result persists atomically with the side effects. AI acceptance derives a
  deterministic namespaced CHILD key server-side
  (`substr(md5('ai-accept-child:' || <outer id>), 1, 32)`) for its internal
  template mutation — never accepted from the browser, and a browser reuse of
  the child key value can never fingerprint-match (the Edge create allowlist
  cannot carry AI lineage) so it conflicts.
- Reporting composes what exists: delivered/opened/clicked/bounced stay null
  (no evidence pipeline); overview totals are campaign counts only; no Ads
  spend/CPL anywhere.
- `marketing_ai_request_status` derives from intent state + proposal
  existence. **Corrected by the adversarial audit (2026-07-31):** the
  previously-acknowledged "second paid call bounded by max_attempts" window
  is CLOSED. After a successful provider call, a recorder failure retries the
  idempotent recorder RPC once in-place and otherwise returns `unknown` — the
  engine freezes automatic retry (`external_result_unknown`, routed to
  review); one logical generation request can never automatically buy a
  second provider call because persistence failed. If the recorder actually
  committed and only its response was lost, the derived status reads
  `succeeded` from the proposal fact; otherwise the request shows `unknown`
  honestly and only an explicit human "generate again" (a NEW request +
  intent) reaches the provider again. Pre-provider transients (429/5xx/
  network/fail-closed reads) still retry bounded by `max_attempts = 3`.
- AI proposal retention follows the platform's append-only evidence posture
  (no automatic deletion exists platform-wide); rejection preserves evidence.
- The dev-DB proof style remains direct psql application (the documented
  Phase-1 drift note stands); the clean-chain/upgrade containers used the
  documented storage/auth shim the services normally provision.

### Phase 7 file scope — 30 paths (12 modified, 18 created)

> Count corrected by the independent adversarial audit (2026-07-31): the
> earlier header said "28 paths (10 modified…)" while the enumeration below
> already named all 12 modified files — the two evolved committed SQL suites
> (`marketing_foundation` / `marketing_hardening`, 11→12 permission-vocabulary
> accuracy only) were enumerated but not counted. 12 + 18 = 30 paths.

**Modified — 12:** this ledger · `docs/reference/AUTOMATION_ENGINE.md` ·
`scripts/intelligence-conformance.sh` (gate (k)) ·
`scripts/marketing-access.test.mjs` + `scripts/marketing-access-http.test.mjs`
(11→12 accuracy) · `src/components/app/MarketingCampaigns.tsx` ·
`src/lib/capability-registry.ts` (three new Phase-7 rows + campaigns copy +
version bump) · `src/lib/marketing/permissions.ts` ·
`supabase/functions/_shared/connectors/index.ts` ·
`supabase/tests/marketing_foundation.test.sql` +
`supabase/tests/marketing_hardening.test.sql` (11→12 accuracy) ·
`supabase/config.toml` (**partial-stage: the three marketing entries ONLY —
the Phone Operations hunk stays working-tree-only**).
**Created — 18:** `docs/product/marketing-crm/CONTENT_AND_REPORTING_SETUP.md` ·
`scripts/marketing-phase7-http.test.mjs` ·
`scripts/marketing-templates-ai-pure.test.mjs` ·
`scripts/marketing-templates-ai.test.mjs` ·
`src/components/app/MarketingAiDrafting.tsx` ·
`src/components/app/MarketingReporting.tsx` ·
`src/components/app/MarketingTemplates.tsx` ·
`src/lib/marketing/aidrafts.ts` · `src/lib/marketing/reporting.ts` ·
`src/lib/marketing/templates.ts` ·
`supabase/functions/_shared/connectors/marketing_ai_draft.ts` ·
`supabase/functions/_shared/marketing_ai_prompt.ts` ·
`supabase/functions/_shared/marketing_quality.ts` ·
`supabase/functions/marketing-ai-drafts/index.ts` ·
`supabase/functions/marketing-reporting/index.ts` ·
`supabase/functions/marketing-templates/index.ts` ·
`supabase/migrations/20260904120000_marketing_templates_reporting_ai.sql` ·
`supabase/tests/marketing_templates_reporting_ai.test.sql`.
Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
byte-for-byte outside this scope. (Counting note: the two evolved access test
scripts and the two evolved SQL suites are four files; config.toml is ONE
modified path carrying two independent working-tree hunks — partial-stage the
marketing hunk only.)

### §16b · Independent Phase-7 adversarial hardening audit (2026-07-31)

An independent audit re-verified §16's claims against the live repository and
running local databases (dev + fresh clean-chain + exact-`60cc18f`-upgrade
containers), reproduced each suspected defect against executable code before
correcting it, and left Phase 7 uncommitted. **Six defects confirmed and
corrected; every correction carries a regression test that fails without it.**

| #   | Defect (reproduced first)                                                                                                                                                                                                                                                                                                             | Correction                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Duplicate paid provider call** (cost-control, highest priority): recorder failure AFTER a successful provider call returned `failed_transient`; the engine's own `planPostExecution` scheduled a retry that re-ran the WHOLE adapter — reproduced with the real adapter + real engine plan: 2 `fetch` calls for one logical request | `marketing_ai_draft.ts`: post-provider recorder failure now retries the idempotent recorder RPC once in-place, then returns **`unknown`** — the engine freezes automatic retry (`external_result_unknown`) and routes to review. Pure-suite proofs: exactly ONE mocked fetch across recorder failure + retry; blip absorbed → succeeded; lost-response → idempotent convergence; 22023 stays permanent and is never recorder-retried |
| 2   | **Sequence-step lineage forgeable by the service role**: a DIRECT insert into `marketing_sequence_steps` with a lineage key but different content succeeded AND minted a false `marketing_template_usages` evidence row (campaign revisions refused the identical forgery via their row guard)                                        | New `marketing_sequence_step_lineage_guard()` BEFORE-INSERT trigger (migration Part C): validates template/AI lineage byte-match at the row boundary, refuses lineage on non-email steps and dual-source claims; locked in Part H. SQL-suite proofs: forged template/AI/non-email inserts all refuse; zero usage rows minted                                                                                                         |
| 3   | **Objective-link fingerprint omitted the campaign version**: reusing a request id with the same payload against a DIFFERENT campaign version converged on the stored result instead of MK412 (the ai-accept fingerprint in the same migration already bound the version)                                                              | `marketing_campaign_objective_link` fingerprint now binds `campaign_version` (= `p_expected_version`); byte-identical replay still converges. SQL + PostgREST proofs: version-differing reuse → MK412                                                                                                                                                                                                                                |
| 4   | **Archive gate launderable via duplicate**: duplicating an ARCHIVED template minted an active copy of its content, bypassing "an archived template cannot be selected for new content"                                                                                                                                                | `marketing_template_duplicate` refuses archived sources (22023 "restore it first"). SQL proof added                                                                                                                                                                                                                                                                                                                                  |
| 5   | **Idempotent replay never re-enqueued**: `marketing-ai-drafts` `request_generation` skipped `enqueueAutomationExecution` when `idempotent === true`, so a lost enqueue after the RPC committed could strand a pending intent until expiry                                                                                             | Enqueue now runs for every returned `intent_id` (the job key de-dups one active job per intent; the claim RPC stays the single-execution guard). Pure-suite source-discipline scan locks the contract                                                                                                                                                                                                                                |
| 6   | **Catalog grant-lock blind spot**: the SQL suite's pattern-only enumeration missed `marketing_campaign_revision_lineage_guard` — Part H locked it, but a regression could never be detected                                                                                                                                           | Suite §13 now derives the catalog set AND compares it to the complete 35-function expected list in BOTH directions (missing OR extra fails loudly); SECURITY-DEFINER check runs over the same exact set                                                                                                                                                                                                                              |

UI corrections from the audit's static inspection (no served runtime exists,
so this is NOT visual QA): (a) the sequence "Submitted" column now sums ONLY
per-`send_email`-step canonical counts (internal tag/lifecycle/owner steps
were being counted as submissions) and both column variants carry the exact
"submitted ≠ delivered" semantics in a tooltip; (b) an `unknown` AI request
row now explains itself ("parked for review; never re-billed automatically"),
shows its `last_error`, and gains the refresh affordance — required by
correction #1's unknown boundary; (c) editing a generation brief rotates the
request id (the code comment promised this but no effect existed — a
post-failure resubmit with an edited brief could hit a confusing
REQUEST_MISMATCH); (d) the icon-only refresh button gained an accessible
name. The accessibility gaps this inspection recorded were COMPLETED by the
follow-up correction pass — see §16c.

Determinations (no change required, evidence recorded): `contributes_to` is
safe intent vocabulary — the canonical evaluator consumes `supports` and
`contributes_to` identically as EXPECTED-contribution candidates
(`objective_evaluate.ts` filters `approved=true` + verified states;
confirmation stays structurally impossible while the outcome-evidence registry
is empty), and committed `work_transition.ts` already writes `contributes_to`
links at intent time. SSRF surface: the provider URL is the fixed
`OPENAI_CHAT_URL` constant, the model string is a bounded identifier
(`^[A-Za-z0-9._:-]{1,80}$`), no configurable base URL exists, no environment
fallback exists (conformance gate (k)), and credentials resolve only through
the tenant-scoped Vault broker (`provider_secret_read` — SECURITY DEFINER,
`search_path=''`, name-derived from `p_tenant`, service-role-only EXECUTE);
the stored `secret_ref` is presence-only and never used to fetch. The
`objective_links` CHECK replacement is byte-compatible (committed 10-kind list

- `marketing_campaign`). Identical-timestamp keyset pagination proven exact.
  `marketing_ai_configure` stores the Vault secret before the RPC's ceiling
  re-check — reachable only by an Edge-verified owner/admin against their OWN
  tenant's slot; recorded as accepted, not a defect.

Audit verification (all on FINAL migration bytes): fresh clean chain (87
migrations, phone-ops excluded) + exact-`60cc18f` upgrade (seeded Phase 0-6 +
Objective data preserved; legacy `objective_link_ref` readable + closed;
run-once re-application fails loudly) — 17 SQL suites PASS on dev, clean-chain
AND upgraded DBs; pure 24/24; PostgREST suite extended with
supersede-vs-supersede, link-vs-unlink and different-step parallel accepts
(ALL PASS incl. loser-retry convergence and step-order preservation); Phase
0-6 mjs suites + work-projection/transition + automation-dedup +
queue-collision ALL PASS; `tsc` clean; focused ESLint clean; Prettier clean;
production build PASS; conformance (a)–(k) PASS; migration-order PASS; HTTP
suites honestly exit 3 (unserved local gateway). Nothing staged, committed,
pushed, deployed, remotely migrated; no real model call; no email; no cron,
secret, scope or provider change.

### §16c · Production-readiness correction pass (2026-07-31, after §16b)

A follow-up pass completed the two areas §16b had recorded but not closed.
Same discipline: no staging/commit, unrelated work untouched, final-bytes
proofs on dev + fresh clean-chain + exact-`60cc18f`-upgrade databases.

**1 · Template mutation request-id idempotency (all seven mutations).**
`marketing_template_request_gate(uuid, text, text, text)` (service-role-only,
in the Part H lock + exact-set catalog list — now 36 functions) implements
the canonical order for create / revise / duplicate / archive / restore /
use-in-broadcast / use-in-sequence-step: validate id → fingerprint every
semantic input (tenant, genuine actor, action, resource + expected version +
full argument object; no clocks, no credentials) → per-tenant/action/request
advisory lock → ledger consultation BEFORE any version/status gate → replay
returns the stored result / changed reuse raises MK412 → side effects →
result persisted atomically. Proven outcomes (SQL §5b battery + PostgREST):
create/duplicate replay mints no second row; **revise replay returns the
ORIGINALLY created revision even after the template advanced**;
archive/restore replay returns the original success even though a fresh call
would refuse as already-archived; both use-in replays create no second
campaign/sequence revision, step or usage row; zero duplicate audit/event
rows on replay (persisted-count assertions, not response shapes); parallel
identical requests converge (creates, uses, revisions — real PostgREST
`Promise.all`); a DIFFERENT ACTOR reusing an id + payload gets MK412, never
another actor's stored result; missing/malformed ids refuse with zero
writes; distinct ids keep normal MK409 version-conflict behaviour. Edge
allowlists, the typed client (`newTemplateRequestId` + per-call requestId)
and the UI (semantic-scope key cache: unchanged retry reuses its key, any
input change derives a new one, success clears the scope) all carry the id.
AI acceptance passes a derived namespaced child key server-side; accept
replay still converges on ONE template and a browser reuse of the child key
value conflicts (proven in SQL §11).

**2 · Accessibility + forbidden states (static inspection — still NOT visual
QA; no served runtime exists).** Campaign tabs are a complete tablist:
labelled `role="tablist"`, per-tab `role="tab"` + stable ids +
`aria-selected` + `aria-controls`, roving `tabIndex`, Left/Right/Home/End
with focus-following activation, and a matching labelled `role="tabpanel"`;
tab order unchanged (Broadcasts, Sequences, Templates, Objectives &
Reporting, AI Drafting). Stateful toggles carry `aria-pressed`
(active/archived filter, new-vs-replace mode, original-vs-revision compare);
search fields and reporting selects have accessible labels (no
placeholder-as-label); icon-only buttons are named (`aria-label` mirrors
`title` in the shared Btn atoms); notices are `role="status"`/`aria-live=
"polite"` and blocking errors `role="alert"`. Every Phase-7 dialog remembers
its invoking control, keeps the focus trap (now including `textarea`),
supports Escape, and restores focus to the opener on close with a
deterministic fallback (the selected tab) if it disappeared. Templates and
AI Drafting gained dedicated FORBIDDEN branches (like Reporting's): a
permission denial is its own state — never a retryable error, never "Not
connected"/"Configuration required", and it reveals nothing about what
exists. The dead `PreviewCard` component was removed from
`MarketingCampaigns.tsx` (no callers; its icons remain in live use by the
tab registry — no genuine Preview status was touched).

**Verification (this pass):** Phase 7 SQL suite incl. the §5b idempotency
battery + child-key proofs — PASS on dev, fresh clean-chain and
exact-upgrade DBs (final migration bytes; run-once re-application still
fails loudly); pure suite 24/24; extended PostgREST suite ALL PASS; Phase
0–6 SQL + engine/objective regressions PASS on all three DBs; `tsc` clean;
focused ESLint clean; Prettier clean; production build PASS; conformance
(a)–(k) PASS; migration-order PASS; `git diff --check` clean; HTTP suites
honestly exit 3 (unserved). No real model call, no email, nothing staged/
committed/pushed/deployed, no remote migration, no cron/secret/provider
change, Phase 8 untouched.

### External configuration required before any live Phase-7 surface

See [CONTENT_AND_REPORTING_SETUP.md](CONTENT_AND_REPORTING_SETUP.md): deploy
migration + three functions + shared bundle; owner/admin provider
configuration (model + Vault key) for AI; an operational mode permitting
irreversible external work for generation to execute; explicit human
authorisation for the first real generation. Broadcasts/Sequences launch
gates unchanged.

## 10 · Restart-safe "next phase"

**Next: the Phase-7 checkpoint commit.** The independent adversarial hardening
audit is COMPLETE (§16b, 2026-07-31): six defects confirmed, corrected and
regression-locked; every §16 claim re-verified on dev + fresh clean-chain +
exact-`60cc18f`-upgrade databases from final migration bytes. Phase 7 remains
deliberately UNCOMMITTED: the working tree holds the complete Phase-7 file set
(30 paths) plus the unrelated concurrent phone-operations work, and the index
is empty. Commit the checkpoint with **partial-stage `supabase/config.toml`
(the three marketing entries only — never the phone-operations hunk)**. Launch gates carried forward unchanged:
authenticated Edge HTTP, populated visual QA, scheduler installation, the
public unsubscribe base URL, provider authorisation (Gmail send + AI model
provider) and real authorised sending/generation — none provable without a
served, deployed environment. Phase 8 (Ads) is COMMITTED as `df8b6c5`;
Phase 9 (platform seams, §18) is BUILT and is the content of this
checkpoint commit.

**Superseded Phase-7 plan (delivered above, §16): Templates, Objectives &
Reporting, AI Drafting.**

**Superseded Phase-6 plan (delivered above, §15): Sequences** (on the proven
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

## 17 · Phase 8 — Ads Lead Capture, Attribution, Metrics & Source Health (2026-07-31; BUILT + locally proven + INDEPENDENTLY AUDITED §17b; COMMITTED as `df8b6c5`, 2026-08-01)

**Ads captures and attributes leads; it does not create or edit adverts.**
Governed factual flow, all through EXISTING authorities (no second identity/
relationship/interaction/import/event/job/connector-health/attribution
system): configured source → signed webhook event → append-only ledger →
canonical inbound Interaction → canonical identity resolution →
Person/relationship → append-only touchpoint → honest reporting → health.
Full contract, security posture, semantics and deployment steps:
[ADS_SETUP.md](ADS_SETUP.md).

Key structural facts: the `marketing_create_contact` superset adds ONLY the
optional bounded provenance detail (`source in ('manual','ad_lead')` +
`source_record_ref`) with a fingerprint that is byte-identical for every
pre-existing request; the authorising human for worker processing is the
admin who committed the PINNED source-configuration version; provider/mode
are immutable (a semantic change is a NEW source); manual sync refuses
truthfully (`MK430 UNSUPPORTED`) for every v1 provider; the webhook signing
secret lives ONLY in the tenant Vault broker (`ads-src-<id>` /
`signing_key(+_previous)`), generated server-side and shown exactly once;
browser roles hold ZERO write privileges on the seven new tables (explicit
Part-K revokes — Supabase default-privilege drift is neutralised, the same
determinism Part H gives functions).

### Verification (2026-07-31, synthetic fixtures only)

| Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/marketing_ads.test.sql` — 7 sections: source ceilings (hostile grants inert, explicit denies effective, viewer/ops refused), request-id idempotency (replay converges / changed reuse MK412 / tenant-scoped ledger), MK409, provider-mode immutability, truthful unsupported providers, recoverable archive + append-only versions; ingest dedup/replay/conflict + ledger immutability + forward-only states + disabled-source refusal; processing (ONE Interaction, created/existing/ambiguous identity paths, pinned defaults, `ad_lead` provenance, tag via canonical authority, NO preference invented, eligibility `unknown`, replay-safe touchpoints, governed retry convergence); deterministic first/last touch + stable ties; metrics (spend⇒currency structurally, CPL truth incl. `no_spend_facts`/`mixed_currencies`, supersession, append-only); health/attention/remediation honesty; cross-tenant denial + RLS on all 7 tables + browser-write denial + the COMPLETE 24-function catalog lock (both directions) + no SECURITY DEFINER | **PASS** on the dev DB, fresh clean-chain AND exact-`eef1468`-upgrade DBs                                                                                                                     |
| `scripts/marketing-ads-pure.test.mjs` — signature valid/rotation/wrong-secret/tampered-byte/tampered-timestamp; **previous-secret retired once the bounded overlap lapses (§17b F4)**; freshness (missing/malformed/stale/future); malformed signature; comparator behaviour; public-key shape; **body limit measured in BYTES not code units (§17b F5)**; strict payload (unknown keys at every level, schema/id/timestamp/bounds/control chars, empty lead); bounded redaction-safe envelope; TRUTHFUL catalogue (exactly one implemented mode, zero capability claims elsewhere, no manual/metric sync anywhere); source scans (raw-bytes-before-parse, verification-before-parse, one generic 401 path, Vault-only secrets, no logging, worker writes only via governed RPCs, **webhook_setup mark-before-store idempotency-first §17b F3**)                                                                                                                                                                                                                     | **PASS** (18/18)                                                                                                                                                                              |
| `scripts/marketing-ads.test.mjs` — every Phase-8 RPC service-role-only over PostgREST (authenticated+anon 42501); browser insert denial on evidence tables; PARALLEL identical source creates converge (ONE row); PARALLEL identical deliveries converge (ONE logical event); PARALLEL claim batches yield an event exactly once; E2E claim→process→resolved Person + ONE inbound Interaction + ONE exact-confidence touchpoint; viewer-without-view and tenant-B read ZERO; cross-tenant NOT_FOUND                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS** (real PostgREST boundary)                                                                                                                                                            |
| `scripts/marketing-ads-http.test.mjs` (management + public webhook, shared probe)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **NOT RUN — exit 3** (no served runtime)                                                                                                                                                      |
| Fresh clean chain — 88 migrations (87 committed + Phase 8 FINAL bytes; untracked phone-ops excluded as every phase) + the full 23-suite battery                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS**                                                                                                                                                                                      |
| Exact upgrade from `eef1468` — seeded Phase 0-7 + Objective data (campaigns, sequence+steps, template+revision, objective+metric+measurement+link) → Phase 8 applied once: every seeded row preserved, exactly +7 tables, NOTHING seeded (no source/event/metric/tenant enablement), vocabulary stays 12, existing link kinds writable; full battery passes; second application **fails loudly** (`relation "marketing_ad_sources" already exists`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **PASS**                                                                                                                                                                                      |
| Phase 0–7 regressions — all marketing SQL suites + objectives/health/automation/execution/email/response-approval/control-plane/decision-log/secret-broker/phone-projection/intelligence-activation/customer-health/verification-locks/oauth-state + marketing mjs pure suites + work-projection/transition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **PASS** (23/24 clean chain; `reliability_vertical` needs pgTAP absent from the clean-chain bootstrap → PASSES `ok 1..15` on the dev DB with corrected fns; mjs PostgREST on the local stack) |
| **Re-audit corrections (§17b) — 11 confirmed defects reproduced + fixed; each regression lock FIRST FAILS against reverted defective code** (F1 metrics mixed-currency `totals.spend`; F2 unbounded `occurred_at`; F3 webhook_setup double-rotation; F4 previous-secret indefinite validity; F5 body-limit code-units-not-bytes; F6 unconstrained attribution person/company FK; F7 retired-stage default; F8 poison-event claim ceiling; F9/F10/F11 UI honesty)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **PASS**                                                                                                                                                                                      |
| Double-run sensitivity — the Phase-8 SQL suite run TWICE back-to-back on the clean chain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **PASS** (stable)                                                                                                                                                                             |
| `tsc --noEmit` / focused ESLint / Prettier / production build / conformance (a)–(k) / migration order (89 files) / `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **PASS**                                                                                                                                                                                      |
| Populated visual QA / real provider / real lead / real email / real model call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **NOT RUN / NEVER EXECUTED**                                                                                                                                                                  |

### 17b · Independent adversarial re-audit — 11 confirmed defects corrected (2026-07-31)

An independent audit treated §17 as claims to verify from the final bytes. It
reproduced each defect (reverting the fix on a fresh clean-chain DB makes the
new regression lock fire), applied the smallest robust correction, and re-ran
the full battery. The unrelated Phone-Operations/telephony/product-review/
run-checkpoint work stayed byte-for-byte untouched; the index stayed empty and
HEAD stayed `eef1468`.

| #   | Severity        | Defect (brief ref)                                                                                                                                                                                            | Correction                                                                                                                                                                  | Regression lock                                                                                |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| F1  | High            | `marketing_ad_metrics.totals.spend` returned a cross-currency SUM (95 GBP + 10 EUR = 105) under mixed currencies (§15 "mixed currencies are never added")                                                     | `totals.spend` is `null` when >1 currency; the per-currency `facts` remain                                                                                                  | SQL: `totals.spend` is null under mixed currencies                                             |
| F2  | High            | `occurred_at` was only parse-checked — an ancient/far-future value stole first/last attribution touch and skewed metric windows (§7/§14)                                                                      | bounded to `received_at −30d … +1d` in `marketing_ad_event_ingest` (authoritative) + the webhook receiver (nice 400)                                                        | SQL: far-future & ancient `occurred_at` refused; pure: window documented                       |
| F3  | High (security) | `webhook_setup` did the Vault rotation BEFORE the request-id gate → a replayed request id rotated the secret twice and re-revealed a new one (§5 "must not rotate twice")                                     | idempotency-FIRST: `marketing_ad_source_credential_mark` runs before any Vault write; a replay returns `replayed:true` with no rotation and no secret                       | SQL: repeated rotation request id never rotates twice; pure source-scan: mark precedes store   |
| F4  | High (security) | the previous signing secret was accepted INDEFINITELY (§5 "must not remain valid indefinitely; enforceable retirement")                                                                                       | new `credential_rotated_at` column + `ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS` (24 h): the webhook honours the previous secret only inside the bounded window, then retires it | pure: previous secret verifies in-window, refused once lapsed; SQL: rotation records the clock |
| F5  | Medium          | the 64 KB body limit was measured in UTF-16 code units, not bytes — a multibyte body could carry ~3× the ceiling (§5)                                                                                         | `adsWebhookBodyByteLength` (UTF-8) + a Content-Length pre-check                                                                                                             | pure: byte length vs code-unit length on a 90 KB-byte / 30 K-code-unit body                    |
| F6  | Medium          | `marketing_ad_touchpoints.person_id`/`company_id` had NO FK — a service-role insert could forge a cross-tenant/non-existent attribution reference (§17)                                                       | composite `(tenant_id, person_id/company_id)` FKs to `people`/`companies` (repo precedent)                                                                                  | SQL: a forged person reference fails `foreign_key_violation`                                   |
| F7  | Medium          | an ad-source default could pin leads onto a RETIRED (inactive) lifecycle stage (§12; `marketing_settings_update` already requires active)                                                                     | `source_create`/`source_revise` require an ACTIVE stage                                                                                                                     | SQL: a retired default stage is refused `P0002`                                                |
| F8  | Medium          | `marketing_ad_claim_events` had no attempts ceiling — a poison event (processing + expired lease) could be re-leased forever (§10 "poison events cannot loop forever")                                        | the claim retires `attempts>=10` expired-lease events to `failed`/`max_attempts_exhausted` and excludes them from reclaim                                                   | SQL: a poison event is retired to failed, not re-leased                                        |
| F9  | Medium          | the Ads UI swallowed 4/5 read failures and then fabricated "no leads"/"no_spend_facts (no fabrication)" from a failed fetch (§20 honest states)                                                               | per-section load errors (`feedError`/`metricsError`/`sideError`) render honest retryable error states, never a fabricated empty/unavailable                                 | static inspection (populated visual QA remains NOT RUN — no served runtime)                    |
| F10 | Low-med         | client `canManage` checked only `marketing.ads.manage`, not the owner/admin ceiling — a stray grant to ops/viewer surfaced management buttons that only 403 (§20 "retry visible only to authorised managers") | `AdsSection` gates on `role ∈ {owner,admin} ∧ marketing.ads.manage`, mirroring the server ceiling                                                                           | static inspection                                                                              |
| F11 | Low             | the shown-once-secret clipboard write had no error path — an insecure context silently failed while the user believed it copied (§20 "clipboard failure handled accessibly")                                  | `copySecret` catches failure and shows a manual-copy instruction via a live region                                                                                          | static inspection                                                                              |

Environmental notes (not defects): the dev DB carries orphan touchpoint
residue from earlier mjs cleanups, so the F6 composite FK was verified on the
fresh clean-chain and the exact-`eef1468` upgrade DB (where the ad tables are
empty at migration time and the FK applies cleanly) rather than by ALTER on the
residue-bearing dev DB; and `reliability_vertical` (pgTAP) is not runnable on
the clean-chain bootstrap (pgTAP absent) but passes `ok 1..15` on the dev DB
with the corrected functions. Documentation (`ADS_SETUP.md`) and the UI copy
were corrected to state the bounded rotation-overlap retirement, the stable
per-lead `event_id` contract, the `occurred_at` window and the byte-measured
body limit honestly.

### Honest limitations

- The ONE executable ingestion mode is the provider-neutral signed webhook —
  labelled exactly that. Meta / Google Ads / LinkedIn / authenticated-Sheet
  remain Not connected: no adapter, credentials, provider-specific
  signature/challenge verification, lead-detail fetch, metric sync or cursor
  handling exists, and nothing pretends otherwise.
- Spend/CPL are UNAVAILABLE (with the exact reason) until a genuinely
  connected adapter records metric facts; the recorder exists and is proven
  with test fixtures only.
- No scheduled sync/cron exists or is registered — nothing polls.
- Identity-conflict RESOLUTION remains the platform's existing review data
  path (`marketing_identity_conflicts`); a dedicated resolution UI is
  future work. Unresolved leads keep full event+Interaction+touchpoint
  evidence with `review` confidence; the touchpoint person link is
  write-once for governed reconciliation.
- A pre-existing committed-test fragility surfaced during regression: the
  Phase-6 SQL suite selected executions `LIMIT 1` WITHOUT a tenant filter,
  breaking under heap-order drift once append-only PostgREST-suite residue
  existed on the dev DB. Fixed test-only (two tenant filters in
  `supabase/tests/marketing_sequences.test.sql`); proven deterministic
  before/after on all three DBs; no committed migration touched.

### Phase 8 file scope — 19 paths (6 modified, 13 created)

**Modified — 6:** this ledger · `supabase/config.toml` (**partial-stage: the
two Phase-8 marketing entries ONLY — the Phone Operations hunk stays
working-tree-only**) · `supabase/functions/_shared/worker_handlers/index.ts`
(one registry line) · `src/routes/marketing.tsx` (Ads Preview card → the
operational surface) · `src/lib/capability-registry.ts` (marketing.ads truth

- version bump) · `supabase/tests/marketing_sequences.test.sql`
  (determinism-only tenant filters).
  **Created — 13:** `supabase/migrations/20260905120000_marketing_ads.sql` ·
  `supabase/tests/marketing_ads.test.sql` ·
  `supabase/functions/_shared/marketing_ad_webhook.ts` ·
  `supabase/functions/_shared/marketing_ads_adapters.ts` ·
  `supabase/functions/_shared/worker_handlers/marketing_ad_lead.ts` ·
  `supabase/functions/marketing-ads/index.ts` ·
  `supabase/functions/marketing-ad-webhook/index.ts` ·
  `scripts/marketing-ads-pure.test.mjs` · `scripts/marketing-ads.test.mjs` ·
  `scripts/marketing-ads-http.test.mjs` · `src/lib/marketing/ads.ts` ·
  `src/components/app/MarketingAds.tsx` ·
  `docs/product/marketing-crm/ADS_SETUP.md`.
  Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
  byte-for-byte outside this scope.

## 18 · Phase 9 — Marketing Platform Seams: Connections, Sync, Observability (2026-08-01; BUILT + locally proven; COMMITTED as `70e67cc`)

**A SEAM LAYER, NOT AN INTEGRATION.** Phase 9 builds the governed boundary a
future reviewed provider adapter plugs into — and proves that WITHOUT an
adapter, nothing can claim connected, synced or fresh. Zero adapters exist;
zero credentials are usable; nothing polls; nothing is fabricated.

Structure (all through EXISTING authorities — `marketing_require_ads_actor`,
`marketing_template_request_gate` + `marketing_request_keys`, the tenant
Vault broker, `marketing_event_append`, `audit_logs`):

- **Provider connection accounts** (`marketing_provider_accounts` +
  append-only `_versions`): provider ∈ meta/google_ads/linkedin/sheet
  ('webhook' deliberately absent — the Phase-8 signed webhook is push-only
  and needs no account); guard-enforced lifecycle preview → connecting →
  connected → error → revoked (revoked terminal, provider immutable, version
  monotonic). The PUBLIC connect action records the attempt AND its truthful
  v1 outcome — error/`no_adapter` — as two version-history facts. The ONLY
  door to `connected` is `marketing_provider_account_connect_result`
  (service-role adapter seam) and it refuses a bare "trust me": non-empty
  verification evidence + adapter_version are required.
- **Credentials**: Vault-broker references only (`mkt-conn-<account id>`).
  `marketing_provider_account_credential_mark` commits the request-id verdict
  and the rotation clock BEFORE any Vault write (Phase-8 F3 contract: a
  replayed request id can never rotate twice or re-store); first
  configuration starts NO overlap; a genuine rotation records
  `credential_rotated_at` and the previous credential is honoured downstream
  for at most the bounded 86400 s overlap (same constant as Phase 8,
  asserted equal in the pure suite).
- **Sync engine** (`marketing_provider_sync_runs`): manual requests refuse
  MK430 for every non-connected account (in this build: ALWAYS, since
  nothing can be connected through the public API); single flight is
  structural (partial unique index on queued/running per account);
  `marketing_provider_sync_claim` mirrors the Phase-8 lease contract
  including the attempts >= 10 poison retirement to
  failed/`max_attempts_exhausted` excluded from reclaim;
  `marketing_provider_sync_complete` converges on terminal runs and bumps
  `last_synced_at` exactly once, on genuine success only. The `scheduled`
  path is `marketing_provider_sync_due` — pure due-computation; **no cron or
  scheduler is registered anywhere; nothing polls** (an explicit launch
  gate). The `marketing.provider_sync` worker handler claims and completes
  through the governed RPCs only, honestly failing every run with
  `no_adapter`.
- **Freshness** — COMPUTED at read time in
  `marketing_provider_connection_list`, never stored: `error` (latest
  terminal run failed, reason = its error_class) > `never_run` (no
  successful sync ever) > `stale` (facts older than the bounded
  `stale_after_seconds` window, default 86400) > `fresh`; each state carries
  its reason/age.
- **Security posture** (identical to Phase 8): RLS on all three tables;
  browser roles hold ZERO write privileges (explicit Part-I revokes
  neutralise default-privilege drift); every function INVOKER, service-role
  only; namespace `marketing_provider_%` locked in BOTH directions by the
  suite — chosen to be disjoint from the committed Phase-8 catalog lock,
  which passes undisturbed alongside Phase 9.
- **Surfaces**: `marketing-provider-connections` Edge function (requireTenantUser,
  view / owner-admin+ads.manage double gate, stable error contract; the
  operator credential's ONLY egress is the Vault store — never logged, never
  echoed); an accessible Connections panel in the Ads section (per-section
  retryable `accountsError`/`catalogError`, honest connect-attempt notice,
  sync disabled unless genuinely connected, NO spend/CPL/connected ever
  fabricated); typed client `src/lib/marketing/connections.ts`.

### Verification (2026-08-01, synthetic fixtures only)

| Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL-BEFORE: the Phase-9 suite run on the clean chain BEFORE the migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **FAILS** (`marketing_provider_account_create does not exist`) — the tests are real                                                                                                                                                                                                                                          |
| `supabase/tests/marketing_provider_connections.test.sql` — 10 sections: ceilings (viewer/ops/hostile-grant/explicit-deny), request-id idempotency (replay converges / changed reuse MK412), MK409, vocabulary, honest connect (error/`no_adapter`, both transitions recorded, replay moves nothing, `connected` unreachable via public API), adapter seam demands evidence, lifecycle guard both directions, credential mark-first + rotation clock, sync engine (MK430, single flight, lease reclaim, poison, converging completion), scheduled due-computation, append-only, freshness all four states, cross-tenant denial + RLS + browser-write denial + the BOTH-directions Phase-9 catalog lock | **PASS** on the dev DB AND the fresh clean chain (88 committed + Phase-9 FINAL bytes), run TWICE back-to-back (double-run sensitivity)                                                                                                                                                                                       |
| The COMMITTED Phase-8 suite (`marketing_ads.test.sql`) with Phase 9 applied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **PASS** on the clean chain — the Phase-8 catalog lock is undisturbed; on the dev DB it stops at the SAME pre-existing environmental F6 point as before Phase 9 (§17b residue note; byte-identical failure, no regression)                                                                                                   |
| Second application of the Phase-9 migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **fails loudly** (`relation "marketing_provider_accounts" already exists`) — run-once                                                                                                                                                                                                                                        |
| `scripts/marketing-connections-pure.test.mjs` — truthful catalogue (ZERO connect/sync adapters, helpers honest for every input), rotation overlap = 86400 = the Phase-8 constant, Vault key shape, edge source scans (mark BEFORE any Vault write with the replay short-circuit between them, credential value's single egress, no interpolation, no response echo, every mutating action manage-gated, no fabricated connected, adapter-seam RPC unreachable from the API), worker scans (governed RPCs only, honest `no_adapter`, no direct writes, no invented success, registered)                                                                                                                | **PASS** (11/11)                                                                                                                                                                                                                                                                                                             |
| Marketing SQL regression battery on the clean chain (admin/ads/broadcasts/contacts/provider_connections/senders/sequences)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **PASS** (7/7). foundation/hardening/templates_reporting_ai fail on the hand-built clean-chain bootstrap ONLY (no `vault.secrets`, partial JWT simulation) — proven PRE-EXISTING by differential: byte-identical failures on the committed-only chain WITHOUT Phase 9; all three **PASS on the dev DB with Phase 9 applied** |
| `tsc --noEmit` / ESLint (changed files) / Prettier / production build / migration order (90 files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **PASS**                                                                                                                                                                                                                                                                                                                     |
| Authenticated Edge HTTP / PostgREST-boundary mjs / populated visual QA / real provider / real credential use / scheduler installation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **NOT RUN — explicit launch gates** (no served runtime; no adapter exists)                                                                                                                                                                                                                                                   |

### Honest limitations

- `connected` is UNREACHABLE through the public API in this build — by
  design. The fixture-connected accounts in the SQL suite go through the
  adapter seam exactly as a future reviewed adapter will; no UI, Edge or
  worker path can reach it.
- A stored credential is UNUSABLE: no consumer reads the Vault entry yet.
  The UI says so at the point of entry. Revocation abandons the reference.
- The scheduled sync path is a due-computation function only. Installing a
  scheduler/cron, the PostgREST-boundary mjs suite, authenticated Edge HTTP
  and populated visual QA are explicit launch gates, with provider adapter
  review the gate for everything above.
- The Phase-9 clean-chain proofs run on a hand-built bootstrap (extensions +
  auth/storage stubs); `vault.secrets`-dependent and JWT-simulation-dependent
  committed suites are provably environmental there (differential above) and
  pass on the dev DB.

### Phase 9 file scope — 13 paths (5 modified, 8 created)

**Modified — 5:** this ledger · `supabase/config.toml` (**partial-stage: the
Phase-9 `marketing-provider-connections` entry ONLY — the Phone Operations
hunk stays working-tree-only**) ·
`supabase/functions/_shared/worker_handlers/index.ts` (one import + one
registry line) · `src/routes/marketing.tsx` (Connections panel wired into the
Ads section) · `src/lib/capability-registry.ts` (marketing.ads truth text +
version bump; STILL Preview).
**Created — 8:**
`supabase/migrations/20260906120000_marketing_provider_connections.sql` ·
`supabase/tests/marketing_provider_connections.test.sql` ·
`supabase/functions/_shared/marketing_provider_connections.ts` ·
`supabase/functions/_shared/worker_handlers/marketing_provider_sync.ts` ·
`supabase/functions/marketing-provider-connections/index.ts` ·
`scripts/marketing-connections-pure.test.mjs` ·
`src/lib/marketing/connections.ts` ·
`src/components/app/MarketingConnections.tsx`.
Concurrent phone-ops/telephony/product-review/run-checkpoint work stays
byte-for-byte outside this scope.

## 19 · Phase 10A — Provider Sync Hardening: Simulator, Boundary Closure, Operational Readiness (2026-08-01; BUILT + proven at every local boundary; UNCOMMITTED — checkpoint-ready)

**The functional loop is closed against a provider that cannot lie about
being real.** Phase 10A adds the deterministic `serviceos_test_provider`
simulator — an explicit test identity that is ABSENT from the production
connection catalogue (locked by the Phase-9 pure suite), refused by the API
unless the runtime environment explicitly enables it
(`MARKETING_TEST_PROVIDER=enabled`; local serve and automated tests only),
and therefore impossible to present as Meta / Google Ads / LinkedIn / Sheet.
Through it, the ENTIRE customer workflow now executes through the real code
paths: catalogue → create → Vault credential (mark-first) → connect →
worker-validated adapter handshake through the seam → bounded discovery →
governed external-account selection → initial/manual/scheduled-enqueued
syncs → contract-validated canonical facts → honest reporting → freshness →
partial failure → retry → poison → revocation → recovery.

Key structural additions (all `marketing_provider_%`, both-directions lock
extended additively to 17 — nothing weakened; the Phase-8 catalog lock
passes untouched):

- `marketing_provider_facts` — append-only, digest-converging (identical
  re-records insert NOTHING), revision-superseding (changed values append
  with `supersedes_id`; reads take max revision); honest time bounds (no
  future windows, 400-day horizon); spend structurally requires currency.
- `marketing_provider_fact_record` — recorded ONLY by a RUNNING run;
  strict shape; 500/batch ceiling.
- `marketing_provider_account_report` — every number reconcilable to facts:
  mixed currencies ⇒ `totals.spend` null + `mixed_currencies`; zero leads ⇒
  CPL null + `zero_leads`; absence ⇒ null + reason, NEVER zero; `degraded`
  = failed metrics with a usable feed; recovery clears only the error.
- `marketing_provider_account_external_select` — governed, versioned,
  only from the adapter-discovered bounded list of a CONNECTED account.
- `marketing_provider_sync_enqueue_due` — the scheduled seam completed:
  structurally idempotent under overlapping invocations (single-flight
  index + deduped drain job). **No cron is installed; nothing polls** —
  registration is a documented launch step (CONNECTIONS_RUNBOOK.md).
- Lifecycle: `connect_start` is adapter-aware (caller layer truthfully
  asserts adapter possession; true ⇒ `connecting` + ONE idempotent
  validation job for the worker; false ⇒ the recorded Phase-9
  error/`no_adapter`, unchanged). The seam alone still reaches `connected`,
  now optionally storing bounded discovery and queuing the initial sync
  (`queue_initial_sync`, default false = exact Phase-9 semantics).
  `sync_request` now ALSO primes the idempotent drain job (a REAL gap the
  served-HTTP journey exposed: manual runs previously had nothing to
  execute them). `revoke` retires queued runs as `account_revoked`.
  claim/complete stamp wall-clock (`clock_timestamp`) lease/terminal times
  so “latest terminal run” is total-ordered even inside one transaction.
- TS: `marketing_provider_adapter_contract.ts` (ONE adapter interface;
  normalised error taxonomy auth/scope/rate_limit/temporary/permanent/
  schema/internal with truthful retryability; `validateCanonicalFacts` —
  malformed canonical data cannot cross into the domain layer; env-gated
  registry where every REAL provider resolves null), the deterministic
  simulator (`marketing_test_provider.ts`, fixed fixtures, zero
  randomness), the `marketing.provider_connect` worker handler (validation
  relayed — never asserted — through the seam), the revised
  `marketing.provider_sync` handler (revocation re-check before provider
  access; retryable failures leave the run LEASED so lease expiry + the
  attempts>=10 ceiling govern retries; bounded drain continuation;
  computed outcomes — success is unreachable except off a genuine adapter
  result), Edge actions external_select/report/runs + the env gate.

### Verification (2026-08-01, synthetic fixtures + deterministic simulator only)

| Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL-BEFORE: Phase-10 SQL suite on the pre-migration dev DB (`provider must be one of meta/google_ads/linkedin/sheet`); Phase-10 pure suite before the contract module existed (module not found)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **FAILS first — the tests are real**                                                                                                                      |
| `supabase/tests/marketing_provider_hardening.test.sql` — 9 sections: vocabulary, adapter-aware connect (idempotent validation job), seam discovery bounds + initial-sync-once, governed selection, fact bounds/convergence/supersession/append-only, report reconciliation (101.50/5/20.30 exact) + mixed-currency/zero-lead/no-fact honesty + degraded↔healthy, scheduled-enqueue idempotency, revocation retiring queued work, cross-tenant + RLS + the 17-name both-directions catalog lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **PASS** on the dev DB AND the fresh clean chain (89 committed + Phase-10 FINAL bytes), run TWICE (double-run sensitivity)                                |
| Second application of the Phase-10 migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **fails loudly** — run-once                                                                                                                               |
| Phase-9 SQL suite (lock list extended additively to 17; drain/clock revisions absorbed with ZERO assertion weakening) + Phase-8 suite + admin/broadcasts/contacts/senders/sequences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **PASS** on the final clean chain (8/8 suites); dev DB identical except the §17b pre-existing environmental F6 stop, byte-identical before/after Phase 10 |
| `scripts/marketing-provider-hardening-pure.test.mjs` — contract refusals, registry gate (real providers NEVER resolve; simulator only under the env gate; ABSENT from the catalogue), simulator determinism + fixture reconciliation + honest taxonomy + schema-bad caught, worker/edge source discipline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **PASS** (14/14); Phase-8 pure 18/18 and Phase-9 pure 11/11 unchanged                                                                                     |
| `scripts/marketing-connections.test.mjs` — PostgREST boundary: all 14 callable `marketing_provider_%` RPCs refuse authenticated+anon (42501); browser insert/update/delete refused on all four tables; owner-sees/viewer-without-view-zero/tenant-B-zero; direct-id probe discloses nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **PASS (47 assertions)** against the real local PostgREST + GoTrue JWTs                                                                                   |
| `scripts/marketing-connections-http.test.mjs` — a genuinely SERVED local Edge runtime (`npx supabase functions serve --env-file <local env>`; env carries WORKER_SECRET + MARKETING_TEST_PROVIDER=enabled) + the REAL platform-worker driven over HTTP (`x-schedule-secret`): CORS preflight; missing/malformed bearer; viewer forbidden; malformed body/action/key; safe error shapes (no stack/secret/service detail); Tenant A healthy (connect→discover 2→select→initial+manual sync→report 100.00/5/20.00→duplicate-request-id convergence→idempotent re-sync→credential rotation→incremental supersession 101.50/20.30→fresh); Tenant B degraded (feed survives, metrics_unavailable specific, spend null NEVER zero, recovery to healthy preserving feed); Tenant C failing+security (invalid credential NEVER connects, credential replay inert, revoke blocks sync, cross-tenant report/sync NOT_FOUND, runs empty); retry semantics (retryable failure leaves the run leased at attempt 1; forced lease expiry + worker tick burns attempt 2 — the attempts>=10 ceiling is SQL-proven) | **PASS (122 assertions) — TWO full deterministic rounds** (incl. the F-VQA1 regression lock)                                                              |
| `tsc --noEmit` / ESLint (changed files) / Prettier / migration order (91 files) / production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **PASS** (see §19 evidence commands)                                                                                                                      |
| POPULATED VISUAL QA — ACTUALLY PERFORMED (a project first): frontend dev server on the LOCAL stack (gitignored `.env.local`), genuine GoTrue owner session, SERVED Edge functions, seeded five-state fixture tenant (healthy+fresh w/ selected external account · degraded w/ metrics-specific error + surviving feed · error/invalid_credential · revoked · honest Meta preview). Verified wide desktop (1280×2400 full-page), laptop (1280×720), tablet (768×1024), mobile (375): layout/wrapping, status by TEXT not colour alone, aria-live credential announcement, aria-expanded report toggles, per-section retryable errors, unavailable-never-zero, on-screen report reconciliation (100 GBP / 5 leads / CPL 20 / feed 2), REAL UI interactions (credential form → worker sync succeeded; credential-less sync honestly failed `credential_missing`; destructive Revoke confirm proven both ways). Two findings found AND fixed (F-VQA1/F-VQA2). Deployed-environment visual QA remains a launch item                                                                                   | **PASS (local authenticated environment)**                                                                                                                |

### Real-provider adapter status (Step-5 classification — none conflated)

| Provider                | Status                                                                                                     | Exact blocker                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta                    | **unavailable** (preview catalogue entry only)                                                             | requires a Meta app + system-user token (external registration), reviewed Graph API adapter + official-docs scope verification with live credentials — none exist; product decision pending |
| Google Ads              | **unavailable** (preview catalogue entry only)                                                             | requires a Google Ads developer-token application (external process) + OAuth product decisions; no credentials exist                                                                        |
| LinkedIn                | **unavailable** (preview catalogue entry only)                                                             | requires LinkedIn Marketing API partner access (external process); no credentials exist                                                                                                     |
| Sheet (authenticated)   | **unavailable** (preview catalogue entry only)                                                             | depends on the Workspace-connection seam product decision; no adapter reviewed                                                                                                              |
| serviceos_test_provider | **adapter implemented — fixture tested** (deterministic simulator; env-gated; NEVER a production provider) | n/a — test-only by design                                                                                                                                                                   |

No provider is `connected` or `live verified`. No official-docs adapter work
was started because every real provider is blocked on external
registrations/credentials that cannot be obtained from the repository — the
prompt-mandated blockers are recorded above and in the runbook.

### Launch-readiness matrix

| Capability                                | Implemented                    | SQL            | Pure           | Served HTTP                 | PostgREST      | E2E            | Failure        | Security review | Visual QA      | Runbook | Live-provider  | Deployed |
| ----------------------------------------- | ------------------------------ | -------------- | -------------- | --------------------------- | -------------- | -------------- | -------------- | --------------- | -------------- | ------- | -------------- | -------- |
| Provider catalogue (honest)               | PASS                           | PASS           | PASS           | PASS                        | NOT APPLICABLE | PASS           | PASS           | PASS            | NOT RUN        | PASS    | NOT APPLICABLE | NOT RUN  |
| Connection lifecycle                      | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Credentials (Vault, rotation)             | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| External-account discovery/selection      | PASS                           | PASS           | PASS           | PASS                        | NOT APPLICABLE | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Sync engine (manual/initial/retry/poison) | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Scheduled enqueue seam                    | PASS                           | PASS           | NOT APPLICABLE | NOT RUN (no cron by design) | NOT APPLICABLE | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Canonical facts + ingestion honesty       | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Reporting + freshness honesty             | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Revocation/reconnection                   | PASS                           | PASS           | PASS           | PASS                        | PASS           | PASS           | PASS           | PASS            | NOT RUN        | PASS    | BLOCKED        | NOT RUN  |
| Real provider adapters                    | FAIL (none exist — deliberate) | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE              | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE  | NOT APPLICABLE | PASS    | BLOCKED        | NOT RUN  |
| Production monitoring                     | defined, NOT activated         | —              | —              | —                           | —              | —              | —              | —               | —              | PASS    | BLOCKED        | NOT RUN  |

**Classification: `HARDENED — BLOCKED`** — the layer is functionally
complete and adversarially proven at every locally reachable boundary, and
is blocked from `LAUNCH-READY — PREVIEW` by: populated visual QA (needs an
authenticated deployed/preview environment), reviewed real-provider
adapters (external registrations/credentials), deployment, scheduler
installation and monitoring activation.

### Security & concurrency review (adversarial pass; every finding closed or pre-proven)

Verified in this phase's suites: cross-tenant connection/run/report/sync
probes read NOT_FOUND or zero (SQL + PostgREST + served HTTP); browser
writes refused on every table; all 17 functions service-role-only, INVOKER;
credential request replay (simultaneous-safe via the gate's advisory lock)
never rotates or re-reveals; the secret's single egress is the Vault store
(source-locked); Vault-write-fails-after-mark fails closed (re-rotation
recovers); duplicate scheduler/enqueue invocations cannot double-queue
(structural); duplicate worker claims cannot double-lease (FOR UPDATE SKIP
LOCKED, proven Phase 9); worker restart = lease expiry reclaim (proven at
the served boundary); revocation while queued retires runs, while running
is re-checked before provider access; forged discovery entries refused
(bounded shape); fact forgery bounded by run-must-be-running + tenant FK +
digest identity; oversized batches refused at BOTH the contract and the
recorder. One REAL defect was found by the served-HTTP journey and fixed
with a regression lock in that suite: manual sync runs had no drain job
(severity: medium, functional not security). No open critical/high finding.

### Honest limitations

- Populated visual QA ran against the LOCAL authenticated stack (a first);
  deployed-environment visual QA (Vercel Preview + operator session)
  remains a launch item. The QA fixture tenant leaves bounded residue on
  the local dev DB (append-only ledgers), like every phase's fixtures.
- The simulator exercises the real pipeline but is not a real provider;
  provider-shaped quirks (pagination, OAuth refresh, webhook challenges)
  remain adapter work (10B).
- The scheduler is a proven seam + documented install step; NOTHING polls
  in this build.
- mjs boundary suites leave bounded tenant-scoped fixture residue on the
  dev DB where append-only ledgers forbid deletion (same as every phase).
- The served-HTTP suites ran against a locally served Edge runtime — this
  closes the "served HTTP" gate for LOCAL evidence; deployed-environment
  verification remains a launch gate.

### Phase 10A file scope — 20 paths (11 modified, 9 created)

**Modified — 11:** this ledger · `supabase/functions/marketing-access/index.ts` + `src/lib/marketing/access.ts` (F-VQA1 — proven bug fix) · `src/components/app/MarketingAds.tsx` (F-VQA2 — proven visual fix) ·
`supabase/tests/marketing_provider_connections.test.sql` (catalog lock
extended additively to 17 — both directions preserved) ·
`supabase/functions/_shared/worker_handlers/marketing_provider_sync.ts` ·
`supabase/functions/_shared/worker_handlers/index.ts` (one import + one
registry line) · `supabase/functions/marketing-provider-connections/index.ts`
· `src/lib/marketing/connections.ts` ·
`src/components/app/MarketingConnections.tsx` ·
`src/lib/capability-registry.ts` (truth text + version; STILL Preview).
**Created — 8:**
`supabase/migrations/20260907120000_marketing_provider_sync_hardening.sql` ·
`supabase/tests/marketing_provider_hardening.test.sql` ·
`supabase/functions/_shared/marketing_provider_adapter_contract.ts` ·
`supabase/functions/_shared/marketing_test_provider.ts` ·
`supabase/functions/_shared/worker_handlers/marketing_provider_connect.ts` ·
`scripts/marketing-provider-hardening-pure.test.mjs` ·
`scripts/marketing-connections.test.mjs` ·
`scripts/marketing-connections-http.test.mjs` ·
`docs/product/marketing-crm/CONNECTIONS_RUNBOOK.md`.
`supabase/config.toml` is NOT touched this phase. Concurrent
phone-ops/telephony/product-review/run-checkpoint work stays byte-for-byte
outside this scope.

## 21 · Phase 10B — Meta Provider Adapter V1 (2026-08-01; ADAPTER IMPLEMENTED — FIXTURE TESTED — NOT LIVE VERIFIED; UNCOMMITTED — checkpoint-ready)

**The first genuine provider vertical slice.** Full design, official-contract
record (7 developers.facebook.com documents, checked 2026-08-01, pinned Graph
API v26.0), credential lifecycle, sync strategy, V1 scope/exclusions,
Meta runbook and monitoring additions: **META_SETUP.md** (the authoritative
companion to this section). No genuine Meta request was made; no credential
exists in this environment; nothing claims connection or live verification.

Key structural facts:

- Adapter behind the UNCHANGED Phase-10A contract; two additive contract
  fields only: `fetchFacts.sinceIso` (incremental window input, passed by
  the sync worker from `last_synced_at`) and
  `ProviderAdapter.requiresExternalAccount` (Meta: true — the worker fails
  runs honestly as `no_external_account` BEFORE any provider access when no
  ad account is selected; found by the fixture journey when the seam-queued
  initial sync ran pre-selection as an opaque `provider_rejected`).
- Registry: meta resolves the reviewed adapter always; the env gate governs
  ONLY whether `meta-fixture:*` credentials resolve to contract fixtures —
  in production a fixture credential is STRUCTURALLY an invalid credential.
- Catalogue: new `verification` field (`none | fixture_tested |
live_verified`) — meta = `fixture_tested`; nothing is `live_verified`;
  this is adapter status, never a tenant connection state. UI renders
  "Adapter implemented — fixture tested — not live verified." on the Meta
  readiness card.
- LOCK EVOLUTIONS (documented, nothing weakened): the Phase-9 pure
  catalogue lock ("zero adapters") and the Phase-10A registry lock ("real
  providers never resolve") now assert the NEW exact truth (meta
  implemented/resolving; google_ads/linkedin/sheet still locked to none;
  live_verified locked to impossible).
- ZERO SQL changes: vocabulary, lifecycle, facts, reporting and locks are
  untouched — the Phase-10A clean-chain proof stands byte-identical; SQL
  suites re-run green on the dev DB.

### Verification (2026-08-01; deterministic META CONTRACT FIXTURES — NOT LIVE DATA)

| Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Result                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAIL-BEFORE: `scripts/marketing-meta-pure.test.mjs` before the adapter module existed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **FAILS first** (module not found)                                                                                                                                                             |
| Meta pure suite — registry/catalogue truth, fixture gate structurally closed in production, validation + discovery evidence, invalid(190/463)→auth, noscope(10)→scope, two-page cursor harvest, ad set→ad_group mapping, spend-string parsing, lead-action summing, fixture reconciliation (100.00 GBP / 5), incremental determinism, degraded partial-metrics, BUC rate-limit + retry_after_minutes, page-two all-or-nothing, schema drift caught, token never in any diagnostic, source scans (bearer-header only, no token in URLs, cursors not next-URLs, no logging, bounded paging)                                                                                                                                                                                                            | **PASS (19/19)**                                                                                                                                                                               |
| `scripts/marketing-meta-http.test.mjs` — the complete journey over the SERVED Edge boundary + the real platform-worker, TWO deterministic rounds: catalogue truth over HTTP; token stored once/never echoed; connect → worker validation → connected ONLY after adapter verification; two discovered accounts (currency-labelled); selection; initial sync; report reconciles (100.00 GBP / 5 / CPL 20.00 / 2 campaigns; ad_group + ad facts present); repeat sync idempotent; restatement supersession (101.50 / 20.30); unselected sync fails honestly `no_external_account`; degraded (feed survives, metrics-specific error, recovery); invalid + noscope NEVER connect; rate limit leaves the run LEASED at attempt 1 with zero facts ingested; revoke blocks sync; cross-tenant NOT_FOUND/zero | **PASS (96 assertions, both rounds)**                                                                                                                                                          |
| Regressions: 10A simulator HTTP suite (122) · PostgREST boundary (47) · P10A/P9/sequences SQL on dev · P8 SQL (same pre-existing §17b environmental stop, byte-identical) · P8/P9/P10A pure (18/11/14) · tsc · eslint · prettier · production build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **ALL PASS**                                                                                                                                                                                   |
| ACTUAL VISUAL QA (local authenticated stack, served functions, fixture gate on): Meta readiness card renders the exact classification + external requirements; full UI journey — create meta connection → token via the credential form (aria-live confirmation) → Attempt connect → worker → Connected → discovery selector ("Drummond Heating Ads (GBP)" / "Secondary Fixture Ads (USD)") → select GBP → Sync now → report on screen (Health healthy · Spend 100 GBP · Leads 5 · CPL 20 · Campaign feed (2) · run history); desktop full-page capture; mobile 375px zero horizontal overflow                                                                                                                                                                                                       | **PASS** (deployed-environment QA remains a launch item)                                                                                                                                       |
| Live verification (Step-14 gate)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **NOT RUN — no Meta app/system-user token exists in this environment (external registrations)**; the permitted read-only sequence is documented in META_SETUP.md, ready when credentials exist |

### Security review (Phase 10B additions)

Token redaction proven at every layer (pure lock: token in no diagnostic;
HTTP lock: token never echoed; source locks: bearer-header only, no URL
parameters, no logging, paging.next never fetched); fixture mode
structurally impossible in production (auth-refused, pure-locked);
`no_external_account` refusal happens BEFORE provider access; rate-limit
backoff never completes runs as fabricated success or degraded; error
bodies bounded + sanitised with `fbtrace_id` as the only correlation
carrier. One workflow defect found by the journey and fixed with locks: the
pre-selection initial sync surfaced an opaque `provider_rejected` — now the
honest `no_external_account` class (regression-locked in the HTTP suite).
No open critical/high finding.

### Phase 10B file scope — 15 paths (10 modified, 5 created)

**Created — 5:** `supabase/functions/_shared/marketing_meta_adapter.ts` ·
`supabase/functions/_shared/marketing_meta_fixtures.ts` ·
`scripts/marketing-meta-pure.test.mjs` · `scripts/marketing-meta-http.test.mjs`
· `docs/product/marketing-crm/META_SETUP.md`.
**Modified — 10:** this ledger ·
`supabase/functions/_shared/marketing_provider_adapter_contract.ts`
(registry + two additive contract fields) ·
`supabase/functions/_shared/marketing_provider_connections.ts` (catalogue
truth + `verification` field) ·
`supabase/functions/_shared/worker_handlers/marketing_provider_sync.ts`
(`sinceIso` + `no_external_account`) · `scripts/marketing-connections-pure.test.mjs`

- `scripts/marketing-provider-hardening-pure.test.mjs` (documented lock
  evolutions) · `src/lib/marketing/connections.ts` ·
  `src/components/app/MarketingConnections.tsx` (readiness label + honest
  copy) · `src/lib/capability-registry.ts` (truth text + version; STILL
  Preview) · `docs/product/marketing-crm/CONNECTIONS_RUNBOOK.md` (Meta
  pointer + `no_external_account` row).
  `supabase/config.toml` untouched; NO migration; concurrent
  phone-ops/telephony/product-review/run-checkpoint work stays byte-for-byte
  outside this scope.

## 22 · Resend email activation + sandbox closure (2026-08-02/03; SANDBOX TEST-READY — REAL PROVIDER SUBMISSION `NOT RUN`)

Operator-facing document: **[RESEND_SETUP.md](RESEND_SETUP.md)**. Read that
first; this section is the build/verification ledger behind it.

### 22a · Commits

| Commit    | What                                                                        |
| --------- | --------------------------------------------------------------------------- |
| `a48f11b` | Resend transport + open/click tracking (migrations `20260908120000/120100`) |
| `c77dcb6` | Resend sender enables the send capability on creation (`20260908120200`)    |
| `f634b7c` | Adversarial hardening (`20260908120300`)                                    |
| _this_    | **Sandbox activation closure** (`20260908120400`)                           |

The four earlier migrations are **applied to staging and immutable**. The
closure migration is additive and idempotent; no applied migration was edited.

### 22b · FIXTURE PROOF EXPLICITLY RETRACTED

The `a48f11b`/`c77dcb6` staging run recorded a "successful send" with
`RESEND_API_KEY=fixture`. The transport treated that magic value as success and
**fabricated a synthetic message id without contacting Resend**. That evidence
proved nothing about Resend and is **withdrawn in full**, along with every claim
that rested on it (provider acceptance, provider message ids, delivery, and any
tracking round-trip against a "real" message). The fixture branch is gone from
the deployed path; tests inject a mock `fetch`, and a missing/blank/malformed/
non-`re_` key fails closed with **no network call** and no success.

### 22c · CRITICAL open-redirect correction

The first tracking build redirected a click to the request-supplied `u=`
whenever any token was present — an open redirect usable for phishing behind a
first-party URL. Corrected in `20260908120300`: v2 tokens HMAC-bind
`delivery id + event kind + exact canonical destination`; an open token is not a
click token; **any** failure redirects only to a fixed neutral first-party
fallback with **zero database writes**; destinations are https-only, no
credentials, no control characters, no self-wrapping, bounded before any HMAC
work, and duplicate query parameters are refused.

### 22d · Defects this closure pass corrected

| #   | Confirmed defect                                                                                                                                                                                                                                                               | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The staging sender created before hardening still recorded `send_scope_state='authorized'` with a `last_verified_at` stamp — a false claim                                                                                                                                     | `20260908120400` §A1 converges every existing Resend sender: sandbox → `unknown` + `last_verified_at` NULL + canonical sandbox `verification_note`; any other address → **disabled**, unavailable, history preserved, change audited; tenant-safe, deterministic, idempotent, and a no-op when no Resend sender exists                                                                                                                                                                                                          |
| 2   | The sandbox sender could be test-sent to **any** same-tenant profile — "test-to-self" was asserted, never enforced                                                                                                                                                             | `evaluateSandboxSelfSend` at the final pre-provider boundary proves purpose `test`, `recipient_profile_id === actor_profile_id`, same tenant, recipient email still the frozen envelope address, and the actor's own current profile email present + valid + identical. Every mismatch refuses **before** the provider call — zero network requests. Never delegated to Resend's own sandbox rejection                                                                                                                          |
| 3   | A valid leaked tracking token could drive one `UPDATE` per request, indefinitely (saturating counters bounded the _value_, not the _work_)                                                                                                                                     | Write-once recorder: `SELECT` probe first, duplicate events perform **zero writes**, lifetime budget ≤ 1 INSERT + 1 open UPDATE + 1 click UPDATE, `CHECK (open_count/click_count between 0 and 1)` makes over-counting unrepresentable, concurrent duplicates converge                                                                                                                                                                                                                                                          |
| 4   | Raw total-event analytics were reported without governed rate-controlled evidence                                                                                                                                                                                              | `total_open_events`/`total_click_events` removed; summary reports unique-delivery evidence plus `total_event_analytics: "not_collected"`; `last_click_url` frozen and superseded by write-once `first_click_url`                                                                                                                                                                                                                                                                                                                |
| 5   | Token lifetime was undecided                                                                                                                                                                                                                                                   | **Explicit decision: no expiry.** Tokens live with the delivery (a sent email lives in a mailbox indefinitely; an expiry would discard legitimate later evidence and add clock skew). The safety property is provided structurally by the write-once bound and proven under concurrency and a valid-token flood                                                                                                                                                                                                                 |
| 6   | `supabase/functions/_shared/marketing_tracking.ts` contained literal NUL/`0x1F`/`0x7F` bytes, so Git treated it as **binary**                                                                                                                                                  | Replaced with escaped source notation `\u0000-\u001F\u007F`; the file is NUL-free, Git counts it as 143 text lines, TypeScript/Prettier/ESLint parse it, and unsafe control-character URLs are still rejected                                                                                                                                                                                                                                                                                                                   |
| 7   | UI/doc falsehoods: `Enabled (verified sender)` for a sandbox, `gmail.send:` on Resend rows, `submitted to Gmail` on the Resend transport, "No campaign or bulk sending exists yet", "a verified from-address … immediately usable", "Click tracking is NOT implemented at all" | Five honest sender classes (`gmail_verified` / `workspace_verified` / `resend_sandbox_test_ready` / `resend_production_verified` / `unavailable`); sandbox rows carry **Sandbox test-ready**, **Test-to-self only**, **Campaigns and sequences blocked**, **Real provider submission not yet verified**, plus a missing-key failure pill; `gmail.send` language confined to Google rows; success is "submitted to Resend"; `RESEND_SETUP.md` created; `SENDER_SETUP.md`/`BROADCAST_SETUP.md` corrected with dated supersessions |
| 8   | Tracking-secret configuration failure was silent                                                                                                                                                                                                                               | `isUsableTrackingSecret` (≥32 chars) applied on BOTH sides — the adapter refuses to sign, the endpoint refuses to verify — so a misconfigured deployment fails closed instead of pretending to track. The secret is never logged or echoed                                                                                                                                                                                                                                                                                      |

### 22e · Regression coverage added

`scripts/marketing-resend-pure.test.mjs` (extended), plus new
`scripts/marketing-tracking-sql.test.mjs` and `scripts/marketing-track-http.test.mjs`:

- sandbox **self-recipient success** through an injected provider response;
- refusals — another tenant user, a cross-tenant profile, a changed actor email,
  a changed recipient email, a missing actor email, and campaign + sequence
  attempts — **each asserting zero provider calls**;
- control-byte-free source scan and unsafe-URL rejection;
- bounded tracking: duplicate open/click ⇒ zero writes (`xmin` unchanged),
  concurrent duplicates converge, a valid-token flood creates no amplification,
  `CHECK` rejects over-counting;
- tracking endpoint: forged / missing / wrong-kind / altered-destination /
  malformed / duplicate-parameter requests never redirect to the supplied
  target, invalid clicks take the fixed neutral fallback, invalid opens return
  the neutral pixel, invalid requests write nothing, and a valid
  destination-bound click redirects correctly and records at most the bounded
  unique evidence.

### 22f · Still `NOT RUN` (unchanged by this pass)

- **Real provider submission** — `NOT RUN`. No request has reached `api.resend.com`.
- **Inbox delivery** — `NOT RUN`.
- **Campaign handshake over Resend** — `NOT RUN`, and structurally refused for
  the sandbox sender.
- **Open/click round-trip against a genuinely delivered message** — `NOT RUN`;
  all tracking proofs use synthetic deliveries.
- **Staging tracking-secret strength** — the management API exposes a digest
  only, so the ≥32-character bar is asserted by configuration on staging, not
  observed there (it is observed locally).
