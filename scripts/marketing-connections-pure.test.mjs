// ServiceOS — Marketing Phase 9 pure-boundary proofs (node --test, NO network,
// NO database, NO provider):
//   1. The TRUTHFUL connection catalogue: ZERO connection or sync adapters are
//      implemented in this build — for every provider, plainly declared; the
//      helpers report the same truth for known and unknown providers alike.
//   2. The credential contract: the rotation overlap is the SAME bounded
//      86400 s the Phase-8 webhook secret uses, and the Vault provider key is
//      derived, opaque and account-scoped.
//   3. Source discipline scans of the Edge function: the idempotency mark is
//      consulted BEFORE any Vault write (a replay can never rotate twice or
//      store again); the operator credential is never logged and never echoed
//      back; every mutating action sits behind the owner/admin + ads.manage
//      manage gate; nothing fabricates a connected state.
//   4. Source discipline scans of the worker handler: claimed runs complete
//      through the governed RPCs only, with the honest 'no_adapter' class —
//      no direct table writes, no invented success.
//
// Run: node --test scripts/marketing-connections-pure.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MKT_CONNECTION_ROTATION_OVERLAP_SECONDS,
  PROVIDER_CONNECTION_CATALOGUE,
  connectionAdapterImplemented,
  connectionVaultProvider,
  syncAdapterImplemented,
} from "../supabase/functions/_shared/marketing_provider_connections.ts";
import { ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS } from "../supabase/functions/_shared/marketing_ad_webhook.ts";

/* ── 1 · the truthful catalogue ───────────────────────────────────────────── */

test("catalogue: exactly the four connectable providers, no webhook", () => {
  const keys = PROVIDER_CONNECTION_CATALOGUE.map((c) => c.provider).sort();
  assert.deepEqual(keys, ["google_ads", "linkedin", "meta", "sheet"]);
});

test("catalogue: adapter truth — meta fixture-tested, everything else unimplemented", () => {
  // LOCK EVOLVED in Phase 10B (documented in ledger §20): the original
  // Phase-9 assertion was "zero adapters exist". The reviewed Meta adapter
  // now exists (fixture tested — NOT live verified). The lock still fails
  // loudly if any OTHER provider claims an adapter, if meta claims live
  // verification, or if requirements are dropped. Nothing was weakened —
  // the catalogue must still tell the exact truth.
  for (const c of PROVIDER_CONNECTION_CATALOGUE) {
    if (c.provider === "meta") {
      assert.equal(c.connectImplemented, true, "meta's reviewed adapter exists");
      assert.equal(c.syncImplemented, true);
      assert.equal(c.verification, "fixture_tested", "meta is NEVER live_verified in this build");
    } else {
      assert.equal(c.connectImplemented, false, `${c.provider} must not claim connect`);
      assert.equal(c.syncImplemented, false, `${c.provider} must not claim sync`);
      assert.equal(c.verification, "none");
    }
    assert.ok(c.requirements.length > 0, `${c.provider} states what a REAL integration needs`);
  }
  assert.ok(
    !PROVIDER_CONNECTION_CATALOGUE.some((c) => c.verification === "live_verified"),
    "nothing in this build is live verified",
  );
});

test("helpers: implemented flags report the same truth for every input", () => {
  assert.equal(connectionAdapterImplemented("meta"), true);
  assert.equal(syncAdapterImplemented("meta"), true);
  for (const p of ["google_ads", "linkedin", "sheet", "webhook", "unknown", ""]) {
    assert.equal(connectionAdapterImplemented(p), false);
    assert.equal(syncAdapterImplemented(p), false);
  }
});

/* ── 2 · the credential contract ──────────────────────────────────────────── */

test("rotation overlap: bounded and identical to the Phase-8 webhook contract", () => {
  assert.equal(MKT_CONNECTION_ROTATION_OVERLAP_SECONDS, 86400);
  assert.equal(MKT_CONNECTION_ROTATION_OVERLAP_SECONDS, ADS_WEBHOOK_ROTATION_OVERLAP_SECONDS);
});

