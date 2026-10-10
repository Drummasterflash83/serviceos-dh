import test from "node:test";
import assert from "node:assert/strict";
import { loadCommusoftReviewPage } from "./learn-commusoft-review.ts";
import { loadWorkPage } from "./learn-commusoft-work.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = { tenant_id: id(1), connection_id: id(2), rows: [], next_cursor: null };
test("customer search sends its trimmed term and cursor to the server, not a local page filter", async () => {
  const page = await loadCommusoftReviewPage(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_commusoft_review_search");
        assert.deepEqual(args, {
          p_tenant: id(1),
          p_connection: id(2),
          p_search: "Smith",
          p_after: "150",
          p_limit: 20,
        });
        return { data: { ...envelope, search: "Smith" }, error: null };
      },
    },
    id(1),
    id(2),
    "150",
    " Smith ",
  );
  assert.deepEqual(page, { rows: [], next: null });
});
test("each work kind searches with its own scope and echoes the exact applied term", async () => {
  for (const kind of ["job", "site", "contact"] as const) {
    await loadWorkPage(
      {
        rpc: async (name, args) => {
          assert.equal(name, "learn_commusoft_work_review_search");
          assert.equal(args.p_kind, kind);
          assert.equal(args.p_search, "800001");
          return { data: { ...envelope, kind, search: "800001" }, error: null };
        },
      },
      id(1),
      id(2),
      kind,
      null,
      "800001",
    );
  }
});
test("mismatched, missing or failed search replies cannot become an empty successful list or fall back to browse", async () => {
  for (const search of [undefined, "other"]) {
    await assert.rejects(
      loadCommusoftReviewPage(
        { rpc: async () => ({ data: { ...envelope, search }, error: null }) },
        id(1),
        id(2),
        null,
        "Smith",
      ),
    );
    await assert.rejects(
      loadWorkPage(
        { rpc: async () => ({ data: { ...envelope, kind: "job", search }, error: null }) },
        id(1),
        id(2),
        "job",
        null,
        "Smith",
      ),
    );
  }
  let calls = 0;
  await assert.rejects(
    loadCommusoftReviewPage(
      {
        rpc: async () => {
          calls++;
          return { data: null, error: { message: "Search unavailable" } };
        },
      },
      id(1),
      id(2),
      null,
      "Smith",
    ),
  );
  assert.equal(calls, 1);
});
test("oversized searches are refused before access, and clearing a search requests the empty server scope", async () => {
  const forbidden = {
    rpc: async () => {
      throw Error("Unexpected RPC");
    },
  };
  await assert.rejects(loadCommusoftReviewPage(forbidden, id(1), id(2), null, "a".repeat(151)));
  await assert.rejects(loadWorkPage(forbidden, id(1), id(2), "job", null, "a".repeat(151)));
  await loadCommusoftReviewPage(
    {
      rpc: async (name, args) => {
        assert.equal(name, "learn_commusoft_review_search");
        assert.equal(args.p_search, "");
        return { data: { ...envelope, search: "" }, error: null };
      },
    },
    id(1),
    id(2),
    null,
    "",
  );
});
test("search cannot weaken tenant, connection or pagination validation", async () => {
  for (const patch of [{ tenant_id: id(9) }, { connection_id: id(9) }, { next_cursor: "123" }]) {
    await assert.rejects(
      loadCommusoftReviewPage(
        { rpc: async () => ({ data: { ...envelope, search: "Smith", ...patch }, error: null }) },
        id(1),
        id(2),
        null,
        "Smith",
      ),
    );
    await assert.rejects(
      loadWorkPage(
        {
          rpc: async () => ({
            data: { ...envelope, kind: "job", search: "Smith", ...patch },
            error: null,
          }),
        },
        id(1),
        id(2),
        "job",
        null,
        "Smith",
      ),
    );
  }
});
