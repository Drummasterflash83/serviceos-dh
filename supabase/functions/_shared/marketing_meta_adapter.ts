// Marketing Phase 10B — the reviewed Meta Marketing API adapter (V1).
//
// STATUS: ADAPTER IMPLEMENTED — FIXTURE TESTED — NOT LIVE VERIFIED.
// No genuine authorised Meta request has been made; nothing here claims a
// connection. The adapter implements the official Graph API contracts
// (verified against developers.facebook.com on 2026-08-01) behind the
// Phase-10A provider contract, and is exercised end to end by deterministic
// META CONTRACT FIXTURES (marketing_meta_fixtures.ts).
//
// Official contract decisions (title · fact · decision):
//   • Graph API Changelog — latest version v26.0 (2026-07-29), ~2-year
//     lifespans → PIN v26.0 in every request path.
//   • Marketing API Authorization — ads_read suffices for this READ-ONLY
//     slice; advanced access / App Review is an EXTERNAL launch gate.
//   • Access Tokens & System Users — V1 credential is an operator-supplied
//     Business Manager SYSTEM USER token with ads_read. Expiry is treated as
//     unknown: auth failures (190 + subcodes 458/460/463/467) surface an
//     honest expired/invalid state; there is NO refresh flow in V1
//     (refreshCredential unsupported — rotation is the recovery, via the
//     existing mark-first credential_set + 86400 s overlap, which stays
//     valid for Meta: retiring OUR copy never claims anything about
//     Meta-side invalidation).
//   • Graph API Results — cursor pagination via paging.cursors.after; the
//     official guidance says cursors must not be stored long-term → cursors
//     live only inside one run; paging.next URLs are NEVER fetched (they
//     echo request parameters); pages are bounded by MAX_PAGES.
//   • Graph API Rate Limiting — BUC codes (80000..80014) + legacy 4/17/32,
//     X-Business-Use-Case-Usage.estimated_time_to_regain_access (minutes) →
//     mapped to rate_limit/retryable with a retry_after diagnostic.
//   • Graph API Error Handling — { error: { message, type, code,
//     error_subcode, fbtrace_id } }: 190→auth; 10 & 200–299 & (#10)/(#200)
//     →scope; 1/2/5xx→temporary; 100→permanent (bad request) → the
//     Phase-10A taxonomy. fbtrace_id is kept as the safe correlation id;
//     messages are BOUNDED and sanitised; the token never appears anywhere.
//   • Insights & Best Practices — level=campaign, time_increment=1, spend/
//     impressions/clicks/reach arrive as STRINGS, actions =
//     [{action_type, value}], history ceiling ≈37 months, figures FINAL
//     after 28 days → initial lookback 28 days; incremental = since
//     last-sync minus a 3-day correction overlap (restatements converge via
//     the recorder's digest/supersession); async insights jobs DEFERRED.
//
// V1 scope decisions (everything else is EXCLUDED, documented in
// META_SETUP.md): validation, ad-account discovery (first page, ≤20),
// selection, campaigns / ad sets (→ canonical ad_group) / ads / daily
// campaign-level insights with lead-class actions mapped to leads. Webhooks
// DEFERRED (polling is authoritative; the Phase-8 signed webhook remains
// the lead-capture route). Lead-form retrieval, creatives, audiences,
// demographic breakdowns, attribution-window selection, multi-account
// connections: EXCLUDED.
//
// Security: the token enters only through the existing Vault-gated
// credential boundary; here it is used ONLY as an Authorization: Bearer
// header (never a URL parameter — also why paging.next is never fetched);
// no logging; error bodies are redacted to bounded safe diagnostics.
// Fixture tokens (meta-fixture:*) are STRUCTURALLY unusable unless the
// runtime explicitly enables fixtures (local serve / tests) — production
// can never enter fixture mode, and fixtures are never presented as live.

import type {
  AdapterSyncResult,
  AdapterValidation,
  CanonicalFact,
  ProviderAdapter,
  ProviderError,
} from "./marketing_provider_adapter_contract.ts";

export const META_API_VERSION = "v26.0";
export const META_FIXTURE_PREFIX = "meta-fixture:";
const GRAPH_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const MAX_PAGES = 10;
const PAGE_LIMIT = 100;
const INITIAL_LOOKBACK_DAYS = 28;
const INCREMENTAL_OVERLAP_DAYS = 3;
const MAX_ACTION_PAYLOAD = 25;
const LEAD_ACTION_TYPES = new Set(["lead", "leadgen_grouped", "onsite_conversion.lead_grouped"]);

