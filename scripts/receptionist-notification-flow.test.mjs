// Executes the real dispatcher with in-memory SQL/network boundaries. No external requests.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as data from "../supabase/functions/_shared/receptionist-data.ts";
import * as web from "../supabase/functions/_shared/receptionist-web-call.ts";

const source = ts.transpileModule(
  readFileSync(
    new URL("../supabase/functions/client-notifications/index.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;

function fixture(overrides = {}) {
  const calls = [],
    writes = [],
    claims = [];
  const job = {
    id: "job",
    tenant_id: "tenant",
    source_type: "receptionist_feedback",
    source_id: "feedback",
    source_version: 1,
    priority: "normal",
    attempts: 1,
  };
  const tables = {
    receptionist_workspaces: [
      {
        tenant_id: "tenant",
        company: "Drummonds",
        name: "Emma",
        slack_secret_name: "TEST_SLACK",
        vapi_secret_name: "TEST_VAPI",
      },
    ],
    receptionist_feedback: [
      {
        tenant_id: "tenant",
        id: "feedback",
        practice_session_id: "session",
        call_id: "call",
        title: "Repeated greeting",
        body: "Please check <the greeting> & opening hours.",
      },
    ],
    receptionist_practice_sessions: [{ tenant_id: "tenant", id: "session", call_id: "call" }],
    client_notification_outbox: [{ ...job, state: "sending" }],
  };
  const rawCall = {
    id: "call",
    type: "webCall",
    status: "ended",
    assistant: { metadata: { openfolkPracticeSession: "session", openfolkTenant: "tenant" } },
    artifact: {
      transcript: "Emma: Our office is close. Is close.",
      recordingUrl: "https://private.example/secret",
    },
  };
  const env = {
    CLIENT_NOTIFICATION_DISPATCH_SECRET: "dispatch",
    SUPABASE_URL: "https://local.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only",
    TEST_SLACK: "https://hooks.slack.com/services/synthetic",
    TEST_VAPI: "test-only",
  };
  Object.assign(env, overrides.env);
  Object.assign(rawCall, overrides.call);
  if (overrides.feedback) Object.assign(tables.receptionist_feedback[0], overrides.feedback);
  if (overrides.job) Object.assign(job, overrides.job);
  const db = {
    rpc: async (name) => {
      claims.push(name);
      if (name === "care_legacy_notification_allowed")
        return {
          data: overrides.careManaged !== true,
          error: overrides.careRoutingError ? { message: "unavailable" } : null,
        };
      return { data: [job], error: null };
    },
    from: (table) => {
      const filters = [];
      let update;
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters.push([key, value]);
          return query;
        },
        update(value) {
          update = value;
          return query;
        },
        single() {
          return query.then((v) => ({ ...v, data: v.data[0] ?? null }));
        },
        maybeSingle() {
          return query.single();
        },
        then(resolve) {
          const rows = (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
          if (update) {
            writes.push({ table, ...update });
            if (overrides.receiptFailure && update.state === "sent")
              return Promise.resolve({ data: null, error: { message: "receipt failure" } }).then(
                resolve,
              );
            rows.forEach((r) => Object.assign(r, update));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  let handler;
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith("https://api.vapi.ai/"))
      return Response.json(rawCall, { status: overrides.providerStatus ?? 200 });
    assert.equal(url, env.TEST_SLACK);
    return new Response("ok", { status: overrides.slackStatus ?? 200 });
  };
  const require = (id) => {
    if (id.includes("supabase-js")) return { createClient: () => db };
    if (id.endsWith("receptionist-data.ts")) return data;
    if (id.endsWith("receptionist-web-call.ts")) return web;
    throw Error(`Unexpected import ${id}`);
  };
  new Function("require", "exports", "Deno", "fetch", source)(
    require,
    {},
    {
      env: { get: (key) => env[key] },
      serve: (h) => {
        handler = h;
      },
    },
    request,
  );
  const run = (authorization = "Bearer dispatch") =>
    handler(
      new Request("https://local.invalid/functions/v1/client-notifications", {
        method: "POST",
        headers: { authorization },
      }),
    );
  return { run, calls, writes, claims, tables };
}

test("unauthorised dispatcher invocation claims nothing and contacts no provider", async () => {
  const f = fixture();
  assert.equal((await f.run("Bearer wrong")).status, 401);
  assert.equal(f.claims.length, 0);
  assert.equal(f.calls.length, 0);
});
test("completed practice report is read with scope checks then sent with exact escaped transcript", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.run()).json(), { sent: 1, processed: 1 });
  assert.equal(f.calls.length, 2);
  const text = JSON.parse(f.calls[1].options.body).text;
  assert.match(text, /Our office is close\. Is close\./);
  assert.match(text, /&lt;the greeting&gt; &amp;/);
  assert.doesNotMatch(text, /private\.example|secret|test-only/);
  assert.equal(f.tables.client_notification_outbox[0].state, "sent");
});
test("practice binding mismatch never discloses transcript to Slack", async () => {
  const f = fixture({
    call: {
      assistant: { metadata: { openfolkPracticeSession: "session", openfolkTenant: "foreign" } },
    },
  });
  assert.equal((await (await f.run()).json()).sent, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tables.client_notification_outbox[0].state, "failed");
  assert.equal(f.tables.client_notification_outbox[0].last_error, "Practice call scope mismatch");
});
test("an active call waits for completion rather than sending an incomplete transcript", async () => {
  const f = fixture({ call: { status: "in-progress" } });
  assert.equal((await (await f.run()).json()).sent, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.tables.client_notification_outbox[0].last_error, "Practice call still processing");
});
test("a feedback-to-session call mismatch is refused before provider access", async () => {
  const f = fixture({ feedback: { call_id: "foreign" } });
  await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.tables.client_notification_outbox[0].last_error,
    "Practice report binding unavailable",
  );
});
test("missing Slack configuration retains failed durable work and makes no outbound request", async () => {
  const f = fixture({ env: { TEST_SLACK: undefined } });
  await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(f.tables.client_notification_outbox[0].state, "failed");
});
test("non-Slack destinations are refused before any transcript is fetched", async () => {
  const f = fixture({ env: { TEST_SLACK: "https://example.invalid/collect" } });
  await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(f.tables.client_notification_outbox[0].last_error, "Invalid Slack destination");
});
test("a Slack failure retains the report with a later retry time", async () => {
  const f = fixture({ slackStatus: 429 });
  const before = Date.now();
  assert.equal((await (await f.run()).json()).sent, 0);
  const row = f.tables.client_notification_outbox[0];
  assert.equal(row.state, "failed");
  assert.ok(Date.parse(row.available_at) >= before + 110000);
});
test("losing the delivery receipt never increments confirmed sent count", async () => {
  const f = fixture({ receiptFailure: true });
  assert.equal((await (await f.run()).json()).sent, 0);
  assert.equal(f.tables.client_notification_outbox[0].state, "failed");
  assert.equal(f.tables.client_notification_outbox[0].last_error, "Delivery receipt not saved");
});
test("generic client feedback uses a private review link and does not fetch unrelated transcripts", async () => {
  const f = fixture({ job: { source_type: "programme_note" } });
  await f.run();
  assert.equal(f.calls.length, 1);
  const text = JSON.parse(f.calls[0].options.body).text;
  assert.match(text, /Client programme feedback/);
  assert.doesNotMatch(text, /Conversation transcript|Our office/);
});
test("a care-managed report never reaches the legacy webhook or claims a sent receipt", async () => {
  const f = fixture({ careManaged: true });
  assert.deepEqual(await (await f.run()).json(), { sent: 0, processed: 1 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
});
test("an unavailable cutover guard fails closed before provider or Slack reads", async () => {
  const f = fixture({ careRoutingError: true });
  assert.equal((await (await f.run()).json()).sent, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.tables.client_notification_outbox[0].state, "failed");
  assert.equal(
    f.tables.client_notification_outbox[0].last_error,
    "Notification routing could not be verified",
  );
});
