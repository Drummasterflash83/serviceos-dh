/** HTTP acceptance of an idle TEST Slack user-credential worker, using existing TEST keys in memory. */
import { readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/080_slack_user_credential.manifest.json"),
);
const runtime = JSON.parse(
  readFileSync("supabase/release/learn-test/080_slack_user_runtime.manifest.json"),
);
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
if (
  manifest.tables.length !== 194 ||
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
    "select (select count(*)::int from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')) as active,(select count(*)::int from slack_recurring_channels) as channels,(select count(*)::int from slack_recurring_requests) as requests",
  );
  check(
    idle.length === 1 && idle[0].active === 0 && idle[0].channels === 0 && idle[0].requests === 0,
    "Only empty initial scheduling state is accepted",
  );
  const endpoint = (await edgeInventory(token)).find((e) => e.slug === "learn-slack-worker");
  check(
    endpoint?.version === 11 && endpoint.status === "ACTIVE" && endpoint.verify_jwt === true,
    "Exact worker v11 required",
  );
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
    service = keyFor("service_role"),
    url = `https://${TEST_PROJECT}.supabase.co/functions/v1/learn-slack-worker`;
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
        JSON.stringify(data) === '{"ok":true,"result":{"claimed":0,"outcomes":[]}}',
        "Idle worker response differs",
      );
    checks.push({ name, status, passed: true });
  }
  const after = await readRecurringCatalog(token),
    afterRows = await communicationQuery(token, RECURRING_SNAPSHOT);
  const sorted = (x) => JSON.stringify([...x].sort((a, b) => a.name.localeCompare(b.name)));
  check(
    before.fingerprint === after.fingerprint && sorted(preserved) === sorted(afterRows),
    "Schema or retained sources changed",
  );
  const outcome = {
    version: "learn-slack-user-worker-hosted/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "http_verified_idle_no_capture",
    checks,
    preservedDataSets: preserved.length,
    providerRequests: 0,
    activatedChannels: 0,
    recurringTriggersCreated: 0,
  };
  writeFileSync(
    ".verification-results/slack-user-worker-http.json",
    JSON.stringify(outcome, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify(outcome, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
