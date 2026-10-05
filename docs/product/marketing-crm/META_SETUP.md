# Meta Marketing API — Adapter V1 (Phase 10B)

**Status: `ADAPTER IMPLEMENTED — FIXTURE TESTED — NOT LIVE VERIFIED`.**
No genuine authorised Meta request has ever been made from this codebase; no
tenant is connected. Every test runs against deterministic
`META CONTRACT FIXTURE — NOT LIVE DATA` responses shaped from the official
contracts. The fixture gate (`MARKETING_TEST_PROVIDER=enabled`) exists only
in local serve/tests — in production a `meta-fixture:*` credential is
structurally refused as an invalid credential.

## Official contract record (all developers.facebook.com, checked 2026-08-01)

| Document                                                      | Fact verified                                                                                                                                                                                                                                                                                            | Adapter decision                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Graph API — Changelog                                         | latest v26.0 (released 2026-07-29); v25.0 expires 2028-07-29; ~2-year version lifespans; Marketing API auto-upgrade active                                                                                                                                                                               | **Pin `v26.0`** explicitly in every request path (`META_API_VERSION`)                                                                                                                                                                    |
| Marketing API — Authorization                                 | `ads_read` (reports) vs `ads_management`; Standard vs Advanced platform access; Marketing API tiers (limited/dev vs full after App Review: ≥500 calls/15 days, <15% errors); business verification for third-party data                                                                                  | V1 is READ-ONLY → **`ads_read` minimum**. App Review / advanced access is an **external launch gate**                                                                                                                                    |
| Facebook Login — Access Tokens + Marketing API — System Users | short-lived user tokens 1–2h; long-lived ~60 days; **system-user tokens** for programmatic ads work (Business Manager–scoped; expiry not stated on the checked pages → treated as unknown)                                                                                                               | V1 credential = operator-supplied **system-user token**; no refresh flow (`refreshCredential` unsupported); expiry surfaces honestly as auth failures; rotation is the recovery                                                          |
| Graph API — Results (pagination)                              | cursor paging (`paging.cursors.after`, `next` presence signals more); cursors must NOT be stored long-term; end detected by absence of `next`                                                                                                                                                            | cursors live only inside one run; **`paging.next` URLs are never fetched** (they echo request parameters); pages bounded (`MAX_PAGES=10`, `limit=100`)                                                                                   |
| Graph API — Rate Limiting                                     | BUC codes 80000–80014 (+ legacy 4/17/32), `X-Business-Use-Case-Usage` with `estimated_time_to_regain_access` (minutes); guidance: stop calling entirely                                                                                                                                                  | mapped to `rate_limit`/retryable with a `retry_after_minutes` diagnostic; the sync run stays LEASED (backoff), never completes as degraded                                                                                               |
| Graph API — Handling Errors                                   | `{ error: { message, type, code, error_subcode, fbtrace_id } }`; 190 auth (subcodes 458/460/463/467); 10 & 200–299 permission; 1/2 temporary; 100 invalid                                                                                                                                                | taxonomy mapping (auth/scope/rate_limit/temporary/permanent/schema); `fbtrace_id` kept as the safe correlation id; messages bounded + sanitised; the token appears nowhere                                                               |
| Marketing API — Insights + Best Practices                     | levels account/campaign/adset/ad; `time_increment=1`; spend/impressions/clicks/reach as strings; `actions=[{action_type,value}]`; `date_preset=maximum` ≈ 37 months; figures refresh 15 min and are **final after 28 days**; async jobs (`report_run_id`, expires 30 days); `x-fb-ads-insights-throttle` | daily **campaign-level** insights; **initial lookback 28 days**; incremental = since last sync **minus a 3-day correction overlap** (restatements converge through the recorder's digest/supersession); async insights jobs **deferred** |

## V1 scope

**Included:** token validation (`/me`), ad-account discovery
(`/me/adaccounts`, first page, ≤20, currency-labelled), external-account
selection (required — enforced honestly as `no_external_account` before any
provider access), campaigns, **ad sets → canonical `ad_group`** (explicit
semantic mapping), ads, daily campaign-level insights (spend, impressions,
clicks, reach in payload, account currency), **lead-class actions
(`lead`, `leadgen_grouped`, `onsite_conversion.lead_grouped`) summed into
canonical `leads`**; all other action types preserved verbatim (bounded, 25)
in the fact payload with `attribution: account_default` — no attribution
claim beyond the retrieved facts.

**Excluded (deliberate, not omitted):** lead-form retrieval (the Phase-8
signed webhook remains the lead-capture route), **Meta webhooks — DEFERRED**
(they require app review + subscriptions; polling is authoritative for
campaign/insight facts and stays so), creatives, comments/social
engagement, audience data, demographic breakdowns, attribution-window
selection, async insights jobs, business-manager-level discovery,
multiple selected ad accounts per connection, provider-side
`revokeConnection` (ServiceOS revocation stops all calls; Meta-side token
invalidation happens in Business Manager), `refreshCredential`.

## Credential lifecycle

Token enters ONLY through the existing authorised credential boundary
(`credential_set`: mark-BEFORE-Vault-write idempotency, replay never
re-stores or rediscloses, 86,400 s rotation overlap — valid for Meta since
it governs which copy WE read and claims nothing about Meta-side validity).
Storage: tenant Vault only (`mkt-conn-<account>`); rows carry references and
safe metadata only. Usage: workers read the token immediately before
provider access and pass it solely as an `Authorization: Bearer` header —
never a URL parameter, never logged, never echoed (locked by pure tests).
Account/business IDs are provider identifiers, not secrets. Revocation
blocks future calls (queued runs retired `account_revoked`; the worker
re-checks status before provider access). `connected` remains reachable
only through the worker-verified adapter seam.

## Sync strategy

Order: campaigns → ad sets → ads → daily insights. Initial lookback 28 days;
incremental window = (last sync − 3 days) → today, floored at 28 days;
history ceiling 37 months (backfill beyond 28 days is a future, explicitly
operator-triggered concern — not in V1). Pages: ≤10 × 100 per collection;
each collection is all-or-nothing (a page-two failure emits NOTHING for that
collection — replay is free because the recorder digest-converges).
Metrics failure after a good object feed → `metrics_unavailable` (degraded;
feed preserved). Rate limit → run stays leased (lease expiry + attempts≥10
poison ceiling govern retries). No cursor persists across runs.

## Runbook — Meta-specific

| Symptom                                                                       | Likely cause                                            | Safe diagnosis                                                           | Safe recovery                                                               | Prohibited                                       | Escalate                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| Connect fails `invalid_credential` (meta:190, subcode 463/460/467)            | token expired/revoked/password change                   | run history + version history reasons                                    | new system-user token → Rotate credential → Attempt connect                 | pasting tokens anywhere but the credential field | repeats with a fresh token       |
| Connect fails `missing_scope` (meta:10 / (#10)/(#200))                        | token lacks `ads_read` / app lacks Marketing API access | catalogue requirements vs Business Manager setup                         | re-issue token with ads_read; verify app access level                       | widening scopes beyond ads_read for V1           | App Review needed (external)     |
| App not approved / limited tier throttling                                    | Marketing API limited access                            | rate-limit events cluster immediately                                    | stay in fixture/preview until App Review completes                          | hammering retries                                | product decision on App Review   |
| No accessible ad account discovered                                           | system user not assigned to the account                 | discovery evidence count = 0                                             | assign the ad account to the system user in Business Manager; reconnect     | guessing act_ ids into selection                 | business access disputes         |
| Selected account removed / disabled (`account_status` ≠ 1, meta:100 on fetch) | account closed/disabled provider-side                   | run failures `provider_rejected`                                         | reconnect → rediscover → select a valid account                             | forcing syncs                                    | account genuinely disabled       |
| `rate_limited` runs                                                           | BUC throttling                                          | `retry_after_minutes` in run diagnostics                                 | wait — lease-driven retries back off; reduce cadence                        | tightening the retry loop                        | chronic throttling at low volume |
| Repeated pagination failure (`provider_unavailable`)                          | provider outage / oversized collection                  | which collection fails (diagnostics)                                     | retry later; collections are bounded to 1000 objects                        | raising MAX_PAGES ad hoc                         | persistent >24h                  |
| `schema_invalid` / `fact_rejected`                                            | provider schema drift or out-of-bounds facts            | the bounded diagnostic + fixture comparison                              | file adapter update; facts were quarantined, nothing partial ingested       | force-ingesting drifted payloads                 | any silent field change          |
| Insights totals moved after a sync                                            | official ≤28-day restatement                            | supersession history on the facts (revisions)                            | none — expected; report reads latest revisions                              | "correcting" facts manually                      | movement after 28 days           |
| Timezone/currency mismatch questions                                          | account timezone vs UTC dates                           | account currency/timezone captured at discovery                          | report per-account; mixed currencies stay unavailable rather than converted | ad-hoc FX conversion                             | product FX policy decision       |
| Suspected token exposure                                                      | —                                                       | audit_logs + Vault access review; the token never persists outside Vault | rotate immediately (new token), revoke old in Business Manager              | continuing use                                   | ALWAYS treat as an incident      |
| Poison run (`max_attempts_exhausted`)                                         | persistent retryable failure                            | prior attempts' diagnostics                                              | fix cause; request a NEW manual sync                                        | resurrecting the retired run                     | recurring on one account         |

## Monitoring contract additions (defined — NOT activated)

meta auth failures (`invalid_credential`) · missing-scope failures ·
discovery failures/zero-account discoveries · rate-limit events +
`retry_after_minutes` distribution · paging failures per collection ·
insights latency (window end → fact recorded) · `schema_invalid` /
`fact_rejected` counts · action-type drift (unknown action types seen in
payloads) · expired-token state (connections in error/invalid_credential) ·
disabled-account state · lead-action share (lead vs other actions).

## Live verification (Step-14 gate)

Not performed: no Meta application, system-user token or Business Manager
access exists in this environment (external registrations). The permitted
read-only live sequence (validate token → list ad accounts → bounded
campaign page → bounded insights range → shape comparison against these
fixtures) is documented and ready to run the day credentials exist.
