# Templates, Objectives & Reporting, AI Drafting — setup & operations (Marketing Phase 7)

_What has to be TRUE in an environment before each Phase-7 surface is real —
and what is honestly NOT proven until it is. Locally, Phase 7 is proven with
the real SQL engine RPCs and MOCKED provider results: **no model request of
any kind has ever been made by this code, and no email has ever been sent.**_

## What Phase 7 is

One campaign content and evidence layer:

```
versioned Template ─┐
                    ├─→ human-authored revision → Campaign draft/revision
governed AI proposal┘        (the EXISTING campaign approval & delivery path —
                              Phase 7 adds no second transport, ever)

Campaign → verified Objective relationship (canonical objective_links)
        → canonical campaign/delivery/enrolment facts → honest reporting
```

- **One safe content model.** Template revisions and AI proposals store exactly
  the Phase-5 authored shape (subject / preview_text / body_authored /
  token_fallbacks) and every write passes `marketing_campaign_validate_content`
  — the same validator Broadcasts and Sequence email steps use. No template
  language, no HTML in, no scripts, no provider parameters.
- **Pinning.** Using a Template copies an EXACT revision into campaign content
  and records the lineage (`source_template_revision_id`); a lineage claim
  must byte-match its source or it is rejected, so provenance can never lie.
  Later template edits never change a pinned campaign; using a template never
  bypasses review/approval/preflight.
- **Objectives.** A Campaign↔Objective link is a canonical `objective_links`
  row (`target_kind = 'marketing_campaign'`, additive registry extension with
  its own same-tenant validator). A link records INTENT only. Verified
  contribution continues to come exclusively from the Objective engine's
  append-only contribution assessments and their measurement-evidence rules —
  sends, opens and clicks never create a measurement, never move health, and
  never fabricate an outcome.
- **Reporting.** `marketing_reporting_overview/_campaign` COMPOSE the canonical
  `marketing_campaign_report` / `marketing_sequence_report` — no second status
  truth exists. Unknown is not zero: delivered/opened/clicked/bounced are
  `null` with a reason until a real evidence pipeline exists; "submitted"
  means provider acceptance, never delivery.
- **AI drafting creates PROPOSALS only.** The brief freezes into an immutable
  Automation Intent (`generate_marketing_draft` on the governed
  `ai.generate_marketing_draft` capability); the ONE registered adapter makes
  one bounded provider call; output must pass the exact schema gate AND the
  canonical content validator; the original proposal is immutable; human edits
  are numbered revisions; acceptance writes DRAFTS only and structurally
  invalidates any prior approval on the destination. Acceptance can never
  approve, launch or send.

## Model provider configuration (required before ANY generation)

Without configuration, AI Drafting shows **Not connected / Configuration
required**, `request_generation` refuses with `CONFIG_REQUIRED`, and nothing
is ever faked. To configure (owner/admin holding `marketing.ai.manage`, via
Campaigns → AI Drafting → Configure, once deployed):

1. **Model** — the provider model identifier (e.g. `gpt-4o-mini`).
2. **API key** — written STRAIGHT into the tenant Vault broker
   (`provider_secret_store('openai','api_key')`); only the opaque Vault
   reference is kept in `tenant_connectors.settings.secret_ref`. The key is
   never echoed, logged, or readable from any client.
3. Enablement flips `tenant_connector_capabilities`
   (`openai` / `ai.generate_marketing_draft`) — the registry the frozen
   Automation Engine itself enforces at execution time.

Runtime requirements beyond configuration:

- **Operational mode.** The generation intent mirrors the Phase-4 delegated
  test-send package: honestly IRREVERSIBLE (provider egress + spend cannot be
  recalled), so the engine's Operational-Mode re-check withholds execution in
  modes that require reversibility. In `discovery`/lower modes a request is
  accepted, queued, and parked mode-blocked with its real reason — correct
  behaviour, not a bug.
- **Cost bounds.** Requests are DB-rate-limited (3/minute, 20/hour per
  tenant); each intent is bounded to `max_attempts = 3` and expires after one
  hour, so bounded retries can never generate unbounded provider cost. Token
  usage (prompt/completion) is recorded on every proposal.
