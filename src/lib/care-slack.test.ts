import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyCareChannel,
  postCareAlert,
  slackEscape,
} from "../../supabase/functions/_shared/care-slack.ts";
function mock(auth: unknown, channel: unknown) {
  let calls = 0;
  return {
    fetcher: (async () => Response.json(calls++ === 0 ? auth : channel)) as typeof fetch,
    get calls() {
      return calls;
    },
  };
}
test("refuses a requested workspace outside OpenFolk before network access", async () => {
  const m = mock({}, {});
  await assert.rejects(verifyCareChannel("key", "TOPENFOLK", "TCLIENT", "CEMMA", m.fetcher));
  assert.equal(m.calls, 0);
});
test("validates actual bot workspace", async () => {
  const m = mock({ ok: true, team_id: "TOTHER" }, {});
  await assert.rejects(
    verifyCareChannel("key", "TOPENFOLK", "TOPENFOLK", "CEMMA", m.fetcher),
    /workspace_mismatch/,
  );
});
for (const invalid of [
  { is_archived: true },
  { is_ext_shared: true },
  { is_shared: true },
  { is_member: false },
  { id: "CWRONG" },
])
  test(`refuses unsafe channel ${JSON.stringify(invalid)}`, async () => {
    const m = mock(
      { ok: true, team_id: "TOPENFOLK" },
      { ok: true, channel: { id: "CEMMA", name: "ai-emma", is_member: true, ...invalid } },
    );
    await assert.rejects(verifyCareChannel("key", "TOPENFOLK", "TOPENFOLK", "CEMMA", m.fetcher));
  });
test("returns verified channel identity", async () => {
  const m = mock(
    { ok: true, team_id: "TOPENFOLK" },
    { ok: true, channel: { id: "CEMMA", name: "ai-emma", is_member: true } },
  );
  assert.equal(
    (await verifyCareChannel("key", "TOPENFOLK", "TOPENFOLK", "CEMMA", m.fetcher)).name,
    "ai-emma",
  );
});
test("HTTP success alone is not Slack delivery", async () => {
  await assert.rejects(
    postCareAlert({
      token: "key",
      channel: "CEMMA",
      text: "Test",
      reference: "id",
      fetcher: (async () => Response.json({ ok: false })) as typeof fetch,
    }),
  );
});
test("wrong-channel receipt is refused", async () => {
  await assert.rejects(
    postCareAlert({
      token: "key",
      channel: "CEMMA",
      text: "Test",
      reference: "id",
      fetcher: (async () =>
        Response.json({ ok: true, channel: "COTHER", ts: "1.1" })) as typeof fetch,
    }),
  );
});
test("valid receipt retains channel and timestamp", async () => {
  const r = await postCareAlert({
    token: "key",
    channel: "CEMMA",
    text: "Test",
    reference: "id",
    fetcher: (async () => Response.json({ ok: true, channel: "CEMMA", ts: "1.1" })) as typeof fetch,
  });
  assert.deepEqual(r, { channel: "CEMMA", ts: "1.1" });
});
test("feedback cannot inject Slack mentions", () =>
  assert.equal(
    slackEscape("<!channel> & <https://bad>"),
    "&lt;!channel&gt; &amp; &lt;https://bad&gt;",
  ));
