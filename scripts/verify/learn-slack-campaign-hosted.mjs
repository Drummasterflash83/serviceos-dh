/** HTTP acceptance of an idle TEST Slack user-credential worker, using existing TEST keys in memory. */
import { readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/092_slack_campaigns.manifest.json"),
);
const runtime = JSON.parse(
  readFileSync("supabase/release/learn-test/092_slack_campaign_runtime.manifest.json"),
);
manifest.tables = [
  ...manifest.tables,
  ...[
    "slack_history_campaigns",
    "slack_history_campaign_channels",
    "slack_history_campaign_requests",
    "slack_history_campaign_dispatches",
    "slack_history_campaign_thread_scans",
    "slack_history_campaign_threads",
    "slack_history_campaign_closures",
  ].map((n) => "public." + n),
];
const deployed = JSON.parse(
  readFileSync(".verification-results/slack-campaign-runtime-deploy-result.json"),
);
if (deployed.state !== "deployed_needs_http_acceptance" || deployed.fullPreservedDatasets !== 220)
  throw Error("Matching deployed runtimes required");
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
if (
  manifest.tables.length !== 220 ||
  manifest.tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Unexpected table inventory");
const RECURRING_SNAPSHOT = manifest.tables
  .map(
    (t) =>
      `select '${t}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t} s`,
  )
  .join(" union all ");
const catalog = `select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')`;
async function readRecurringCatalog(token) {
  return (await communicationQuery(token, catalog))[0];
}
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST verification required",
  );
  const token = savedCliToken(),
    before = await readRecurringCatalog(token);
  check(before.fingerprint === runtime.fullSchema, "Installed recurring catalog differs");
  const idle = await communicationQuery(
    token,
    "select (select count(*)::int from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')) as active,(select count(*)::int from slack_recurring_channels) as channels,(select count(*)::int from slack_recurring_requests) as requests,(select count(*)::int from slack_history_campaigns) as campaigns",
  );
  check(
    idle.length === 1 &&
      idle[0].active === 0 &&
      idle[0].channels === 0 &&
      idle[0].requests === 0 &&
      idle[0].campaigns === 0,
    "Only empty initial scheduling state is accepted",
  );
  const inventory = await edgeInventory(token);
  for (const expected of runtime.beforeEndpoints) {
    const current = inventory.find((e) => e.slug === expected.name);
    check(
      current?.id === expected.id &&
        current.version === expected.version + 1 &&
        current.status === "ACTIVE" &&
        current.verify_jwt === expected.jwt,
      "Exact deployed endpoint required",
    );
  }
  const preserved = await communicationQuery(token, RECURRING_SNAPSHOT);
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(r.ok, "Existing TEST keys unavailable");
  const keys = await r.json();
  function keyFor(role) {
    const rows = keys.filter((k) => k.name === role);
    check(rows.length === 1, "Unique TEST key required");
    const key = rows[0].api_key,
      c = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    check(c.ref === TEST_PROJECT && c.role === role, "Existing key scope differs");
    return key;
  }
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const admin = { apikey: service, Authorization: `Bearer ${service}` },
    trigger = { ...admin, "x-serviceos-worker-key": service };
  const cases = [
    ["missing gateway JWT", {}, "POST", undefined, 401],
    [
      "anonymous key without trigger",
      { apikey: anon, Authorization: `Bearer ${anon}` },
      "POST",
      undefined,
      403,
    ],
    ["service JWT without trigger", admin, "POST", undefined, 403],
    [
      "wrong trigger",
      { ...admin, "x-serviceos-worker-key": "invalid-synthetic-worker-key" },
      "POST",
      undefined,
      403,
    ],
    ["wrong method", trigger, "GET", undefined, 405],
    [
      "caller supplied work selector",
      { ...trigger, "Content-Type": "application/json" },
      "POST",
      '{"tenant":"synthetic"}',
      400,
    ],
    ["empty authorized worker", trigger, "POST", undefined, 200],
  ];
  const checks = [];
  writeFileSync(
    ".verification-results/slack-campaign-http-intent.json",
    JSON.stringify({
      projectRef: TEST_PROJECT,
      startedAt: new Date().toISOString(),
      state: "started",
      preserved,
      inventory,
    }),
    { flag: "wx", mode: 0o600 },
  );
  for (const endpointName of ["learn-slack-worker", "learn-slack-schedule"]) {
    const url = `https://${TEST_PROJECT}.supabase.co/functions/v1/${endpointName}`;
    for (const [name, headers, method, body, status] of cases) {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      check(response.status === status, `HTTP check failed: ${name} (${response.status})`);
      if (status === 200)
        check(
          JSON.stringify(data) ===
            (endpointName === "learn-slack-worker"
              ? '{"ok":true,"result":{"claimed":0,"outcomes":[]}}'
              : '{"ok":true,"result":{"checked":0,"queued":0,"held":0,"campaigns":{"checked":0,"queued":0,"held":0}}}'),
          "Idle worker response differs",
        );
      checks.push({ endpoint: endpointName, name, status, passed: true });
    }
  }
  // Shared worker boot/auth only: do not invoke its cross-input queue.
  for (const [name, headers] of [
    ["missing authorization", {}],
    ["anonymous JWT", { apikey: anon, Authorization: `Bearer ${anon}` }],
    ["wrong schedule secret", { "x-schedule-secret": "invalid-synthetic-worker-key" }],
  ]) {
    const response = await fetch(
      `https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,
      { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(30000) },
    );
    check(response.status === 403, "Shared worker auth denied");
    await response.arrayBuffer();
    checks.push({ endpoint: "platform-worker", name, status: 403, passed: true });
  }
  check(
    JSON.stringify(await edgeInventory(token)) === JSON.stringify(inventory),
    "Endpoint metadata changed during acceptance",
  );
  const after = await readRecurringCatalog(token),
    afterRows = await communicationQuery(token, RECURRING_SNAPSHOT);
  const sorted = (x) => JSON.stringify([...x].sort((a, b) => a.name.localeCompare(b.name)));
  check(
    before.fingerprint === after.fingerprint && sorted(preserved) === sorted(afterRows),
    "Schema or retained sources changed",
  );
  const outcome = {
    version: "learn-slack-campaign-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "http_verified_idle_no_capture",
    checks,
    preservedDataSets: preserved.length,
    providerRequests: 0,
    activatedChannels: 0,
    recurringTriggersCreated: 0,
    productionChanged: false,
    limitations: [
      "Idle hosted runtime acceptance only; no real campaign or provider coverage acceptance.",
      "Shared platform-worker checked for boot and denied access only; no cross-input queue invoked.",
    ],
  };
  writeFileSync(
    ".verification-results/slack-campaign-http.json",
    JSON.stringify(outcome, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(outcome, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