- **The paid-call boundary (audit-hardened, 2026-07-31).** Retry semantics
  split at the provider call. BEFORE the provider answers (fail-closed reads,
  network loss, 429/5xx) failures are bounded transients — nothing external
  happened, so re-running is safe. AFTER a successful provider call the spend
  is a fact: a recorder/persistence failure retries the idempotent
  `marketing_ai_record_proposal` RPC once in-place and otherwise returns
  **`unknown`**, which the frozen engine parks (`external_result_unknown`,
  never blind-retried, routed to review). One logical generation request can
  never automatically buy a second provider call because the database
  blinked. If the recorder committed and only its response was lost, the
  derived request status reads `succeeded` from the proposal fact; otherwise
  the request shows `unknown` honestly and only an explicit human
  "generate again" (a NEW request + intent + rate-limit slot) reaches the
  provider again.
- **Provider origin (SSRF surface).** The adapter can reach exactly ONE
  endpoint: the fixed `OPENAI_CHAT_URL` constant
  (`https://api.openai.com/v1/chat/completions`). No base URL is
  configurable anywhere (tenant `model` is a bounded identifier,
  `^[A-Za-z0-9._:-]{1,80}$` — it cannot carry a URL), no environment
  fallback exists (conformance gate (k) forbids `Deno.env`/`OPENAI_API_KEY`
  in the adapter), method/headers/body are adapter-fixed, the request runs
  under an abort-signal timeout, and the credential resolves server-side
  through the tenant-scoped Vault broker only (`provider_secret_read`
  derives the secret name from the engine-supplied tenant id; the stored
  `secret_ref` is presence-only and never used to fetch). Adding any second
  provider requires a NEW reviewed adapter — a provider catalogue/origin
  allowlist decision at that point, never a user-supplied URL.
- **No autonomous send.** Nothing in this phase transmits to a recipient. A
  generated draft reaches a human inbox only after a person accepts it into a
  draft, a senior approves the campaign, preflight passes, and the launch
  confirmation is used — the untouched Phase-5/6 path.

## Prompt/data safety (what is and is not claimed)

The prompt builder (`_shared/marketing_ai_prompt.ts`, `marketing-draft@1`) is
deterministic and versioned: fixed instructions in the system message (never
tenant data), the tenant brief in a delimited untrusted-data block, exact
accepted keys, hard bounds, no recipient lists, no contact PII, no
credentials, no cross-tenant context (only an explicitly selected Objective's
title is shared). **Prompt injection is not claimed to be impossible.** The
enforced boundary is what LEAVES the model: output must match the exact
4-field schema and pass the canonical Marketing validator, model output can
never set sender/recipient/approval/launch/suppression/provider parameters,
provider refusals are preserved honestly, and malformed/truncated output is a
stable failure — never partially accepted content.

## Template mutation request ids (correction pass, 2026-07-31)

Every template MUTATION — create, revise, duplicate, archive, restore,
use-in-broadcast, use-in-sequence-step — requires a client `request_id`
matching `^[A-Za-z0-9_-]{8,64}$`, ledgered through the canonical
`marketing_request_keys` mechanism. Semantics:

- The fingerprint binds tenant, the genuine actor, the action, the source
  template/revision, the destination campaign/sequence/step, the expected
  version and every semantic argument — never clocks or credentials.
- The ledger is consulted BEFORE the version/status gates: a byte-identical
  replay returns the ORIGINAL stored result even if the resource has since
  advanced (a lost-response retry can never mint a second template, revision,
  duplicate, campaign, sequence revision, step or usage row).
- Reusing an id with ANY change — payload, expected version, or a different
  actor — is refused with `MK412` / `REQUEST_MISMATCH`. Distinct ids keep the
  normal `MK409` version-conflict behaviour.
- Clients rotate keys whenever semantic input changes and reuse the key for
  an unchanged retry (the UI keys requests by semantic scope and clears the
  scope on success).
