# Slack Integration Design — identity discovery first (Discover → Review → Confirm → Use)

**Status:** design + local proof only. **No OAuth requested, no Slack app created, no workspace connected, no messages ingested, nothing deployed.**
**First usable outcome:** discover **staff identities**, not conversations. Slack contributes *evidence to a canonical person*; it never becomes a second staff directory. A Slack user id is **never** a canonical person id.

## 1. Adapter + canonical normalisation

Same provider-neutral split as telephony/email:

- **Adapter (evidence boundary):** `supabase/functions/_shared/slack/slack_users.ts` — understands the Slack `users.list` shape and normalises it to a provider-neutral `NormalizedSlackUser` (`slack_user_id`, `team_id`, `handle`, `display_name`, `real_name`, `email`, `title`, `tz`, `deactivated`, `is_guest`, `image_ref`, `classification`). Slack field names (`is_bot`, `profile.display_name`, `deleted`, `USLACKBOT`) live only here.
- **Classification:** `classifySlackUser` → `person | bot | app | system`. Slackbot (`USLACKBOT`) = system; `is_bot`/`profile.bot_id` = bot; `is_app_user` = app; else person. **Bots/apps/system are classified, never silently dropped, and never suggested as people.**
- **Canonical (provider-neutral):** `supabase/functions/_shared/controlplane/slack_identity.ts` — `suggestSlackIdentity` / `buildSlackCandidates` map a normalised user → a source-identity **candidate** against `team_members`, with confidence + evidence + provenance + ambiguity. Never auto-confirms.

```text
Slack workspace → Slack user → source-identity candidate → canonical team member → operator review → confirmed identity link
```

Read-only: the adapter parses records the caller fetched; it holds no token and never calls Slack.

## 2. Minimum OAuth scope matrix (phased; narrowest first)

Identity discovery needs **no channel or message scopes**. Token = a Slack **bot token** (OAuth v2 install by a workspace admin). Only the **Workspace Discovery** phase is requested in the first connection. (Phases: **Workspace Discovery** → identity; **Channel Discovery** → channels, separate; **Message Evidence** → bounded message content, later.)

| Scope | Phase | Reason | Data exposed | Risk | Consent |
|---|---|---|---|---|---|
| `team:read` | **Workspace Discovery** | workspace/team identity (id, name, domain) | workspace metadata | low | installer/admin |
| `users:read` | **Workspace Discovery** | user directory (the identity source) | user ids, handles, display/real names, title, tz, deactivated, guest flag, image | low–med (staff directory metadata) | installer/admin |
| `users:read.email` | **Workspace Discovery** | high-confidence identity match by verified email | staff email addresses | **medium (PII)** | admin |
| `channels:read` | Channel Discovery (separate) | public channel list + membership | public channel names/members | low–med | admin |
| `groups:read` | Channel Discovery (only if explicitly authorised) | private channel discovery | private channel names/members | high | admin + explicit authorisation |
| `channels:history` | Message Evidence (later) | bounded public message evidence | public message content | **high** | admin |
| `groups:history` / `im:history` / `mpim:history` | Message Evidence (later, authorised) | private/DM evidence | private/DM content | **high** | admin + explicit authorisation |

**Workspace Discovery total: `team:read`, `users:read`, `users:read.email`.** Nothing else. Channel/message scopes are deferred to separate, later approvals.

## 3. Connection model — REUSE existing integration tables (no new schema)

| Concern | Existing model |
|---|---|
| Non-secret connection | `provider_connections` (tenant_id, provider='slack', status, auth_mode='oauth', account_ref=team_id, non_secret_config, configured_fields, verified_at, revoked_at) |
| Non-secret config (jsonb) | `{ team_id, team_name, installation_id, oauth_subject, granted_scopes[], connected_by, connected_at, last_successful_sync, last_error }` |
| Secret (bot token) | **Vault** via `provider_secret_broker` (`provider_secret_store`/`read`/`revoke`, service-role only). **Token NEVER stored in `provider_connections` and NEVER exposed in OpenFolk** — only `has_secrets: boolean`. |
| OAuth PKCE state | `provider_oauth_states` (deny-all) |
| Lifecycle audit | `provider_connection_events` (provider_selected → credentials_configured → connection_tested → discovery_* → oauth_* → revoked) |
| Source identity link | `member_integration_identities` (provider `slack` already in the documented set) — created only on operator confirm |
| Endpoint | `communication_endpoints` (channel=`slack`, endpoint_kind=`slack_user`) |
| Review history | `endpoint_identity_reviews` (append-only) |

**Zero new tables.** The connection is tenant-scoped; discovery uses the service-role broker; tenant isolation is enforced by `tenant_id` on every row + RLS.

## 4. Discovery workflow — `discover.slack` (design; pure core implemented + tested)

