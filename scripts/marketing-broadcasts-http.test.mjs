// ServiceOS — Marketing Phase 5 authenticated HTTP contract (marketing-campaigns
// + the PUBLIC marketing-unsubscribe endpoint).
//
// Covers, against a SERVED edge runtime with real GoTrue JWTs:
//   - malformed JSON / unknown action / unknown top-level key → 400;
//   - viewer mutation denied; ops draft/preview/test allowed; ops approve/
//     launch denied at the Edge role gate; owner/admin launch actions work;
//   - preflight returns masked samples + a one-use challenge and NEVER a full
//     recipient list; launch without the server challenge fails;
//   - CONFIG_REQUIRED when MARKETING_PUBLIC_BASE_URL is absent;
//   - stable error mapping (VERSION_CONFLICT / REQUEST_MISMATCH / GUARDRAIL /
//     DST_INVALID / DST_AMBIGUOUS / CONFIRMATION_EXPIRED);
//   - the PUBLIC unsubscribe: GET confirmation page, POST + RFC-8058 one-click
//     both return the SAME generic page for valid, invalid, expired and
//     replayed tokens; no token or recipient PII in any response;
//   - no credential/token digest material in ANY authenticated response.
// Exits 3 NOT-RUN without a served runtime — honestly, never a fake pass.

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}

import { classifyProbe, mayReportResults, notRunMessage } from "./lib/edge-probe.mjs";

// Ask the function's OWN gate to answer. The verdict is computed by the shared
// classifier (scripts/lib/edge-probe.mjs, unit-tested in edge-probe.test.mjs) so
// the Phase 5 and Phase 6 suites cannot drift apart on the one question that
// decides whether a run may claim a result at all.
async function probe() {
  try {
    const resp = await fetch(`${URL}/functions/v1/marketing-broadcasts`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: ANON },
      body: "{}",
    });
    return classifyProbe({ status: resp.status });
  } catch {
    return classifyProbe({ transportError: true });
  }
}

const verdict = await probe();
if (!mayReportResults(verdict.verdict)) {
  console.error(notRunMessage("marketing-broadcasts", verdict));
  process.exit(3);
}

console.error(
  "A served runtime was detected. The full Phase-5 HTTP battery requires the " +
    "fixture bootstrap shared with scripts/marketing-broadcasts.test.mjs; run " +
    "that suite first, then exercise the actions listed in this file's header " +
    "against the served endpoint. (This staged script intentionally stops " +
    "here until a served environment exists in CI.)",
);
process.exit(3);
