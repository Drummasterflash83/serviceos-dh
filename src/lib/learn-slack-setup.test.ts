import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadSlackConnections,
  slackChannelId,
  startSlackImport,
  validateSlackImportRequest,
  type SlackImportRequest,
} from "./learn-slack-setup.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request: SlackImportRequest = {
  requestId: id(1),
  tenantId: id(2),
  connection: {
    id: id(3),
    teamId: "T123",
    name: "Fixture workspace",
    revision: "2026-10-09T10:00:00Z",
  },
  channelId: "C123",
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-02T00:00:00Z",
  maxPages: 3,
  reason: "First import",
};
test("channel link parsing rejects other workspaces and destinations", () => {
  assert.equal(slackChannelId(" C123 ", "T123"), "C123");
  assert.equal(slackChannelId("https://app.slack.com/client/T123/C123", "T123"), "C123");
  for (const v of [
    "https://app.slack.com/client/T999/C123",
    "https://app.slack.com.evil.test/client/T123/C123",
    "https://user@app.slack.com/client/T123/C123",
    "javascript:alert(1)",
    "G123",
  ])
    assert.equal(slackChannelId(v, "T123"), null);
});
test("setup validation rejects invalid windows before any queue call", async () => {
  let calls = 0;
  const db: any = {
    rpc: async () => {
      calls++;
      return { error: null, data: {} };
    },
  };
  for (const change of [
    { end: "2026-01-01T00:00:00Z" },
    { end: "2026-01-03T00:00:00Z" },
    { start: "invalid" },
    { maxPages: 11 },
    { maxPages: 1.5 },
    { reason: " " },
    { requestId: "bad" },
  ])
    await assert.rejects(startSlackImport(db, { ...request, ...change }));
  assert.equal(calls, 0);
  assert.doesNotThrow(() => validateSlackImportRequest(request));
});
test("queue retries retain request identity and reject malformed acknowledgements", async () => {
  const calls: any[] = [];
  const db: any = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return {
        data: {
          requestId: request.requestId,
          accountId: id(4),
          jobId: id(5),
          reused: calls.length > 1,
        },
        error: null,
      };
    },
  };
  await startSlackImport(db, request);
  assert.equal((await startSlackImport(db, request)).reused, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].args.p_expected_revision, request.connection.revision);
  assert.equal(calls[0].args.token, undefined);
  await assert.rejects(
    startSlackImport(
      {
        rpc: async () => ({
          data: { requestId: id(99), accountId: id(4), jobId: id(5), reused: false },
          error: null,
        }),
      } as any,
      request,
    ),
    /verified/,
  );
});
test("connection metadata uses the logged tenant/operator RPC and checks returned tenant", async () => {
  const rows: any[] = [
    {
      id: id(3),
      tenant_id: id(2),
      status: "configured",
      revoked_at: null,
      updated_at: request.connection.revision,
      team_id: "T123",
      team_name: "Fixture workspace",
    },
  ];
  const calls: any[] = [];
  const db: any = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return { data: rows, error: null };
    },
  };
  assert.deepEqual(await loadSlackConnections(db, id(2)), [request.connection]);
  assert.deepEqual(calls, [{ name: "learn_slack_connections_read", args: { p_tenant_id: id(2) } }]);
  rows[0].tenant_id = id(99);
  await assert.rejects(loadSlackConnections(db, id(2)));
  rows.splice(0);
  assert.deepEqual(await loadSlackConnections(db, id(2)), []);
});

test("both legacy and HTTP conflict responses require a reload, not an uncertain retry", async () => {
  for (const code of ["40001", "PT409"]) {
    await assert.rejects(
      startSlackImport({ rpc: async () => ({ data: null, error: { code } }) } as any, request),
      /Reload setup/,
    );
  }
});