Edge action (to be added to `openfolk-control-plane` when approved), read-only:

1. `requirePlatformOperator` (admin) — server-side.
2. Load `provider_connections` (tenant, 'slack'); **`canDiscoverSlack` precheck** → **fail closed** on missing/revoked/not-ready (no candidates, no error surface). *(implemented + tested)*
3. Read the bot token via `provider_secret_read` (Vault; never returned).
4. Call Slack `users.list` **read-only**, paginated + bounded.
5. `normalizeSlackDirectory` (adapter) → classify; **exclude bots/apps/system** from person suggestions. *(implemented + tested)*
6. Upsert person users into `communication_endpoints` (channel=slack, kind=slack_user, `metadata`={team_id, real_name, email_present, title, tz, deactivated, is_guest}) — **endpoints only, never ownership**.
7. `buildSlackCandidates(members, confirmedSlack, memberEmails)` → suggestions with confidence/evidence/provenance/ambiguity; **preserve unresolved + ambiguous**. *(implemented + tested)*
8. Write a discovery-run summary to `controlplane_change_log`.
9. **Never** confirm automatically; **never** write a `member_integration_identities` link without an operator `identity.review`.

Idempotent (dedupe on `slack_user_id`). Confirm reuses the existing `cp_review_identity` RPC (provider becomes `slack`, external_ref = slack_user_id).

## 5. Candidate confidence rules (implemented)

| Situation | Result |
|---|---|
| bot / app / system user | `system` — never a person suggestion |
| existing confirmed Slack link on this user id | **high** (known), provenance `member_integration_identities` |
| verified Slack email == one member's **confirmed** email | **high** (still reviewable), `slack-verified-email` |
| email matches >1 member | **unresolved** + ambiguity |
| real/display name == one member's full name | **high** (reviewable), `slack-name-exact` |
| first name only matches one member | **medium**, `slack-firstname` |
| name matches >1 member (duplicate names) | **unresolved** + ambiguity |
| no email + no name match | **unresolved** |
| account deactivated | keeps its match but **flagged** ("deactivated in Slack — confirm before use") |

Email is cross-matched only against members' **confirmed** email identities — an unconfirmed email never contributes.

## 6. Person Intelligence Hub — Slack states

The Connected-systems Slack row supports:

| State | Meaning |
|---|---|
| `not connected` | no Slack connection for the tenant |
| `connection available` | connection configured, discovery not yet run |
| `discovery pending` | discovery running / queued |
| `candidate found` | a Slack user suggested for this actor (confirm/reject/replace) |
| `ambiguous` | Slack name/email matches >1 member — needs resolution |
| `confirmed` | operator-confirmed Slack identity link |
| `deactivated` | matched Slack account is deactivated |
| `revoked / error` | connection revoked or last sync errored |

For a **candidate** the row shows: workspace, Slack display name, real name, email (if available & authorised), title, active state, evidence, confidence, provenance, conflicts, and confirm/reject/replace controls. No Mary-specific UI — driven by data for any actor.

## 7. Local tests / fixtures

`supabase/functions/_shared/controlplane/slack_identity.test.ts` (10 tests, all passing) proves: exact-email match, name-only match, ambiguous duplicate names, deactivated user (flagged), bot/app/Slackbot excluded, no-email fallback, already-confirmed link, revoked/absent/not-ready connection (fails closed), cross-tenant isolation, and the full `buildSlackCandidates` pipeline (people suggested, bots classified-not-suggested, nothing silently dropped).

## 8. EXACT OAuth approval request (for your review — do not action yet)

> **Requesting approval to create a read-only Slack app for Drummonds — Workspace Discovery only (identity discovery).**
> - **App type:** Slack app installed to the Drummonds workspace by a **workspace admin** (OAuth v2, bot token).
> - **Scopes (Workspace Discovery only):** `team:read`, `users:read`, `users:read.email`. **No** channel scopes, **no** message/history scopes, **no** write scopes.
> - **Redirect URL:** the tenant-scoped OAuth callback (existing `provider-oauth-callback` pattern); PKCE via `provider_oauth_states`.
> - **Token storage:** Vault via `provider_secret_broker` (service-role only). Never shown in OpenFolk.
> - **What it can do:** read the user directory + emails to discover staff identity candidates. **It cannot** read channels or messages, post, invite, or modify anything.
> - **Data touched:** staff display/real names, emails, titles, tz, active state. No customer data. No message content.
> - **Consent:** a Drummonds Slack workspace admin approves the install.
>
> On approval I will: register the app, wire the OAuth callback + connection, run `discover.slack` (read-only), and surface candidates for your review — still confirming nothing automatically.

## Safety boundary (this increment)

No message content, no private-channel enumeration, no DM access, no posting, no invites, no profile/settings changes, and **no OAuth until the Phase-A matrix above is explicitly approved.**
