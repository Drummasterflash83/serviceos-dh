import { slackThreadFixture } from "./slack-thread-fixture";
export function slackThreadRecoveryFixture(name: string, args: any) {
  const params = new URLSearchParams(location.search),
    scenario = params.get("threadRecovery") ?? "normal";
  const tenant = "11111111-1111-4111-8111-111111111111",
    account = "88888888-8888-4888-8888-000000000001";
  const key = `serviceos:synthetic:thread-recovery:${scenario}`;
  const fixture = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? { states: {}, requests: {} };
  const save = () => sessionStorage.setItem(key, JSON.stringify(fixture));
  if (args.p_tenant_id !== tenant) return { data: null, error: { code: "42501" } };
  if (
    name === "learn_slack_thread_recovery_read" &&
    (scenario === "error" || params.get("threadRead") === "error")
  )
    return { data: null, error: { code: "synthetic" } };
  if (!fixture.states[args.p_import_id]) {
    const page = slackThreadFixture("learn_slack_threads_read", {
      p_tenant_id: tenant,
      p_account_id: account,
    }).data;
    const thread = page?.threads?.find((t: any) => t.latestImport?.id === args.p_import_id);
    if (!thread) return { data: null, error: { code: "42501" } };
    const i = thread.latestImport,
      complete = i.complete || scenario === "complete",
      active = ["queued", "running", "retrying"].includes(i.status);
    fixture.states[i.id] = {
      version: "learn-slack-thread-recovery/1",
      tenantId: tenant,
      accountId: account,
      importId: i.id,
      approvedAt: i.approvedAt,
      previousImportId: null,
      recoveryMode: null,
      supersededBy: null,
      teamId: page.teamId,
      channelId: page.channelId,
      parentTimestamp: thread.parentTimestamp,
      stateVersion: "a".repeat(64),
      stateValid: true,
      active,
      canContinue: !complete && !active && scenario !== "disabled",
      canRestart: !complete && !active && scenario !== "disabled",
      window: {
        start: i.start,
        end: i.end,
        pageLimit: i.pageLimit,
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
      },
      progress: { pagesThisApproval: i.pages, complete, hasCursor: !complete && i.pages > 0 },
      latestJob: {
        id: crypto.randomUUID(),
        status: i.status,
        availableAt: i.availableAt,
        errorCode: i.errorCode,
        stopReason: complete ? "window_pages_complete" : i.stopReason,
      },
      coverage: "observed_thread_window",
    };
    save();
  }
  const state = fixture.states[args.p_import_id];
  if (name === "learn_slack_thread_recovery_read") return { data: state, error: null };
  if (scenario === "viewer" || params.get("recovery") === "viewer")
    return { data: null, error: { code: "42501" } };
  const prior = fixture.requests[args.p_request_id];
  if (prior)
    return JSON.stringify(prior.args) === JSON.stringify(args)
      ? { data: { ...prior.receipt, reused: true }, error: null }
      : { data: null, error: { code: "PT409" } };
  if (scenario === "stale" || args.p_expected_state_version !== state.stateVersion)
    return { data: null, error: { code: "PT409" } };
  if (!state.canRestart) return { data: null, error: { code: "55000" } };
  const receipt = {
    requestId: args.p_request_id,
    previousImportId: args.p_import_id,
    accountId: account,
    jobId: crypto.randomUUID(),
    reused: false,
  };
  fixture.requests[args.p_request_id] = { args, receipt };
  fixture.states[args.p_request_id] = {
    ...state,
    importId: args.p_request_id,
    approvedAt: new Date().toISOString(),
    previousImportId: args.p_import_id,
    recoveryMode: args.p_mode,
    supersededBy: null,
    stateVersion: "b".repeat(64),
    active: true,
    canContinue: false,
    canRestart: false,
    window: {
      ...state.window,
      pageLimit: args.p_max_pages,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    progress: {
      pagesThisApproval: 0,
      complete: false,
      hasCursor: args.p_mode === "continue" && state.progress.hasCursor,
    },
    latestJob: {
      id: receipt.jobId,
      status: "queued",
      availableAt: new Date().toISOString(),
      errorCode: null,
      stopReason: null,
    },
  };
  state.supersededBy = args.p_request_id;
  state.canContinue = false;
  state.canRestart = false;
  state.stateVersion = "c".repeat(64);
  save();
  return scenario === "uncertain"
    ? { data: null, error: { code: "synthetic_lost_response" } }
    : { data: receipt, error: null };
}
