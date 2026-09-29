import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  releaseCandidate,
  releaseHash,
  applyExactRelease,
} from "../../supabase/functions/_shared/receptionist-release.ts";
const source = {
  id: "assistant",
  updatedAt: "v1",
  voice: { provider: "voice" },
  firstMessage: "Original welcome",
  model: {
    provider: "openai",
    model: "gpt-4.1",
    toolIds: ["keep-tool"],
    messages: [{ role: "system", content: "Original rules" }],
  },
};
test("candidate adds exactly approved instructions without changing other configuration", () => {
  const { candidate, instruction } = releaseCandidate(
    source,
    "Do not repeat the closure.",
    "issue",
  );
  assert.equal((candidate as Record<string, unknown>).firstMessage, source.firstMessage);
  assert.deepEqual((candidate as Record<string, unknown>).voice, source.voice);
  assert.deepEqual((candidate.model as Record<string, unknown>).toolIds, source.model.toolIds);
  assert.deepEqual(candidate.model.messages[0], source.model.messages[0]);
  assert.match(instruction, /Do not repeat the closure/);
  assert.equal(source.model.messages.length, 1);
});
test("configuration hash ignores provider timestamps and key order, not real changes", async () => {
  assert.equal(await releaseHash(source), await releaseHash({ ...source, updatedAt: "v2" }));
  assert.notEqual(
    await releaseHash(source),
    await releaseHash({ ...source, firstMessage: "changed" }),
  );
});
test("stale configuration cannot be published", async () => {
  let patches = 0;
  const result = await applyExactRelease(
    {
      get: async () => ({ ...source, firstMessage: "external edit" }),
      patch: async () => {
        patches++;
      },
    },
    await releaseHash(source),
    releaseCandidate(source, "Approved wording", "issue").candidate,
  );
  assert.equal(result.state, "conflict");
  assert.equal(patches, 0);
});
test("publishing patches only model and proves the readback", async () => {
  let current = source as Record<string, unknown>;
  let sent: unknown;
  const target = releaseCandidate(source, "Approved wording", "issue").candidate;
  const result = await applyExactRelease(
    {
      get: async () => current,
      patch: async (body) => {
        sent = body;
        current = { ...current, ...body, updatedAt: "v2" };
      },
    },
    await releaseHash(source),
    target,
  );
  assert.deepEqual(Object.keys(sent as object), ["model"]);
  assert.equal(result.state, "applied");
});
test("lost PATCH response is reconciled without a duplicate write", async () => {
  let current = source as Record<string, unknown>;
  let patches = 0;
  const target = releaseCandidate(source, "Approved wording", "issue").candidate;
  const result = await applyExactRelease(
    {
      get: async () => current,
      patch: async (body) => {
        patches++;
        current = { ...current, ...body };
        throw Error("network lost");
      },
    },
    await releaseHash(source),
    target,
  );
  assert.equal(result.state, "applied");
  assert.equal(patches, 1);
});
test("unverified write is uncertain, never claimed as published", async () => {
  let patches = 0;
  const result = await applyExactRelease(
    {
      get: async () => source,
      patch: async () => {
        patches++;
        throw Error("timeout");
      },
    },
    await releaseHash(source),
    releaseCandidate(source, "Approved wording", "issue").candidate,
  );
  assert.equal(result.state, "uncertain");
  assert.equal(patches, 1);
});
test("rollback restores model only and refuses subsequent external edits", async () => {
  const target = releaseCandidate(source, "Approved wording", "issue").candidate;
  let current: Record<string, unknown> = target;
  const result = await applyExactRelease(
    {
      get: async () => current,
      patch: async (body) => {
        current = { ...current, ...body };
      },
    },
    await releaseHash(target),
    source,
  );
  assert.equal(result.state, "applied");
  assert.deepEqual(current.model, source.model);
});
test("client board uses shared design and safe progress, not operator internals", () => {
  const s = readFileSync(
    new URL("../components/receptionist/ClientFeedbackDesk.tsx", import.meta.url),
    "utf8",
  );
  assert.match(s, /deskStages/);
  assert.match(s, /feedback-desk.css/);
  assert.match(s, /care_customer_progress/);
  assert.doesNotMatch(
    s,
    /\.from\("receptionist_care_issues"\)|receptionist-release|PUBLISH_TO_VAPI/,
  );
});
test("release endpoint requires exact confirmation and real Chris authority", () => {
  const s = readFileSync(
    new URL("../../supabase/functions/receptionist-release/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(s, /care_desk_operator/);
  assert.match(s, /chris@openfolk.ai/);
  assert.match(s, /PUBLISH_TO_VAPI/);
  assert.match(s, /RESTORE_PREVIOUS_VERSION/);
  assert.doesNotMatch(s, /api.openai.com/);
});
