// Marketing Phase 10A — the DETERMINISTIC TEST PROVIDER simulator.
//
// Pure module (no network, no database, no randomness — every fixture below
// is a hand-fixed constant, so identical inputs always produce
// deep-identical outputs). This is NOT a production provider:
//   • its identity is the explicit 'serviceos_test_provider';
//   • it is absent from the production connection catalogue;
//   • the registry resolves it ONLY under MARKETING_TEST_PROVIDER=enabled;
//   • no fixture below is ever presented as Meta / Google Ads / LinkedIn /
//     Sheet data.
//
// Scenario control is DETERMINISTIC via the stored credential value:
//   sim:healthy      validate ok (2 accounts); 2 campaigns + 2 GBP daily
//                    metrics (spend 95.50 + 4.50 = 100.00, leads 4 + 1 = 5)
//   sim:healthy_v2   the incremental view: camp-2's metric moves to 6.00 —
//                    same natural keys, exactly one changed value
//   sim:degraded     validate ok (1 account); campaign feed succeeds,
//                    metrics endpoint fails with an explicit temporary error
//   sim:invalid      auth failure everywhere (invalid/expired credential)
//   sim:noscope      authorisation / missing-scope failure
//   sim:rate_limit   provider rate limit (retryable)
//   sim:flaky        provider temporary failure (retryable)
//   sim:rejected     provider permanent rejection (not retryable)
//   sim:schema_bad   returns MALFORMED canonical output — the contract
//                    validator must catch it before the domain layer
//   sim:mixed        two currencies (GBP + EUR) — reporting must refuse to
//                    add them
//   sim:future_fact  a metric window in the future — the SQL recorder must
//                    reject it
//   anything else    NEVER validates (auth failure) — an unknown credential
//                    cannot connect anything
//
// Dates are fixed relative to the runtime day at day granularity (the SQL
// recorder enforces the honest time bounds); values are constants.

import type {
  AdapterSyncResult,
  AdapterValidation,
  CanonicalFact,
  ProviderAdapter,
  ProviderError,
  ProviderErrorKind,
} from "./marketing_provider_adapter_contract.ts";

const VERSION = "serviceos-sim-1";

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}
function isoDaysAhead(days: number): string {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

const ACCOUNTS_HEALTHY = [
  { ref: "acct-100", name: "Sim Account 100" },
  { ref: "acct-200", name: "Sim Account 200" },
];
const ACCOUNTS_DEGRADED = [{ ref: "acct-300", name: "Sim Account 300" }];

function healthyFacts(campTwoSpend: number, campTwoImpressions: number): CanonicalFact[] {
  return [
    { fact_kind: "campaign", external_ref: "camp-1", name: "Spring Boilers" },
    { fact_kind: "campaign", external_ref: "camp-2", name: "Servicing Plans" },
    {
      fact_kind: "metric",
      external_ref: "camp-1",
      window_start: isoDaysAgo(2),
      window_end: isoDaysAgo(2),
      currency: "GBP",
      spend: 95.5,
      impressions: 1000,
      clicks: 50,
      leads: 4,
    },
    {
      fact_kind: "metric",
      external_ref: "camp-2",
      window_start: isoDaysAgo(2),
      window_end: isoDaysAgo(2),
      currency: "GBP",
      spend: campTwoSpend,
      impressions: campTwoImpressions,
      clicks: 10,
      leads: 1,
    },
  ];
}

const err = (
  kind: ProviderErrorKind,
  message: string,
  retryable: boolean,
): { ok: false; error: ProviderError } => ({ ok: false, error: { kind, message, retryable } });

async function validateConnection(credential: string): Promise<AdapterValidation> {
  switch (credential) {
    case "sim:healthy":
    case "sim:healthy_v2":
    case "sim:mixed":
    case "sim:future_fact":
    case "sim:schema_bad":
    case "sim:rate_limit":
    case "sim:flaky":
    case "sim:rejected":
      return {
        ok: true,
        adapterVersion: VERSION,
        evidence: { probe: "deterministic simulator handshake", scenario: credential },
        accounts: ACCOUNTS_HEALTHY,
      };
    case "sim:degraded":
      return {
        ok: true,
        adapterVersion: VERSION,
        evidence: { probe: "deterministic simulator handshake", scenario: credential },
        accounts: ACCOUNTS_DEGRADED,
      };
    case "sim:noscope":
      return err("scope", "the simulated principal lacks the required scope", false);
    case "sim:invalid":
    default:
      // an unknown or invalid credential can NEVER validate a connection
      return err("auth", "the simulated credential is invalid or expired", false);
  }
}

async function fetchFacts(args: {
  credential: string;
  externalAccountRef: string | null;
}): Promise<AdapterSyncResult> {
  switch (args.credential) {
    case "sim:healthy":
      return { ok: true, facts: healthyFacts(4.5, 200) };
    case "sim:healthy_v2":
      // incremental: the SAME natural keys; exactly one value moved
      return { ok: true, facts: healthyFacts(6.0, 220) };
    case "sim:degraded":
      return {
        ok: true,
        facts: [
          { fact_kind: "campaign", external_ref: "camp-d1", name: "Degraded Feed A" },
          { fact_kind: "campaign", external_ref: "camp-d2", name: "Degraded Feed B" },
        ],
        partial: {
          metrics: {
            kind: "temporary",
            message: "the simulated metrics endpoint returned 500",
            retryable: true,
          },
        },
      };
    case "sim:mixed":
      return {
        ok: true,
        facts: [
          {
            fact_kind: "metric",
            external_ref: "camp-m1",
            window_start: isoDaysAgo(3),
            window_end: isoDaysAgo(3),
            currency: "GBP",
            spend: 95.0,
            leads: 2,
          },
          {
            fact_kind: "metric",
            external_ref: "camp-m2",
            window_start: isoDaysAgo(3),
            window_end: isoDaysAgo(3),
            currency: "EUR",
            spend: 10.0,
            leads: 1,
          },
        ],
      };
    case "sim:future_fact":
      return {
        ok: true,
        facts: [
          {
            fact_kind: "metric",
            external_ref: "camp-f1",
            window_start: isoDaysAhead(5),
            window_end: isoDaysAhead(5),
            currency: "GBP",
            spend: 1.0,
            leads: 1,
          },
        ],
      };
    case "sim:schema_bad":
      // deliberately malformed canonical output — the CONTRACT must catch it
      return {
        ok: true,
        // deno-lint-ignore no-explicit-any
        facts: [{ fact_kind: "metric", external_ref: "bad", smuggled: true } as any],
      };
    case "sim:rate_limit":
      return err("rate_limit", "the simulated provider returned 429", true);
    case "sim:flaky":
      return err("temporary", "the simulated provider timed out", true);
    case "sim:rejected":
      return err("permanent", "the simulated provider permanently rejected the request", false);
    case "sim:noscope":
      return err("scope", "the simulated principal lacks the required scope", false);
    case "sim:invalid":
    default:
      return err("auth", "the simulated credential is invalid or expired", false);
  }
}

export const serviceosTestProviderAdapter: ProviderAdapter = {
  provider: "serviceos_test_provider",
  version: VERSION,
  validateConnection,
  fetchFacts,
};
