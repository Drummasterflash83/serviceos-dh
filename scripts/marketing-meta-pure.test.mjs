// ServiceOS — Meta Marketing API adapter pure proofs (node --test, NO network,
// NO database, NO live Meta call — every response below is a
// META CONTRACT FIXTURE (NOT LIVE DATA) shaped from the official v26.0
// response contracts):
//   1. REGISTRY + CATALOGUE TRUTH: meta resolves the reviewed adapter;
//      google_ads/linkedin/sheet still never resolve; the simulator stays
//      env-gated; the catalogue states meta verification = fixture_tested,
//      NEVER live_verified/connected; fixture credentials are STRUCTURALLY
//      unusable when fixtures are not enabled (production).
//   2. VALIDATION + DISCOVERY: a valid fixture token validates with evidence
//      (api version, principal, count) and two discovered accounts carrying
//      currency-labelled names; invalid (190/463) and missing-scope (10)
//      tokens NEVER validate and map to the honest taxonomy.
//   3. SYNC MAPPING: campaigns (TWO cursor pages) / ad sets→ad_group /
//      ads / daily campaign insights map to canonical facts; spend strings
//      parse; lead-class actions sum into leads; other actions stay in the
//      bounded payload; every fixture total reconciles (100.00 GBP / 5
//      leads); incremental fixture moves exactly one value; identical calls
//      are deep-identical (deterministic).
//   4. FAILURE HONESTY: degraded (objects ok, insights 500) → partial
//      metrics error; rate limit (80004 + BUC header) → retryable with
//      retry-after; page-two failure → temporary retryable, NO partial
//      facts emitted for that collection; schema drift is rejected by the
//      canonical validator; no diagnostic ever contains the token.
//
// Run: node --test scripts/marketing-meta-pure.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  META_API_VERSION,
  META_FIXTURE_PREFIX,
  buildMetaAdapter,
} from "../supabase/functions/_shared/marketing_meta_adapter.ts";
import {
  getProviderAdapter,
  SERVICEOS_TEST_PROVIDER,
  validateCanonicalFacts,
} from "../supabase/functions/_shared/marketing_provider_adapter_contract.ts";
import { PROVIDER_CONNECTION_CATALOGUE } from "../supabase/functions/_shared/marketing_provider_connections.ts";

const FIX = (s) => `${META_FIXTURE_PREFIX}${s}`;
const withFixtures = buildMetaAdapter({ allowFixtures: true });
const noFixtures = buildMetaAdapter({ allowFixtures: false });

/* ── 1 · registry + catalogue truth ───────────────────────────────────────── */

test("registry: meta resolves the reviewed adapter; other real providers never do", () => {
  for (const enabled of [true, false]) {
    const meta = getProviderAdapter("meta", { testProviderEnabled: enabled });
    assert.ok(meta, "meta resolves");
    assert.equal(meta.provider, "meta");
    for (const p of ["google_ads", "linkedin", "sheet", "unknown"]) {
      assert.equal(getProviderAdapter(p, { testProviderEnabled: enabled }), null);
    }
  }
  assert.equal(getProviderAdapter(SERVICEOS_TEST_PROVIDER, { testProviderEnabled: false }), null);
});

test("catalogue: meta is implemented + fixture_tested — never live/connected", () => {
  const meta = PROVIDER_CONNECTION_CATALOGUE.find((c) => c.provider === "meta");
  assert.equal(meta.connectImplemented, true);
  assert.equal(meta.syncImplemented, true);
  assert.equal(meta.verification, "fixture_tested");
  for (const p of ["google_ads", "linkedin", "sheet"]) {
    const c = PROVIDER_CONNECTION_CATALOGUE.find((x) => x.provider === p);
    assert.equal(c.connectImplemented, false, `${p} stays unimplemented`);
    assert.equal(c.verification, "none");
  }
  assert.ok(
    !JSON.stringify(PROVIDER_CONNECTION_CATALOGUE).match(/live_verified|"connected"/),
    "nothing in the catalogue claims live verification or connection",
  );
});

test("api version is pinned and recorded", () => {
  assert.match(META_API_VERSION, /^v\d+\.\d+$/);
  assert.equal(META_API_VERSION, "v26.0");
});