type Transport = (path: string, params: URLSearchParams) => Promise<Response>;

interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

const BUC_CODES = new Set([80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

function sanitize(message: string): string {
  // never allow token-bearing or unbounded provider text into diagnostics
  return message.replace(/access_token=[^&\s"]+/gi, "access_token=REDACTED").slice(0, 120);
}

function normaliseMetaError(status: number, body: unknown, headers?: Headers): ProviderError {
  const err = ((body as { error?: GraphError } | null)?.error ?? {}) as GraphError;
  const code = typeof err.code === "number" ? err.code : status;
  const sub = err.error_subcode;
  const trace = err.fbtrace_id ? ` trace=${err.fbtrace_id}` : "";
  const base = `meta:${code}${sub ? `:${sub}` : ""}${trace}`;
  const detail = sanitize(String(err.message ?? ""));

  if (
    code === 190 ||
    (err.type === "OAuthException" && (sub === 458 || sub === 460 || sub === 463 || sub === 467))
  ) {
    return { kind: "auth", message: `${base} ${detail}`, retryable: false };
  }
  if (code === 10 || (code >= 200 && code <= 299) || /\(#(10|200)\)/.test(String(err.message))) {
    return { kind: "scope", message: `${base} ${detail}`, retryable: false };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || BUC_CODES.has(code)) {
    let retryAfter = "";
    const usage = headers?.get("x-business-use-case-usage");
    if (usage) {
      const m = usage.match(/"estimated_time_to_regain_access"\s*:\s*(\d+)/);
      if (m) retryAfter = ` retry_after_minutes=${m[1]}`;
    }
    return { kind: "rate_limit", message: `${base}${retryAfter} ${detail}`, retryable: true };
  }
  if (code === 1 || code === 2 || status >= 500) {
    return { kind: "temporary", message: `${base} ${detail}`, retryable: true };
  }
  if (code === 100) {
    return { kind: "permanent", message: `${base} ${detail}`, retryable: false };
  }
  return { kind: "temporary", message: `${base} ${detail}`, retryable: true };
}

function realTransport(credential: string): Transport {
  return async (path, params) => {
    const url = `${GRAPH_BASE}${path}${params.size ? `?${params.toString()}` : ""}`;
    return await fetch(url, {
      headers: { Authorization: `Bearer ${credential}`, accept: "application/json" },
    });
  };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch every page of a collection via cursors.after — bounded, all-or-
 *  nothing: a failure on ANY page returns the error so a torn collection is
 *  never partially emitted (replay is free — the recorder converges). */
async function fetchAll(
  transport: Transport,
  path: string,
  baseParams: Record<string, string>,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: ProviderError }> {
  const rows: Record<string, unknown>[] = [];
  let after = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({ ...baseParams, limit: String(PAGE_LIMIT) });
    if (after) params.set("after", after);
    let res: Response;
    try {
      res = await transport(path, params);
    } catch (e) {
      return {
        ok: false,
        error: {
          kind: "temporary",
          message: `meta:network ${sanitize(e instanceof Error ? e.message : "request failed")}`,
          retryable: true,
        },
      };
    }
    const body = await readJson(res);
    if (!res.ok) return { ok: false, error: normaliseMetaError(res.status, body, res.headers) };
    const data = (body as { data?: unknown })?.data;
    if (!Array.isArray(data)) {
      return {
        ok: false,
        error: {
          kind: "schema",
          message: "meta:schema collection without data[]",
          retryable: false,
        },
      };
    }
    rows.push(...(data as Record<string, unknown>[]));
    const cursors = (body as { paging?: { cursors?: { after?: string }; next?: string } })?.paging;
    const nextAfter = cursors?.cursors?.after;
    // per the official guidance, the presence of `next` — not row count —
    // signals another page; we follow it via the cursor, never the URL
    if (!cursors?.next || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }
  return { ok: true, rows };
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function parseAmount(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function insightsWindow(sinceIso?: string | null): { since: string; until: string } {
  const floor = isoDaysAgo(INITIAL_LOOKBACK_DAYS);
  let since = floor;
  if (sinceIso) {
    const overlapped = new Date(new Date(sinceIso).getTime() - INCREMENTAL_OVERLAP_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);
    since = overlapped > floor ? overlapped : floor;
  }
  return { since, until: new Date().toISOString().slice(0, 10) };
}

export function buildMetaAdapter(opts: { allowFixtures: boolean }): ProviderAdapter {
  const resolveTransport = async (
    credential: string,
  ): Promise<{ ok: true; transport: Transport } | { ok: false; error: ProviderError }> => {
    if (credential.startsWith(META_FIXTURE_PREFIX)) {
      if (!opts.allowFixtures) {
        return {
          ok: false,
          error: {
            kind: "auth",
            message: "meta: fixture credentials are not valid in this environment",
            retryable: false,
          },
        };
      }
      const { metaFixtureTransport } = await import("./marketing_meta_fixtures.ts");
      return {
        ok: true,
        transport: metaFixtureTransport(credential.slice(META_FIXTURE_PREFIX.length)),
      };
    }
    return { ok: true, transport: realTransport(credential) };
  };

  return {
    provider: "meta",
    version: `meta-adapter-1/${META_API_VERSION}`,
    requiresExternalAccount: true,

    async validateConnection(credential: string): Promise<AdapterValidation> {
      const t = await resolveTransport(credential);
      if (!t.ok) return { ok: false, error: t.error };
      try {
        const meRes = await t.transport("/me", new URLSearchParams({ fields: "id,name" }));
        const meBody = await readJson(meRes);
        if (!meRes.ok)
          return { ok: false, error: normaliseMetaError(meRes.status, meBody, meRes.headers) };
        const principal = str((meBody as Record<string, unknown>)?.id) ?? "unknown";

        const acctRes = await t.transport(
          "/me/adaccounts",
          new URLSearchParams({
            fields: "name,account_id,currency,timezone_name,account_status",
            limit: "25",
          }),
        );
        const acctBody = await readJson(acctRes);
        if (!acctRes.ok) {
          return {
            ok: false,
            error: normaliseMetaError(acctRes.status, acctBody, acctRes.headers),
          };
        }
        const data = ((acctBody as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
        const accounts = data
          .slice(0, 20) // the seam stores at most 20 discovered accounts
          .map((a) => ({
            ref: str(a.id) ?? "",
            name: `${str(a.name) ?? "Unnamed ad account"} (${str(a.currency) ?? "?"})`.slice(
              0,
              120,
            ),
          }))
          .filter((a) => a.ref.startsWith("act_"));
        return {
          ok: true,
          adapterVersion: `meta-adapter-1/${META_API_VERSION}`,
          evidence: {
            api_version: META_API_VERSION,
            principal_id: principal,
            accounts_discovered: accounts.length,
          },
          accounts,
        };
      } catch (e) {
        return {
          ok: false,
          error: {
            kind: "temporary",
            message: `meta:network ${sanitize(e instanceof Error ? e.message : "request failed")}`,
            retryable: true,
          },
        };
      }
    },

    async fetchFacts(args: {
      credential: string;
      externalAccountRef: string | null;
      sinceIso?: string | null;
    }): Promise<AdapterSyncResult> {
      const t = await resolveTransport(args.credential);
      if (!t.ok) return { ok: false, error: t.error };
      const act = args.externalAccountRef;
      if (!act || !act.startsWith("act_")) {
        return {
          ok: false,
          error: {
            kind: "permanent",
            message: "meta: no external ad account is selected for this connection",
            retryable: false,
          },
        };
      }

      // object dependency order: campaigns → ad sets → ads → daily insights.
      const campaigns = await fetchAll(t.transport, `/${act}/campaigns`, {
        fields: "name,status,created_time,updated_time",
      });
      if (!campaigns.ok) return { ok: false, error: campaigns.error };
      const adsets = await fetchAll(t.transport, `/${act}/adsets`, {
        fields: "name,status,campaign_id,created_time,updated_time",
      });
      if (!adsets.ok) return { ok: false, error: adsets.error };
      const ads = await fetchAll(t.transport, `/${act}/ads`, {
        fields: "name,status,adset_id,campaign_id,created_time,updated_time",
      });
      if (!ads.ok) return { ok: false, error: ads.error };

      const facts: CanonicalFact[] = [];
      for (const c of campaigns.rows) {
        const id = str(c.id);
        if (!id) continue;
        facts.push({
          fact_kind: "campaign",
          external_ref: id,
          name: str(c.name)?.slice(0, 200),
          payload: {
            status: str(c.status),
            provider_created_time: str(c.created_time),
            provider_updated_time: str(c.updated_time),
          },
        });
      }
      // SEMANTIC MAPPING: a Meta AD SET is the canonical AD GROUP.
      for (const s of adsets.rows) {
        const id = str(s.id);
        if (!id) continue;
        facts.push({
          fact_kind: "ad_group",
          external_ref: id,
          parent_ref: str(s.campaign_id),
          name: str(s.name)?.slice(0, 200),
          payload: {
            status: str(s.status),
            provider_created_time: str(s.created_time),
            provider_updated_time: str(s.updated_time),
          },
        });
      }
      for (const a of ads.rows) {
        const id = str(a.id);
        if (!id) continue;
        facts.push({
          fact_kind: "ad",
          external_ref: id,
          parent_ref: str(a.adset_id),
          name: str(a.name)?.slice(0, 200),
          payload: {
            campaign_id: str(a.campaign_id),
            status: str(a.status),
            provider_created_time: str(a.created_time),
            provider_updated_time: str(a.updated_time),
          },
        });
      }

      // daily campaign-level insights over the bounded window
      const window = insightsWindow(args.sinceIso);
      const insights = await fetchAll(t.transport, `/${act}/insights`, {
        level: "campaign",
        time_increment: "1",
        fields:
          "campaign_id,spend,impressions,clicks,reach,actions,account_currency,date_start,date_stop",
        time_range: JSON.stringify(window),
      });
      if (!insights.ok) {
        if (insights.error.kind === "temporary") {
          // the object feed is genuine — keep it; metrics are honestly
          // unavailable (the Phase-10A degraded semantics). A RATE LIMIT is
          // deliberately NOT treated as partial: the official guidance is
          // to stop calling entirely, so the whole run stays retryable and
          // backs off instead of completing as degraded.
          return { ok: true, facts, partial: { metrics: insights.error } };
        }
        return { ok: false, error: insights.error };
      }

      for (const r of insights.rows) {
        const campaignId = str(r.campaign_id);
        const dateStart = str(r.date_start);
        const dateStop = str(r.date_stop) ?? dateStart;
        const spend = parseAmount(r.spend);
        const currency = str(r.account_currency);
        if (!campaignId || !dateStart || spend === null || !currency) {
          return {
            ok: false,
            error: {
              kind: "schema",
              message:
                "meta:schema insights row missing/invalid campaign_id, date_start, spend or currency",
              retryable: false,
            },
          };
        }
        const actionsRaw = Array.isArray(r.actions) ? (r.actions as Record<string, unknown>[]) : [];
        if (r.actions !== undefined && !Array.isArray(r.actions)) {
          return {
            ok: false,
            error: {
              kind: "schema",
              message: "meta:schema actions is not an array",
              retryable: false,
            },
          };
        }
        let leads = 0;
        let sawLeadFact = false;
        const boundedActions: { action_type: string; value: string }[] = [];
        for (const a of actionsRaw.slice(0, MAX_ACTION_PAYLOAD)) {
          const type = str(a.action_type) ?? "unknown";
          const value = str(a.value) ?? String(a.value ?? "");
          boundedActions.push({ action_type: type, value });
          if (LEAD_ACTION_TYPES.has(type)) {
            const n = parseAmount(a.value);
            if (n !== null) {
              leads += n;
              sawLeadFact = true;
            }
          }
        }
        facts.push({
          fact_kind: "metric",
          external_ref: campaignId,
          window_start: dateStart,
          window_end: dateStop,
          currency,
          spend,
          impressions: parseAmount(r.impressions) ?? undefined,
          clicks: parseAmount(r.clicks) ?? undefined,
          ...(sawLeadFact ? { leads: Math.round(leads) } : {}),
          payload: {
            reach: parseAmount(r.reach),
            actions: boundedActions,
            attribution: "account_default",
            source_window: window,
          },
        });
      }
      return { ok: true, facts };
    },
  };
}

// Two cached instances: fixtures allowed (tests/local gated serve) or not
// (production). refreshCredential / revokeConnection / verifyWebhook are
// DELIBERATELY not implemented in V1 — rotation is the credential recovery,
// Meta-side invalidation happens in Business Manager (runbook), and
// webhooks are deferred with polling authoritative (META_SETUP.md).
export const metaAdapter = buildMetaAdapter({ allowFixtures: false });
export const metaAdapterWithFixtures = buildMetaAdapter({ allowFixtures: true });