- AI acceptance derives its internal template mutation's key SERVER-SIDE as a
  deterministic namespaced child of the governed accept request
  (`substr(md5('ai-accept-child:' || <accept request id>), 1, 32)`). The
  browser can never supply a child key, an accept replay converges on the one
  template, and a browser reuse of the child key value conflicts because its
  fingerprint can never match (the Edge create path cannot carry AI lineage).

## Objective evidence rules (unchanged, restated)

Linking a campaign means only "this campaign is intended to support this
objective". The link surface never: appends a measurement from
sends/opens/clicks; marks an objective healthier; claims revenue, jobs,
quotes or conversions; creates or upgrades a contribution assessment; infers
causation from engagement. The Reporting tab displays the latest canonical
health snapshot (with freshness; missing = "never evaluated", stale is
labelled stale), primary-metric values only when units/currencies genuinely
agree (mismatch = unknown with the exact reason), and the contribution state
only from `objective_contribution_assessments` — otherwise the explicit line
"No verified contribution evidence".

**Relation vocabulary determination (audit, 2026-07-31).** Both permitted
campaign relations — `supports` and `contributes_to` — are INTENT vocabulary
under the canonical model, and permitting both is safe: the canonical
evaluator (`objective_evaluate.ts`) consumes them IDENTICALLY as
expected-contribution candidates (gated on `approved` + verified link
states), a new link always starts `contribution_state = 'proposed'`, and
`contribution_confirmed` is structurally impossible while the platform's
outcome-evidence registry is empty (the evidence boundary downgrades
would-be confirmations to `inconclusive`). The committed work-transition
path already writes `contributes_to` links at intent time — the campaign
path introduces no new claim strength. Factual contribution appears ONLY
through the append-only assessment history, never from the relation word.

## Unsupported metrics

Delivered, opened, clicked and bounced have NO evidence pipeline in this
phase: they are reported as `null` with a reason and rendered "Unavailable",
never zero. Replies count only where canonical thread evidence exists
(sequences). No Ads spend/CPL appears anywhere in Phase 7.

## Required deployment steps (in order)

1. **Database**: apply
   `supabase/migrations/20260904120000_marketing_templates_reporting_ai.sql`
   (after the committed Phase 0–6 chain). Run-once; additive; extends the
   `objective_links.target_kind` registry additively and closes the legacy
   `marketing_campaigns.objective_link_ref` placeholder to new writes.
2. **Functions**: deploy `marketing-templates`, `marketing-reporting`,
   `marketing-ai-drafts`, and REDEPLOY the shared worker bundle
   (`platform-worker` and every function embedding `_shared/`) so the
   `marketing_ai_draft` adapter exists at runtime.
3. **Provider**: an owner/admin configures model + API key (above). No
   platform-level default key exists and the phone pipeline's global
   `OPENAI_API_KEY` is deliberately NOT used — tenant Vault only.
4. **Operational mode** permitting irreversible external work for generation
   to actually execute.
5. **Explicit authorisation**: the first real generation on a deployed
   environment is a human decision. Nothing performs one implicitly.

## Verification runbook (local)

```bash
docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_templates_reporting_ai.test.sql
node --test scripts/marketing-templates-ai-pure.test.mjs
node scripts/marketing-templates-ai.test.mjs      # needs local stack + service key
node scripts/marketing-phase7-http.test.mjs       # NOT-RUN/exit 3 without a served runtime
bash scripts/intelligence-conformance.sh          # incl. gate (k), the AI-adapter contract
```

## What stays honestly unproven until a served environment exists

- Authenticated Edge HTTP contracts for all three Phase-7 functions
  (`scripts/marketing-phase7-http.test.mjs` exits 3 NOT-RUN locally).
- Populated visual QA of the Templates / Objectives & Reporting / AI Drafting
  tabs (the access gate fail-closes without a served runtime).
- Any real provider behaviour: **no model request has ever been made** — every
  local proof stubs the provider at the engine boundary or mocks `fetch` in
  the pure suite. The AI Drafting runtime state is Not connected until an
  owner/admin configures a provider on a deployed environment.
