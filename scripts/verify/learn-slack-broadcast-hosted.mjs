/** HTTP acceptance of an idle TEST worker, using existing TEST keys in memory. */
import { readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readRecurringCatalog, RECURRING_SNAPSHOT } from "./learn-slack-recurring-catalog.mjs";
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
  check(
    before.fingerprint === "3df03cc4ff78e62c1d2bba5f9579a638",
    "Installed recurring catalog differs",
  );
  const idle = await communicationQuery(token,
    "select count(*)::int as active_jobs from public.platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')");
  check(idle.length === 1 && idle[0].active_jobs === 0, "Worker must have no active Slack jobs");
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
    version: "learn-slack-broadcast-hosted/1",
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
    ".verification-results/slack-broadcast-http.json",
    JSON.stringify(outcome, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(outcome, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
