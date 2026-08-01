// ServiceOS — Marketing Phase 10A pure-boundary proofs (node --test, NO
// network, NO database, NO real provider):
//   1. The ADAPTER CONTRACT: canonical-fact validation refuses malformed
//      shapes at the boundary (unknown keys, bad kinds, spend without
//      currency, negative numbers, malformed windows, oversized batches) —
//      an adapter CANNOT silently hand malformed data to the domain layer.
//   2. The REGISTRY GATE: the four real providers NEVER resolve an adapter
//      (enabled or not); the deterministic test provider resolves ONLY under
//      the explicit environment gate; it is ABSENT from the production
//      connection catalogue, so the UI can never present it as a real
//      provider.
//   3. The DETERMINISTIC SIMULATOR: identical inputs → deep-identical
//      outputs; every scenario carries its honest error taxonomy
//      (auth/scope/rate_limit/temporary/permanent/schema) with truthful
//      retryability; the healthy fixture reconciles to the documented
//      totals; schema-bad output is caught by the contract validator.
//   4. SOURCE DISCIPLINE: the workers write only through governed RPCs and
//      never invent success (outcomes are COMPUTED from genuine adapter
//      results); the Edge function env-gates the test provider and still
//      never touches the adapter seam RPC.
//
// Run: node --test scripts/marketing-provider-hardening-pure.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SERVICEOS_TEST_PROVIDER,
  getProviderAdapter,
  validateCanonicalFacts,
} from "../supabase/functions/_shared/marketing_provider_adapter_contract.ts";
import { PROVIDER_CONNECTION_CATALOGUE } from "../supabase/functions/_shared/marketing_provider_connections.ts";

/* ── 1 · canonical-fact validation ────────────────────────────────────────── */

const GOOD_FACT = {
  fact_kind: "metric",
  external_ref: "camp-1",
  window_start: "2026-07-30",
  window_end: "2026-07-30",
  currency: "GBP",
  spend: 95.5,
  impressions: 1000,
  clicks: 50,
  leads: 4,
};

test("contract: a well-formed fact batch validates", () => {
  const v = validateCanonicalFacts([
    GOOD_FACT,
    { fact_kind: "campaign", external_ref: "camp-1", name: "C" },
  ]);
  assert.equal(v.ok, true);
});

test("contract: malformed canonical data cannot cross the boundary", () => {
  const bad = [
    [{ ...GOOD_FACT, surprise: 1 }, "unknown key"],
    [{ ...GOOD_FACT, fact_kind: "weird" }, "unknown kind"],
    [{ ...GOOD_FACT, currency: undefined }, "spend without currency"],
    [{ ...GOOD_FACT, spend: -5 }, "negative spend"],
    [{ ...GOOD_FACT, leads: -1 }, "negative leads"],
    [{ ...GOOD_FACT, window_start: "not-a-date" }, "malformed window"],
    [{ ...GOOD_FACT, external_ref: "" }, "empty external ref"],
    [
      { fact_kind: "metric", external_ref: "x", currency: "GBP", spend: 1 },
      "metric without window",
    ],
  ];
  for (const [fact, label] of bad) {
    const v = validateCanonicalFacts([fact]);
    assert.equal(v.ok, false, `${label} must refuse`);
  }
  const oversized = Array.from({ length: 501 }, (_, i) => ({
    fact_kind: "campaign",
    external_ref: `c-${i}`,
  }));
  assert.equal(validateCanonicalFacts(oversized).ok, false, "oversized batch must refuse");
  assert.equal(validateCanonicalFacts("nope").ok, false, "non-array must refuse");
});

/* ── 2 · the registry gate ────────────────────────────────────────────────── */

test("registry: real providers NEVER resolve an adapter", () => {
  for (const enabled of [true, false]) {
    for (const p of ["meta", "google_ads", "linkedin", "sheet", "unknown", ""]) {
      assert.equal(
        getProviderAdapter(p, { testProviderEnabled: enabled }),
        null,
        `${p} must have no adapter (enabled=${enabled})`,
      );
    }
  }
});