test("vault provider key: derived, opaque, account-scoped", () => {
  const id = "0f0e0d0c-0b0a-0908-0706-050403020100";
  assert.equal(connectionVaultProvider(id), `mkt-conn-${id}`);
});

/* ── 3 · Edge function source discipline ──────────────────────────────────── */

const edgeSrc = readFileSync(
  new URL("../supabase/functions/marketing-provider-connections/index.ts", import.meta.url),
  "utf8",
);

test("edge: the idempotency mark is consulted BEFORE any Vault write", () => {
  const mark = edgeSrc.indexOf("marketing_provider_account_credential_mark");
  const store = edgeSrc.indexOf("provider_secret_store");
  assert.ok(mark > 0 && store > 0, "both calls exist");
  assert.ok(mark < store, "mark precedes every Vault write");
  const replayGuard = edgeSrc.indexOf("markData.replayed === true");
  assert.ok(
    replayGuard > mark && replayGuard < store,
    "the replayed verdict short-circuits before any Vault write",
  );
});

test("edge: the operator credential is never logged and never echoed", () => {
  for (const line of edgeSrc.split("\n")) {
    if (line.includes("console.")) {
      assert.ok(!/credential/i.test(line), `a log line must never carry the credential: ${line}`);
      assert.ok(!/secret/i.test(line), `a log line must never carry a secret: ${line}`);
    }
  }
  // the credential VALUE has exactly ONE egress: the Vault store. It is never
  // interpolated, never a response field, never a shorthand property.
  assert.equal(
    (edgeSrc.match(/p_secret: credential\b/g) || []).length,
    1,
    "the Vault store is the only place the credential value flows out",
  );
  assert.ok(!/\$\{credential/.test(edgeSrc), "the credential is never interpolated");
  assert.ok(
    !/data:\s*\{[^}]*\bcredential\b\s*[,:}]/.test(edgeSrc),
    "no response object carries a credential field",
  );
});

test("edge: every mutating action sits behind the manage gate", () => {
  for (const action of ["account_create", "connect", "credential_set", "revoke", "sync_request"]) {
    const inManage = new RegExp(`MANAGE_ACTIONS = new Set\\(\\[[^\\]]*"${action}"`, "s");
    assert.ok(inManage.test(edgeSrc), `${action} must be a manage action`);
  }
});

test("edge: nothing fabricates a connected state", () => {
  assert.ok(
    !/status\s*[:=]\s*["']connected["']/.test(edgeSrc),
    "the Edge layer never asserts connected — only the SQL adapter seam can",
  );
  assert.ok(
    !edgeSrc.includes("marketing_provider_account_connect_result"),
    "the adapter seam RPC is not reachable from the user-facing API",
  );
});

/* ── 4 · worker handler source discipline ─────────────────────────────────── */

const workerSrc = readFileSync(
  new URL(
    "../supabase/functions/_shared/worker_handlers/marketing_provider_sync.ts",
    import.meta.url,
  ),
  "utf8",
);

test("worker: completes honestly through governed RPCs only", () => {
  assert.ok(workerSrc.includes("marketing_provider_sync_claim"), "claims via the RPC");
  assert.ok(workerSrc.includes("marketing_provider_sync_complete"), "completes via the RPC");
  assert.ok(workerSrc.includes('"no_adapter"'), "the truthful failure class is present");
  assert.ok(!/\.insert\(/.test(workerSrc), "no direct table insert");
  assert.ok(!/\.update\(/.test(workerSrc), "no direct table update");
  assert.ok(
    !/outcome:\s*["']succeeded["']/.test(workerSrc),
    "no invented success — success can only come from a real adapter",
  );
});

test("worker: registered under the marketing.provider_sync job type", () => {
  const registry = readFileSync(
    new URL("../supabase/functions/_shared/worker_handlers/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(registry.includes('"marketing.provider_sync": handleMarketingProviderSync'));
});
