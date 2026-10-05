// META CONTRACT FIXTURE — NOT LIVE DATA.
//
// Deterministic Graph API v26.0-shaped responses used ONLY by automated tests
// and the local fixture gate (MARKETING_TEST_PROVIDER=enabled). Shapes follow
// the official contracts verified 2026-08-01:
//   • error envelope: { error: { message, type, code, error_subcode,
//     fbtrace_id } }  (Graph API — Handling Errors)
//   • pagination: { data: [...], paging: { cursors: { before, after },
//     next? } }  (Graph API — Results / paging)
//   • insights rows: spend/impressions/clicks/reach as STRINGS, actions as
//     [{ action_type, value }], account_currency, date_start/date_stop
//     (Marketing API — Insights)
//   • rate limit: BUC error codes (e.g. 80004) + the
//     X-Business-Use-Case-Usage header carrying
//     estimated_time_to_regain_access (Graph API — Rate Limiting)
//
// Scenario is selected by the fixture credential suffix
// (meta-fixture:<scenario>). Every value below is a hand-fixed constant —
// identical inputs always produce identical outputs. NOTHING here may ever
// be presented as a live Meta account, campaign or spend figure.

const T = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

const j = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const gErr = (
  status: number,
  code: number,
  message: string,
  subcode?: number,
  headers: Record<string, string> = {},
) =>
  j(
    status,
    {
      error: {
        message,
        type: "OAuthException",
        code,
        ...(subcode ? { error_subcode: subcode } : {}),
        fbtrace_id: `FIXTURE-TRACE-${code}`,
      },
    },
    headers,
  );

const ME = { id: "100000000000001", name: "ServiceOS Fixture System User" };

const ADACCOUNTS = {
  data: [
    {
      id: "act_111000111",
      account_id: "111000111",
      name: "Drummond Heating Ads",
      currency: "GBP",
      timezone_name: "Europe/London",
      account_status: 1,
    },
    {
      id: "act_222000222",
      account_id: "222000222",
      name: "Secondary Fixture Ads",
      currency: "USD",
      timezone_name: "America/New_York",
      account_status: 1,
    },
  ],
  paging: { cursors: { before: "FIXB0", after: "FIXA0" } },
};

const CAMPAIGN_PAGE_1 = {
  data: [
    {
      id: "23850000000001",
      name: "Spring Boilers",
      status: "ACTIVE",
      created_time: "2026-06-01T09:00:00+0000",
      updated_time: "2026-07-20T09:00:00+0000",
    },
  ],
  paging: { cursors: { before: "C1B", after: "CPAGE2" }, next: "present-per-contract" },
};
const CAMPAIGN_PAGE_2 = {
  data: [
    {
      id: "23850000000002",
      name: "Servicing Plans",
      status: "ACTIVE",
      created_time: "2026-06-10T09:00:00+0000",
      updated_time: "2026-07-21T09:00:00+0000",
    },
  ],
  paging: { cursors: { before: "C2B", after: "C2A" } },
};

const ADSETS = {
  data: [
    {
      id: "23860000000001",
      campaign_id: "23850000000001",
      name: "Boilers — Homeowners 30+",
      status: "ACTIVE",
      created_time: "2026-06-01T09:05:00+0000",
      updated_time: "2026-07-20T09:05:00+0000",
    },
    {
      id: "23860000000002",
      campaign_id: "23850000000002",
      name: "Servicing — Existing areas",
      status: "PAUSED",
      created_time: "2026-06-10T09:05:00+0000",
      updated_time: "2026-07-21T09:05:00+0000",
    },
  ],
  paging: { cursors: { before: "ASB", after: "ASA" } },
};