test("registry: the test provider resolves ONLY under the explicit gate", () => {
  assert.equal(getProviderAdapter(SERVICEOS_TEST_PROVIDER, { testProviderEnabled: false }), null);
  const sim = getProviderAdapter(SERVICEOS_TEST_PROVIDER, { testProviderEnabled: true });
  assert.ok(sim, "the simulator resolves under the gate");
  assert.equal(sim.provider, "serviceos_test_provider");
});

test("registry: the test provider is ABSENT from the production catalogue", () => {
  assert.equal(SERVICEOS_TEST_PROVIDER, "serviceos_test_provider");
  assert.ok(
    !PROVIDER_CONNECTION_CATALOGUE.some((c) => String(c.provider) === SERVICEOS_TEST_PROVIDER),
    "the UI catalogue can never offer the simulator",
  );
});

/* ── 3 · the deterministic simulator ──────────────────────────────────────── */

const sim = getProviderAdapter(SERVICEOS_TEST_PROVIDER, { testProviderEnabled: true });

test("simulator: identical inputs produce deep-identical outputs", async () => {
  const a = await sim.validateConnection("sim:healthy");
  const b = await sim.validateConnection("sim:healthy");
  assert.deepEqual(a, b);
  const f1 = await sim.fetchFacts({ credential: "sim:healthy", externalAccountRef: "acct-100" });
  const f2 = await sim.fetchFacts({ credential: "sim:healthy", externalAccountRef: "acct-100" });
  assert.deepEqual(f1, f2);
});

test("simulator: the healthy tenant fixture reconciles", async () => {
  const v = await sim.validateConnection("sim:healthy");
  assert.equal(v.ok, true);
  assert.equal(v.accounts.length, 2, "two accessible external accounts");
  assert.ok(v.evidence && Object.keys(v.evidence).length > 0, "verification evidence exists");
  const f = await sim.fetchFacts({ credential: "sim:healthy", externalAccountRef: "acct-100" });
  assert.equal(f.ok, true);
  const metrics = f.facts.filter((x) => x.fact_kind === "metric");
  const campaigns = f.facts.filter((x) => x.fact_kind === "campaign");
  assert.equal(campaigns.length, 2);
  assert.equal(metrics.length, 2);
  const spend = metrics.reduce((s, m) => s + m.spend, 0);
  const leads = metrics.reduce((s, m) => s + m.leads, 0);
  assert.equal(spend, 100.0, "fixture spend total is documented and exact");
  assert.equal(leads, 5, "fixture lead total is documented and exact");
  assert.ok(
    metrics.every((m) => m.currency === "GBP"),
    "one supported currency",
  );
  const check = validateCanonicalFacts(f.facts);
  assert.equal(check.ok, true, "the healthy fixture is canonical");
});

test("simulator: incremental fixture updates one fact without duplicating", async () => {
  const v1 = await sim.fetchFacts({ credential: "sim:healthy", externalAccountRef: "acct-100" });
  const v2 = await sim.fetchFacts({ credential: "sim:healthy_v2", externalAccountRef: "acct-100" });
  assert.equal(v2.ok, true);
  assert.equal(v2.facts.length, v1.facts.length, "same natural keys, no extra rows");
  const changed = v2.facts.find((x) => x.fact_kind === "metric" && x.external_ref === "camp-2");
  assert.equal(changed.spend, 6.0, "exactly one value moved, deterministically");
});

test("simulator: degraded tenant — feed available, metrics honestly failed", async () => {
  const v = await sim.validateConnection("sim:degraded");
  assert.equal(v.ok, true);
  const f = await sim.fetchFacts({ credential: "sim:degraded", externalAccountRef: "acct-300" });
  assert.equal(f.ok, true);
  assert.ok(
    f.facts.every((x) => x.fact_kind === "campaign"),
    "the campaign feed survives",
  );
  assert.equal(f.partial?.metrics?.kind, "temporary", "the metrics failure is explicit");
});

