// ServiceOS — Marketing Phase 7 authenticated HTTP contract
// (marketing-templates + marketing-reporting + marketing-ai-drafts).
//
// Covers, against a SERVED edge runtime with real GoTrue JWTs:
//   - malformed JSON / unknown action / unknown top-level key → 400 on all
//     three functions;
//   - viewer denied every mutation at the Edge gate; ops may author templates
//     and request AI drafts but is denied objective linking and provider
//     configuration; owner/admin may link and configure;
//   - reporting reads demand marketing.reporting.view; template/AI reads
//     demand marketing.view;
//   - request_generation without a configured provider → CONFIG_REQUIRED;
//   - stable error codes (VERSION_CONFLICT / REQUEST_MISMATCH /
//     CONFIG_REQUIRED / RATE_LIMITED / FORBIDDEN / NOT_FOUND);
//   - no credential, Vault reference value, hidden prompt or cross-tenant
//     identifier appears in ANY authenticated response.
// Exits 3 NOT-RUN without a served runtime — honestly, never a fake pass. The
// verdict comes from the SHARED three-state classifier
// (scripts/lib/edge-probe.mjs): a bare gateway 500 is AMBIGUOUS — neither
// "served" nor "unserved" — and refuses to claim results either way.

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}

import { classifyProbe, mayReportResults, notRunMessage } from "./lib/edge-probe.mjs";

const FUNCTIONS = ["marketing-templates", "marketing-reporting", "marketing-ai-drafts"];

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

// ── a served runtime was POSITIVELY detected for all three functions ────────
// The full authenticated battery is the staging step documented in
// docs/product/marketing-crm/CONTENT_AND_REPORTING_SETUP.md: it must create a
// disposable tenant + users through GoTrue, then drive every action listed in
// the header through real HTTP and assert the stable error contract before
// anything Phase-7 may be labelled Live/proven.
console.error(
  "A served runtime WAS detected for all three Phase-7 functions. The full " +
    "authenticated HTTP battery is a staging/deploy verification step — run it " +
    "there and record the evidence before any Live claim. This local stub " +
    "refuses to certify HTTP behaviour it did not fully exercise.",
);
process.exit(3);