const ADS = {
  data: [
    {
      id: "23870000000001",
      adset_id: "23860000000001",
      campaign_id: "23850000000001",
      name: "Boiler replace — form ad",
      status: "ACTIVE",
      created_time: "2026-06-01T09:10:00+0000",
      updated_time: "2026-07-20T09:10:00+0000",
    },
    {
      id: "23870000000002",
      adset_id: "23860000000002",
      campaign_id: "23850000000002",
      name: "Service plan — image ad",
      status: "ACTIVE",
      created_time: "2026-06-10T09:10:00+0000",
      updated_time: "2026-07-21T09:10:00+0000",
    },
  ],
  paging: { cursors: { before: "ADB", after: "ADA" } },
};

const insightsRows = (campTwoSpend: string, campTwoImpressions: string) => ({
  data: [
    {
      campaign_id: "23850000000001",
      spend: "95.50",
      impressions: "1000",
      clicks: "50",
      reach: "800",
      account_currency: "GBP",
      actions: [
        { action_type: "lead", value: "3" },
        { action_type: "leadgen_grouped", value: "1" },
        { action_type: "link_click", value: "50" },
      ],
      date_start: T(2),
      date_stop: T(2),
    },
    {
      campaign_id: "23850000000002",
      spend: campTwoSpend,
      impressions: campTwoImpressions,
      clicks: "10",
      reach: "180",
      account_currency: "GBP",
      actions: [{ action_type: "lead", value: "1" }],
      date_start: T(2),
      date_stop: T(2),
    },
  ],
  paging: { cursors: { before: "INB", after: "INA" } },
});

const DRIFT_INSIGHTS = {
  data: [
    {
      campaign_id: "23850000000001",
      spend: "not-a-number",
      impressions: { unexpected: "object" },
      account_currency: "GBP",
      actions: "malformed-not-an-array",
      // date_start deliberately missing
      date_stop: T(2),
    },
  ],
  paging: { cursors: { before: "DRB", after: "DRA" } },
};

/** Deterministic fixture transport: (scenario, path, params) → Response. */
export function metaFixtureTransport(scenario: string) {
  return (path: string, params: URLSearchParams): Promise<Response> => {
    const after = params.get("after") ?? "";

    if (scenario === "invalid") {
      return Promise.resolve(
        gErr(401, 190, "Error validating access token: session has expired", 463),
      );
    }
    if (path === "/me") {
      return Promise.resolve(j(200, ME));
    }
    if (path === "/me/adaccounts") {
      if (scenario === "noscope") {
        return Promise.resolve(
          gErr(403, 10, "(#10) Requires ads_read permission to manage the object"),
        );
      }
      return Promise.resolve(j(200, ADACCOUNTS));
    }
    if (path.endsWith("/campaigns")) {
      if (scenario === "page2fail" && after === "CPAGE2") {
        return Promise.resolve(gErr(500, 2, "Service temporarily unavailable"));
      }
      return Promise.resolve(j(200, after === "CPAGE2" ? CAMPAIGN_PAGE_2 : CAMPAIGN_PAGE_1));
    }
    if (path.endsWith("/adsets")) {
      return Promise.resolve(j(200, ADSETS));
    }
    if (path.endsWith("/ads")) {
      return Promise.resolve(j(200, ADS));
    }
    if (path.endsWith("/insights")) {
      if (scenario === "degraded") {
        return Promise.resolve(gErr(500, 2, "Service temporarily unavailable"));
      }
      if (scenario === "ratelimit") {
        return Promise.resolve(
          gErr(400, 80004, "There have been too many calls to this ad-account.", undefined, {
            "x-business-use-case-usage": JSON.stringify({
              "111000111": [
                {
                  type: "ads_insights",
                  call_count: 100,
                  total_cputime: 100,
                  total_time: 100,
                  estimated_time_to_regain_access: 4,
                },
              ],
            }),
          }),
        );
      }
      if (scenario === "drift") {
        return Promise.resolve(j(200, DRIFT_INSIGHTS));
      }
      if (scenario === "healthy_v2") {
        return Promise.resolve(j(200, insightsRows("6.00", "220")));
      }
      return Promise.resolve(j(200, insightsRows("4.50", "200")));
    }
    return Promise.resolve(gErr(400, 100, `Unknown fixture path ${path}`));
  };
}