test("simulator: the error taxonomy is honest and complete", async () => {
  const cases = [
    ["sim:invalid", "auth", false],
    ["sim:noscope", "scope", false],
    ["sim:rate_limit", "rate_limit", true],
    ["sim:flaky", "temporary", true],
    ["sim:rejected", "permanent", false],
  ];
  for (const [cred, kind, retryable] of cases) {
    const f = await sim.fetchFacts({ credential: cred, externalAccountRef: null });
    assert.equal(f.ok, false, `${cred} fails`);
    assert.equal(f.error.kind, kind, `${cred} → ${kind}`);
    assert.equal(f.error.retryable, retryable, `${cred} retryable=${retryable}`);
  }
  const v = await sim.validateConnection("sim:invalid");
  assert.equal(v.ok, false);
  assert.equal(v.error.kind, "auth", "an invalid credential can never validate");
  const unknown = await sim.validateConnection("garbage");
  assert.equal(unknown.ok, false, "an unrecognised credential NEVER validates");
});

test("simulator: schema-bad output is caught by the contract validator", async () => {
  const f = await sim.fetchFacts({ credential: "sim:schema_bad", externalAccountRef: null });
  assert.equal(f.ok, true, "the simulator hands back raw malformed output");
  const check = validateCanonicalFacts(f.facts);
  assert.equal(check.ok, false, "the contract boundary refuses it");
});

test("simulator: mixed-currency fixture is canonical (honesty lives in reporting)", async () => {
  const f = await sim.fetchFacts({ credential: "sim:mixed", externalAccountRef: null });
  assert.equal(f.ok, true);
  const ccy = new Set(f.facts.filter((x) => x.fact_kind === "metric").map((x) => x.currency));
  assert.equal(ccy.size, 2, "two currencies, never to be added");
  assert.equal(validateCanonicalFacts(f.facts).ok, true);
});

/* ── 4 · source discipline ────────────────────────────────────────────────── */

const syncSrc = readFileSync(
  new URL(
    "../supabase/functions/_shared/worker_handlers/marketing_provider_sync.ts",
    import.meta.url,
  ),
  "utf8",
);
const connectSrc = readFileSync(
  new URL(
    "../supabase/functions/_shared/worker_handlers/marketing_provider_connect.ts",
    import.meta.url,
  ),
  "utf8",
);
const edgeSrc = readFileSync(
  new URL("../supabase/functions/marketing-provider-connections/index.ts", import.meta.url),
  "utf8",
);

test("workers: governed RPCs only, outcomes computed from genuine results", () => {
  for (const [name, src] of [
    ["sync", syncSrc],
    ["connect", connectSrc],
  ]) {
    assert.ok(!/\.insert\(/.test(src), `${name}: no direct table insert`);
    assert.ok(!/\.update\(/.test(src), `${name}: no direct table update`);
    assert.ok(!/\.delete\(/.test(src), `${name}: no direct table delete`);
    assert.ok(
      !/outcome:\s*["']succeeded["']/.test(src),
      `${name}: success is never a literal — it is computed from the adapter result`,
    );
    assert.ok(
      !/verified:\s*true/.test(src),
      `${name}: verification is never asserted, only relayed`,
    );
  }
  assert.ok(syncSrc.includes('"no_adapter"'), "the truthful no-adapter class survives");
  assert.ok(
    connectSrc.includes("marketing_provider_account_connect_result"),
    "the connect worker reports through the governed seam",
  );
  assert.ok(connectSrc.includes("queue_initial_sync"), "initial sync is queued through the seam");
});

test("edge: the test provider is env-gated and the seam stays unreachable", () => {
  assert.ok(edgeSrc.includes("MARKETING_TEST_PROVIDER"), "the env gate exists");
  assert.ok(
    !edgeSrc.includes("marketing_provider_account_connect_result"),
    "the adapter seam RPC is still not reachable from the user-facing API",
  );
  assert.ok(!/status\s*[:=]\s*["']connected["']/.test(edgeSrc), "no fabricated connected");
});
