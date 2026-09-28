import test from "node:test";
import assert from "node:assert/strict";
import { PracticeFeedbackDraft, type PracticeDraft } from "./practice-feedback-draft.ts";

function fixture(initial: PracticeDraft = { id: "report", body: "", version: 0 }) {
  const saves: PracticeDraft[] = [],
    reports: PracticeDraft[] = [];
  const draft = new PracticeFeedbackDraft(initial, {
    save: async (next) => {
      saves.push({ ...next });
      return { ...next, version: next.version + 1 };
    },
    complete: async (next) => {
      reports.push({ ...next });
      return next.body.trim() ? "feedback" : null;
    },
  });
  return { draft, saves, reports };
}

test("a call with no typed feedback creates no empty report", async () => {
  const { draft, saves, reports } = fixture();
  assert.equal(await draft.complete(), null);
  assert.equal(saves.length, 0);
  assert.equal(reports.length, 0);
});
test("typing is saved separately from submitting an improvement", async () => {
  const { draft, saves, reports } = fixture();
  draft.edit("Please shorten the greeting.");
  await draft.persist();
  assert.equal(saves.length, 1);
  assert.equal(reports.length, 0);
  assert.equal(draft.dirty, false);
});
test("navigation waits for latest text and submits one bound report", async () => {
  const { draft, saves, reports } = fixture();
  draft.edit("First thought");
  const pending = draft.persist();
  draft.edit("The complete thought");
  const completed = draft.complete();
  await pending;
  assert.equal(await completed, "feedback");
  assert.equal(reports[0].body, "The complete thought");
  assert.equal(reports[0].id, "report");
  assert.equal(saves.length, 1);
});
test("simultaneous explicit Save, navigation and unmount finalise once", async () => {
  const { draft, reports } = fixture();
  draft.edit("Avoid repeating opening hours.");
  assert.deepEqual(await Promise.all([draft.complete(), draft.complete(), draft.complete()]), [
    "feedback",
    "feedback",
    "feedback",
  ]);
  assert.equal(reports.length, 1);
});
test("a restored server draft retains its submission ID and version", async () => {
  const { draft, saves, reports } = fixture({
    id: "restored",
    body: "Saved before closing",
    version: 8,
  });
  await draft.complete();
  assert.equal(saves.length, 0);
  assert.deepEqual(reports[0], { id: "restored", body: "Saved before closing", version: 8 });
});
test("failed autosave never claims complete and a retry can recover", async () => {
  let tries = 0,
    submitted = 0;
  const draft = new PracticeFeedbackDraft(
    { id: "retry", body: "", version: 0 },
    {
      save: async (next) => {
        if (++tries === 1) throw Error("offline");
        return { ...next, version: 1 };
      },
      complete: async () => {
        submitted++;
        return "feedback";
      },
    },
  );
  draft.edit("Keep this note.");
  await assert.rejects(draft.complete(), /offline/);
  assert.equal(submitted, 0);
  assert.equal(draft.dirty, true);
  assert.equal(await draft.complete(), "feedback");
});
test("failed acknowledgement retries the same submission without resaving", async () => {
  let saves = 0,
    completions = 0;
  const draft = new PracticeFeedbackDraft(
    { id: "retry", body: "", version: 0 },
    {
      save: async (next) => {
        saves++;
        return { ...next, version: 1 };
      },
      complete: async (next) => {
        assert.equal(next.id, "retry");
        if (++completions === 1) throw Error("receipt lost");
        return "feedback";
      },
    },
  );
  draft.edit("Same submission");
  await assert.rejects(draft.complete());
  assert.equal(await draft.complete(), "feedback");
  assert.equal(saves, 1);
});
test("clearing an acknowledged draft finalises without a fabricated feedback note", async () => {
  const { draft, reports } = fixture({ id: "cleared", body: "Changed my mind", version: 1 });
  draft.edit("");
  assert.equal(await draft.complete(), null);
  assert.equal(reports[0].body, "");
  assert.equal(reports[0].version, 2);
  draft.edit("A new thought after clearing");
  assert.equal(await draft.complete(), "feedback");
});
test("edits arriving during save are persisted before report finalisation", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saves: string[] = [];
  const draft = new PracticeFeedbackDraft(
    { id: "race", body: "", version: 0 },
    {
      save: async (next) => {
        saves.push(next.body);
        if (saves.length === 1) await blocked;
        return { ...next, version: next.version + 1 };
      },
      complete: async (next) => {
        assert.equal(next.body, "Latest");
        assert.equal(next.version, 2);
        return "feedback";
      },
    },
  );
  draft.edit("First");
  const saving = draft.persist();
  await new Promise((resolve) => setTimeout(resolve, 0));
  draft.edit("Latest");
  const completing = draft.complete();
  release();
  await saving;
  assert.equal(await completing, "feedback");
  assert.deepEqual(saves, ["First", "Latest"]);
});