test("fixture credentials are STRUCTURALLY unusable without the fixture gate", async () => {
  const v = await noFixtures.validateConnection(FIX("healthy"));
  assert.equal(v.ok, false);
  assert.equal(v.error.kind, "auth", "a fixture token can never validate in production");
  const f = await noFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(f.ok, false);
  assert.equal(f.error.kind, "auth");
});

/* ── 2 · validation + discovery ───────────────────────────────────────────── */

test("meta: a valid token validates with evidence and two discovered accounts", async () => {
  const v = await withFixtures.validateConnection(FIX("healthy"));
  assert.equal(v.ok, true);
  assert.equal(v.accounts.length, 2, "two accessible ad accounts");
  assert.ok(v.accounts[0].ref.startsWith("act_"), "refs are provider act ids");
  assert.match(v.accounts[0].name, /\(GBP\)/, "currency-labelled name");
  assert.match(v.accounts[1].name, /\(USD\)/);
  assert.equal(v.evidence.api_version, META_API_VERSION);
  assert.ok(v.evidence.principal_id, "principal recorded");
  assert.equal(v.evidence.accounts_discovered, 2);
  assert.ok(!JSON.stringify(v).includes(FIX("healthy")), "the token never appears in results");
});

test("meta: invalid/expired token maps to auth and never validates", async () => {
  const v = await withFixtures.validateConnection(FIX("invalid"));
  assert.equal(v.ok, false);
  assert.equal(v.error.kind, "auth");
  assert.equal(v.error.retryable, false);
  assert.match(v.error.message, /meta:190/, "safe provider code recorded");
  assert.ok(!v.error.message.includes(FIX("invalid")), "no token in the diagnostic");
});

test("meta: missing scope maps to scope and never validates", async () => {
  const v = await withFixtures.validateConnection(FIX("noscope"));
  assert.equal(v.ok, false);
  assert.equal(v.error.kind, "scope");
  assert.equal(v.error.retryable, false);
});

test("meta: an unrecognised credential shape never validates", async () => {
  const v = await withFixtures.validateConnection("EAAG-not-a-fixture-and-no-network-here");
  // without a network transport the real path cannot run under node tests;
  // the adapter must fail CLOSED with a normalised error, never a throw
  assert.equal(v.ok, false);
  assert.ok(["auth", "temporary", "internal"].includes(v.error.kind));
});

/* ── 3 · sync mapping + reconciliation ────────────────────────────────────── */

test("meta: healthy sync maps two-page campaigns, ad sets→ad_group, ads and daily insights", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(f.ok, true);
  const kinds = Object.fromEntries(
    ["campaign", "ad_group", "ad", "metric"].map((k) => [
      k,
      f.facts.filter((x) => x.fact_kind === k),
    ]),
  );
  assert.equal(kinds.campaign.length, 2, "both campaign pages harvested");
  assert.equal(kinds.ad_group.length, 2, "Meta ad sets map to canonical ad_group");
  assert.equal(kinds.ad.length, 2);
  assert.equal(kinds.metric.length, 2, "daily campaign insights");
  assert.ok(
    kinds.ad_group.every((g) => g.parent_ref?.length > 0),
    "ad sets carry their campaign parent",
  );
  const spend = kinds.metric.reduce((s, m) => s + m.spend, 0);
  const leads = kinds.metric.reduce((s, m) => s + (m.leads ?? 0), 0);
  assert.equal(Math.round(spend * 100) / 100, 100.0, "spend strings parse and reconcile");
  assert.equal(leads, 5, "lead-class actions sum into leads");
  assert.ok(
    kinds.metric.every((m) => m.currency === "GBP"),
    "account currency carried on every metric fact",
  );
  assert.ok(
    kinds.metric.every((m) => Array.isArray(m.payload.actions)),
    "non-lead actions preserved in the bounded payload",
  );
  const check = validateCanonicalFacts(f.facts);
  assert.equal(check.ok, true, "everything crossing the boundary is canonical");
});

test("meta: deterministic — identical calls are deep-identical", async () => {
  const a = await withFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: "act_111000111",
  });
  const b = await withFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: "act_111000111",
  });
  assert.deepEqual(a, b);
});

