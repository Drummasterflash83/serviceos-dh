import test from "node:test";
import assert from "node:assert/strict";
import {
  deployIdentityInventory,
  IDENTITY_SCHEMA,
  IDENTITY_RUNTIME_DATABASE,
} from "./learn-test-identity-inventory-deploy.mjs";
import {
  CARD_SEARCH_SNAPSHOT,
  CARD_SEARCH_PRESERVED,
  CARD_SEARCH_TABLES,
} from "./learn-card-search-catalog.mjs";
import { RUNTIME_PRESERVED } from "./learn-email-runtime-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
function fixture({
  version = 3,
  changed = false,
  schema = IDENTITY_SCHEMA,
  failJournal = false,
  exitStatus = 0,
} = {}) {
  let submitted = 0,
    journal = null;
  const rows = (names) => names.map((name) => ({ name, count: 0, fingerprint: "0".repeat(32) }));
  return {
    get submitted() {
      return submitted;
    },
    get journal() {
      return journal;
    },
    args: {
      allowProjectRef: TEST_PROJECT,
      token: "sbp_" + "0".repeat(40),
      persistJournal: async (value) => {
        if (failJournal) throw Error("journal denied");
        journal = value;
      },
      fetcher: async (url, options) => {
        assert.ok(url.startsWith(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/`));
        if (url.endsWith("/functions"))
          return Response.json([
            {
              slug: "openfolk-control-plane",
              status: "ACTIVE",
              version: submitted ? version + 1 : version,
              verify_jwt: false,
            },
            { slug: "existing-worker", version: 4, status: "ACTIVE", verify_jwt: true },
          ]);
        const query = JSON.parse(options.body).query;
        if (query === CARD_SEARCH_SNAPSHOT) {
          const data = rows(CARD_SEARCH_PRESERVED);
          if (submitted && changed) data[0].count = 1;
          return Response.json(data);
        }
        if (query.includes("as catalog"))
          return Response.json([
            {
              fingerprint: query.includes("learn_card_search") ? schema : IDENTITY_RUNTIME_DATABASE,
              catalog: query.includes("learn_card_search")
                ? {
                    functions: [{}],
                    tables: CARD_SEARCH_TABLES.map((name) => ({ name, rls: true })),
                    base: { functions: Array.from({ length: 27 }, () => ({})) },
                  }
                : { functions: [] },
            },
          ]);
        return Response.json(rows(RUNTIME_PRESERVED));
      },
      runCli: (_binary, args) => {
        assert.ok(journal);
        assert.equal(journal.identityPreserved.length, 101);
        assert.equal(submitted, 0);
        assert.equal(args[2], "openfolk-control-plane");
        submitted++;
        return { status: exitStatus };
      },
    },
  };
}
test("pinned replacement journals the complete inventory, replaces only v3 and preserves sources", async () => {
  const f = fixture();
  const result = await deployIdentityInventory(f.args);
  assert.equal(f.submitted, 1);
  assert.equal(result.state, "deployed_needs_http_acceptance");
  assert.equal(result.identityInventoryPreserved, true);
  assert.equal(result.preservedDataSets, 101);
  assert.equal(result.endpoints[0].version, 4);
});
test("wrong target, schema, version or failed journal prevent submission", async () => {
  for (const options of [{ schema: "0".repeat(32) }, { version: 4 }, { failJournal: true }]) {
    const f = fixture(options);
    await assert.rejects(deployIdentityInventory(f.args));
    assert.equal(f.submitted, 0);
  }
  const f = fixture();
  await assert.rejects(deployIdentityInventory({ ...f.args, allowProjectRef: "production" }));
  await assert.rejects(
    deployIdentityInventory({ ...f.args, replaceVersions: { "openfolk-control-plane": 2 } }),
  );
  assert.equal(f.submitted, 0);
});
test("changed retained records and unknown CLI outcomes cannot report success or resubmit", async () => {
  for (const options of [{ changed: true }, { exitStatus: null }]) {
    const f = fixture(options);
    const result = await deployIdentityInventory(f.args);
    assert.equal(result.state, "requires_inspection");
    assert.equal(f.submitted, 1);
  }
});
