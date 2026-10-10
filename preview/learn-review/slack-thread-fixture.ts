const tenant = "11111111-1111-4111-8111-111111111111",
  id = (n: number) => `88888888-8888-4888-8888-${String(n).padStart(12, "0")}`;
export function slackThreadFixture(name: string, args: any) {
  const scenario = new URLSearchParams(location.search).get("threads");
  const key = `serviceos:synthetic:threads:${scenario ?? 'normal'}`;
  const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? { now: Date.now(), lostResponse: false, requests: [], imports: [] };
  const requests = new Map<string, any>(saved.requests), imports = new Map<string, any>(saved.imports);
  const save = () => sessionStorage.setItem(key, JSON.stringify({ ...saved, requests: [...requests], imports: [...imports] }));
  if (scenario === "error") return { data: null, error: { code: "synthetic" } };
  if (name === "learn_slack_accounts_read")
    return {
      data: {
        version: "learn-slack-accounts/1",
        tenantId: tenant,
        accounts:
          scenario === "empty"
            ? []
            : [
                {
                  id: id(1),
                  name: "Synthetic service desk",
                  status: scenario === "disabled" ? "disabled" : "active",
                  teamId: "TFIXTURE",
                  channelId: "CEXAMPLE",
                },
              ],
        nextCursor: null,
      },
      error: null,
    };
  if (name === "learn_slack_start_thread_import") {
    if (scenario === "stale" && args.p_source_message_id === id(11)) return { data: null, error: { code: "PT409" } };
    const prior = requests.get(args.p_request_id);
    if (prior) return { data: { ...prior, reused: true }, error: null };
    const data = {
      requestId: args.p_request_id,
      accountId: args.p_account_id,
      jobId: crypto.randomUUID(),
      reused: false,
    };
    requests.set(args.p_request_id, data);
    imports.set(args.p_source_message_id, {
      id: args.p_request_id,
      approvedAt: new Date().toISOString(),
      start: args.p_start,
      end: args.p_end,
      pages: 0,
      pageLimit: args.p_max_pages,
      complete: false,
      status: "queued",
      availableAt: new Date().toISOString(),
      errorCode: null,
      stopReason: null,
    });
    if (scenario === "uncertain" && !saved.lostResponse && requests.size === 2) {
      saved.lostResponse = true;
      save();
      return { data: null, error: { code: "synthetic_lost_response" } };
    }
    save();
    return { data, error: null };
  }
  save();
  const now = saved.now,
    start = new Date(now - 86400000).toISOString(),
    end = new Date(now - 3600000).toISOString();
  const threads = [0, 1, 2].map((n) => ({
    sourceId: id(10 + n),
    sourceVersion: "a".repeat(64),
    parentTimestamp: `${Math.floor(now / 1000) - 3600 - n * 3600}.000001`,
    observedTimestamp: `${Math.floor(now / 1000) - 3600 - n * 3600}.000001`,
    excerpt: [
      "Customer update: engineer appointment confirmed. · Synthetic",
      "Parts request: awaiting supplier response. · Synthetic",
      "Office handoff: next steps agreed. · Synthetic",
    ][n],
    latestImport:
      imports.get(id(10 + n)) ??
      (n === 0
        ? null
        : {
            id: id(20 + n),
            approvedAt: end,
            start,
            end,
            pages: n === 1 ? 3 : 2,
            pageLimit: 3,
            complete: n === 2,
            status: "succeeded",
            availableAt: null,
            errorCode: null,
            stopReason: n === 1 ? "page_budget_exhausted" : "window_pages_complete",
          }),
  }));
  return {
    data: {
      version: "learn-slack-threads/1",
      tenantId: tenant,
      accountId: id(1),
      teamId: "TFIXTURE",
      channelId: "CEXAMPLE",
      canImport: scenario !== "disabled",
      connectionRevision: new Date(now - 3600000).toISOString(),
      threads: scenario === "no-threads" ? [] : threads,
      nextCursor: null,
      coverage: "observed_threads_only",
    },
    error: null,
  };
}
