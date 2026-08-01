// ServiceOS — Marketing Phase 8 HTTP contract (marketing-ads management API +
// marketing-ad-webhook public signed receiver).
//
// Covers, against a SERVED edge runtime:
//   management — malformed JSON / unknown action / unknown key → 400; viewer
//   denied every mutation; ops denied source management (structural ceiling);
//   owner/admin manage sources and receive the signing secret exactly once;
//   manual sync → UNSUPPORTED truthfully; stable error codes; no credential
//   or Vault value in any response.
//   webhook — signature verified over the REAL raw bytes: valid signed post
//   accepted; wrong secret / tampered body / stale timestamp / unknown key
//   all get the IDENTICAL generic 401 with zero writes; replay converges;
//   same-id-different-body → 409 conflict.
// Exits 3 NOT-RUN without a served runtime — honestly, never a fake pass,
// through the SHARED three-state classifier (scripts/lib/edge-probe.mjs).

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}

import { classifyProbe, mayReportResults, notRunMessage } from "./lib/edge-probe.mjs";

const FUNCTIONS = ["marketing-ads", "marketing-ad-webhook"];

async function probe(fn) {
  try {
    const resp = await fetch(`${URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON },
      body: "{}",
    });
    return classifyProbe({ status: resp.status });
  } catch {
    return classifyProbe({ transportError: true });
  }
}

for (const fn of FUNCTIONS) {
  const verdict = await probe(fn);
  if (!mayReportResults(verdict.verdict)) {
    console.error(notRunMessage(fn, verdict));
    process.exit(3);
  }
}

// ── a served runtime was POSITIVELY detected for both Phase-8 functions ─────
// The full authenticated + signed-webhook battery is the staging step
// documented in docs/product/marketing-crm/ADS_SETUP.md: create a disposable
// tenant + users through GoTrue, drive every management action, then sign
// real raw bodies with the once-shown secret and assert acceptance, replay
// convergence, conflict and the generic-401 discipline before anything
// Phase-8 may be labelled Live/proven.
console.error(
  "A served runtime WAS detected for both Phase-8 functions. The full " +
    "authenticated HTTP + signed-webhook battery is a staging/deploy " +
    "verification step — run it there and record the evidence before any " +
    "Live claim. This local stub refuses to certify HTTP behaviour it did " +
    "not fully exercise.",
);
process.exit(3);