test("meta: incremental fixture moves exactly one value on the same natural keys", async () => {
  const v1 = await withFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: "act_111000111",
  });
  const v2 = await withFixtures.fetchFacts({
    credential: FIX("healthy_v2"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(v2.ok, true);
  assert.equal(v2.facts.length, v1.facts.length, "same natural keys");
  const changed = v2.facts.find(
    (x) => x.fact_kind === "metric" && x.external_ref === "23850000000002",
  );
  assert.equal(changed.spend, 6.0, "the restated insight is deterministic");
});

test("meta: sync without a selected external account is an honest permanent refusal", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("healthy"),
    externalAccountRef: null,
  });
  assert.equal(f.ok, false);
  assert.equal(f.error.kind, "permanent");
});

/* ── 4 · failure honesty ──────────────────────────────────────────────────── */

test("meta: degraded — object feed survives, metrics failure is explicit and retryable", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("degraded"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(f.ok, true);
  assert.ok(
    f.facts.some((x) => x.fact_kind === "campaign"),
    "objects survive",
  );
  assert.equal(f.facts.filter((x) => x.fact_kind === "metric").length, 0);
  assert.equal(f.partial?.metrics?.kind, "temporary");
  assert.equal(f.partial?.metrics?.retryable, true);
});

test("meta: BUC rate limit maps to rate_limit with a retry-after diagnostic", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("ratelimit"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(f.ok, false);
  assert.equal(f.error.kind, "rate_limit");
  assert.equal(f.error.retryable, true);
  assert.match(
    f.error.message,
    /retry_after_minutes=4/,
    "estimated_time_to_regain_access surfaced",
  );
});

test("meta: a page-two failure is temporary/retryable and emits NO facts", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("page2fail"),
    externalAccountRef: "act_111000111",
  });
  assert.equal(f.ok, false, "a torn collection is never partially emitted");
  assert.equal(f.error.kind, "temporary");
  assert.equal(f.error.retryable, true);
});

test("meta: schema drift is caught before the domain layer", async () => {
  const f = await withFixtures.fetchFacts({
    credential: FIX("drift"),
    externalAccountRef: "act_111000111",
  });
  if (f.ok) {
    const check = validateCanonicalFacts(f.facts);
    assert.equal(check.ok, false, "drifted output must fail canonical validation");
  } else {
    assert.equal(f.error.kind, "schema");
  }
});

test("meta: no diagnostic path ever carries the token", async () => {
  for (const scenario of ["invalid", "noscope", "ratelimit", "page2fail", "drift"]) {
    const token = FIX(scenario);
    const v = await withFixtures.validateConnection(token);
    const f = await withFixtures.fetchFacts({
      credential: token,
      externalAccountRef: "act_111000111",
    });
    for (const out of [v, f]) {
      assert.ok(!JSON.stringify(out).includes(token), `${scenario}: token redacted`);
    }
  }
});

/* ── 5 · source discipline ────────────────────────────────────────────────── */

import { readFileSync } from "node:fs";
const adapterSrc = readFileSync(
  new URL("../supabase/functions/_shared/marketing_meta_adapter.ts", import.meta.url),
  "utf8",
);

test("meta source: header auth, no token in URLs, no console logging, bounded paging", () => {
  assert.ok(adapterSrc.includes("Authorization"), "bearer-header auth");
  assert.ok(
    !/[?&]access_token=/.test(adapterSrc),
    "the token is never placed in a URL (no query-param auth, no paging.next echo risk)",
  );
  assert.ok(!/console\./.test(adapterSrc), "the adapter never logs");
  assert.ok(adapterSrc.includes("MAX_PAGES"), "pagination is bounded");
  // `paging.next` PRESENCE is the official has-another-page signal and may
  // be read — but its URL must never be fetched (it can echo request
  // parameters). The only fetch target is GRAPH_BASE + path.
  assert.ok(adapterSrc.includes("cursors?.cursors?.after"), "pages advance by cursor");
  assert.ok(!/fetch\([^)]*next/.test(adapterSrc), "a paging.next URL is never fetched");
  assert.ok(/fetch\(url/.test(adapterSrc), "the only fetch target is the pinned Graph base URL");
});

test("meta fixtures are labelled as contract fixtures, not live data", () => {
  const fixtureSrc = readFileSync(
    new URL("../supabase/functions/_shared/marketing_meta_fixtures.ts", import.meta.url),
    "utf8",
  );
  assert.ok(fixtureSrc.includes("META CONTRACT FIXTURE — NOT LIVE DATA"));
});
