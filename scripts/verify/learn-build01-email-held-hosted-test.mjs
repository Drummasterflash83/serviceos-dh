/** TEST-only live invocation with an ephemeral schedule secret and empty sources. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--test-empty-inventory" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST-only empty-inventory mode required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const token = savedCliToken();
const query = `select
  (select count(*) from public.email_accounts where provider='gmail'
    and status in ('pending_tokenless_dwd','active_dwd')) active_accounts,
  (select count(*) from public.google_workspace_connections where status<>'disabled') active_connections`;
async function readInventory() {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  if (!response.ok) throw Error(`TEST aggregate inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (rows.length !== 1 || Number(rows[0].active_accounts) !== 0 ||
      Number(rows[0].active_connections) !== 0)
    throw Error("TEST provider source inventory is no longer empty");
}
function runCli(args) {
  const result = spawnSync(cli, [...args, "--project-ref", TEST_PROJECT], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw Error(`TEST secret ${args[1]} not confirmed`);
}
const work = mkdtempSync(join(tmpdir(), "build01-email-held-hosted-"));
const secret = randomBytes(48).toString("hex");
let secretSet = false;
try {
  await readInventory();
  const envFile = join(work, "test.env");
  writeFileSync(envFile, `EMAIL_WORKSPACE_SCHEDULE_SECRET=${secret}\n`, { mode: 0o600 });
  runCli(["secrets", "set", "--env-file", envFile]);
  secretSet = true;
  await readInventory();
  const endpoint = `https://${TEST_PROJECT}.supabase.co/functions/v1/email-workspace-scheduled-sync`;
  const bad = await fetch(endpoint, { method: "POST",
    headers: { "x-schedule-secret": "invalid-synthetic-secret" },
    signal: AbortSignal.timeout(30000) });
  if (bad.status !== 403 || (await bad.json()).error?.code !== "forbidden")
    throw Error("TEST invalid scheduler secret was not rejected");
  const good = await fetch(endpoint, { method: "POST",
    headers: { "x-schedule-secret": secret }, signal: AbortSignal.timeout(30000) });
  const body = await good.json();
  if (good.status !== 200 || body.success !== true || body.mailboxes !== 0 ||
      body.queued !== 0 || body.discovery_queued !== 0 || body.held_recovery !== 0)
    throw Error(`TEST scheduler invocation was not confirmed (HTTP ${good.status})`);
  console.log(JSON.stringify({ state: "hosted_test_pass", project: TEST_PROJECT,
    invalidSecretRejected: true, emptyInventoryAccepted: true,
    providerRequests: 0, customerRowsRead: 0 }));
} finally {
  try {
    if (secretSet) {
      runCli(["secrets", "unset", "EMAIL_WORKSPACE_SCHEDULE_SECRET"]);
      secretSet = false;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (secretSet) console.error("TEST scheduler secret cleanup requires inspection");
  }
}
