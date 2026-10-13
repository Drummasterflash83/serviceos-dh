import test from "node:test";
import assert from "node:assert/strict";
import { runLearnInputTick } from "./learn_input_tick.ts";
import { slackWorkerEndpoint } from "./slack/slack_worker_http.ts";

const config = {
  enabled: "true", url: "https://abcdefghijklmnopqrst.supabase.co",
  serviceKey: "synthetic-gateway-token", commusoftKey: "synthetic-commusoft-trigger", slackKey: "synthetic-slack-trigger",
};
const idle = { claimed: 0, outcomes: [] };
const schedule = { checked: 0, queued: 0, held: 0 };
const ok = (result: unknown) => Response.json({ ok: true, result });

test("disabled or filtered calls never dispatch; invalid configuration fails closed", async () => {
  let calls = 0;
  const request = async () => { calls++; throw Error("must not run"); };
  for (const enabled of [undefined, "false", "TRUE", "1"])
    assert.equal((await runLearnInputTick({ ...config, enabled }, null, request)).commusoft.state, "disabled");
  for (const filter of [[], ["email.gmail_sync"], ["commusoft.source_sync"], ["slack.history_sync"]])
    assert.equal((await runLearnInputTick(config, filter, request)).slack.state, "skipped");
  for (const url of ["https://wrong.invalid", config.url + "/redirect", "http://abcdefghijklmnopqrst.supabase.co"])
    assert.equal((await runLearnInputTick({ ...config, url }, null, request)).commusoft.state, "unconfirmed");
  assert.equal(calls, 0);
});

test("server dispatch reaches actual empty-body guards and schedules Slack before its worker", async () => {
  const calls: string[] = [];
  const handlers = {
    "learn-commusoft-worker": slackWorkerEndpoint(config.commusoftKey, async () => idle),
    "learn-slack-schedule": slackWorkerEndpoint(config.slackKey, async () => schedule),
    "learn-slack-worker": slackWorkerEndpoint(config.slackKey, async () => idle),
  };
  const result = await runLearnInputTick(config, null, async (url, init) => {
    const name = new URL(url).pathname.split("/").pop()! as keyof typeof handlers;
    assert.equal(init.body, undefined);
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${config.serviceKey}`);
    assert.equal(init.signal?.aborted, false);
    calls.push(name);
    return handlers[name](new Request(url, init));
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.indexOf("learn-slack-schedule") < calls.indexOf("learn-slack-worker"));
  assert.deepEqual(Object.values(result).map(v => v.state), ["idle", "idle", "idle"]);
});

test("failed scheduler and provider do not stop independent work or disclose private errors", async () => {
  const calls: string[] = [];
  const result = await runLearnInputTick(config, null, async url => {
    calls.push(url);
    if (url.endsWith("commusoft-worker")) throw Error("secret and private customer content");
    if (url.endsWith("slack-schedule")) return new Response("private failure", { status: 503 });
    return ok({ claimed: 1, outcomes: [{ status: "succeeded", job_id: "private-id" }] });
  });
  assert.deepEqual(result, { commusoft: { state: "unconfirmed" }, slackSchedule: { state: "unconfirmed" }, slack: { state: "processed" } });
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /secret|private/);
});

test("HTTP success without matching settlement is unconfirmed; retries and holds need attention", async () => {
  for (const result of [{}, { claimed: 1, outcomes: [] }, { claimed: 2, outcomes: [{}, {}] }, { claimed: 1, outcomes: [{ status: "made_up" }] }]) {
    const observed = await runLearnInputTick(config, null, async url => ok(url.endsWith("schedule") ? schedule : result));
    assert.equal(observed.commusoft.state, "unconfirmed");
    assert.equal(observed.slack.state, "unconfirmed");
  }
  for (const settled of [{ status: "retrying" }, { status: "dead_letter" }, { state: "waiting", reason: "paused" }]) {
    const observed = await runLearnInputTick(config, null, async url => ok(url.endsWith("schedule")
      ? { checked: 1, queued: 0, held: 1 } : { claimed: 1, outcomes: [settled] }));
    assert.deepEqual(Object.values(observed).map(v => v.state), ["attention", "attention", "attention"]);
  }
});

test("missing trigger key cannot send gateway credentials to that worker; no automatic retries", async () => {
  const calls: string[] = [];
  const result = await runLearnInputTick({ ...config, commusoftKey: undefined }, null, async url => {
    calls.push(url); return new Response(null, { status: 429 });
  });
  assert.equal(result.commusoft.state, "unconfirmed");
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(url => url.endsWith("slack-worker")).length, 1);
  assert.ok(calls.every(url => !url.includes("commusoft")));
});

test("Slack-only scheduling reaches the real endpoint guards without invoking Commusoft", async () => {
  const calls: string[] = [];
  const handlers = {
    "learn-slack-schedule": slackWorkerEndpoint(config.slackKey, async () => schedule),
    "learn-slack-worker": slackWorkerEndpoint(config.slackKey, async () => idle),
  };
  const result = await runLearnInputTick({ ...config, enabled: "false", slackEnabled: "true", commusoftKey: undefined }, null, async (url, init) => {
    const name = new URL(url).pathname.split("/").pop()! as keyof typeof handlers;
    assert.ok(name in handlers, "Slack-only dispatch must never reach another provider");
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get("x-serviceos-worker-key"), config.slackKey);
    calls.push(name);
    return handlers[name](new Request(url, init));
  });
  assert.deepEqual(calls, ["learn-slack-schedule", "learn-slack-worker"]);
  assert.deepEqual(result, { commusoft: { state: "disabled" }, slackSchedule: { state: "idle" }, slack: { state: "idle" } });
});

test("explicit Slack disable, malformed override and filtered invocations fail closed", async () => {
  for (const slackEnabled of ["false", "TRUE", "1", "", " true "]) {
    const calls: string[] = [];
    const result = await runLearnInputTick({ ...config, slackEnabled }, null, async url => { calls.push(url); return ok(idle); });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith("learn-commusoft-worker"));
    assert.equal(result.slack.state, "disabled");
    assert.equal(result.slackSchedule.state, "disabled");
  }
  for (const filter of [[], ["slack.history_sync"], ["phone.voicemail_import"]]) {
    const result = await runLearnInputTick({ ...config, enabled: "false", slackEnabled: "true" }, filter, async () => { throw Error("filtered calls cannot dispatch"); });
    assert.deepEqual(Object.values(result).map(v => v.state), ["skipped", "skipped", "skipped"]);
  }
});

test("Slack-only configuration errors and provider failures cannot fall back to Commusoft", async () => {
  const cfg = { ...config, enabled: "false", slackEnabled: "true" };
  for (const patch of [{ url: "https://wrong.invalid" }, { serviceKey: undefined }, { slackKey: undefined }]) {
    let calls = 0;
    const result = await runLearnInputTick({ ...cfg, ...patch }, null, async () => { calls++; throw Error("must not send credentials"); });
    assert.equal(calls, 0);
    assert.equal(result.commusoft.state, "disabled");
    assert.equal(result.slack.state, "unconfirmed");
  }
  const calls: string[] = [];
  const result = await runLearnInputTick(cfg, null, async url => { calls.push(url); return new Response(null, { status: 429 }); });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.includes("commusoft")));
  assert.equal(result.commusoft.state, "disabled");
  assert.equal(result.slack.state, "unconfirmed");
});
