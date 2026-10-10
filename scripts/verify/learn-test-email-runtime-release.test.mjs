import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  releaseRuntime,
  confirmRuntime,
  runtimePackage,
  RUNTIME_SHA,
  RUNTIME_MARKER,
} from "./learn-test-email-runtime-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const prior = JSON.parse(
  readFileSync(
    new URL(
      "../../supabase/release/learn-test/033_email_runtime.prerequisites.json",
      import.meta.url,
    ),
  ),
);
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "0".repeat(40), mode: "rehearse" };
const expectedFingerprint = "1".repeat(32);
const expectedCatalog = {
  ...prior.catalog,
  ledger: [
    ...prior.catalog.ledger,
    {
      migration_name: "learn_email_runtime_v1",
      source_sha256: RUNTIME_SHA,
      project_ref: TEST_PROJECT,
    },
  ],
};
function fixture({ lose = false, stale = false, changedSources = false, mode = "rehearse" } = {}) {
  const calls = [];
  let journal,
    writes = 0;
  return {
    calls,
    get journal() {
      return journal;
    },
    get writes() {
      return writes;
    },
    persistJournal: async (j) => {
      journal = structuredClone(j);
    },
    fetcher: async (url, options) => {
      assert.ok(
        String(url).startsWith(
          `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,
        ),
      );
      const body = JSON.parse(options.body);
      calls.push(body);
      if (body.read_only === false) {
        assert.ok(journal);
        writes++;
        if (lose) throw Error("PRIVATE_RESPONSE");
        return Response.json([
          {
            marker: RUNTIME_MARKER,
            fingerprint: expectedFingerprint,
            catalog: expectedCatalog,
            preserved: prior.preserved,
          },
        ]);
      }
      if (body.query.includes(" as catalog,"))
        return Response.json([
          {
            catalog: writes && mode === "apply" ? expectedCatalog : prior.catalog,
            fingerprint: stale
              ? "2".repeat(32)
              : writes && mode === "apply"
                ? expectedFingerprint
                : prior.fingerprint,
          },
        ]);
      const rows = structuredClone(prior.preserved);
      if (writes && changedSources) rows[0].count++;
      return Response.json(rows);
    },
  };
}
test("package is pinned and includes all source checks, atomic preservation and phone dependencies", () => {
  const { sql, manifest } = runtimePackage();
  assert.equal(manifest.sources.length, 9);
  assert.equal(sql.split("\nbegin;\n").length, 2);
  assert.equal(sql.split("\ncommit;\n").length, 2);
  assert.match(sql, /Exact email runtime prerequisites required/);
  assert.match(sql, /Existing TEST sources changed/);
  assert.match(sql, /security_invoker = on/);
  assert.match(
    sql,
    /revoke all on public.phone_recording_pipeline_state from public,anon,authenticated,service_role/,
  );
  assert.match(sql, /learn_email_enqueue/);
});
test("wrong project and unconfirmed apply are rejected before any hosted call", async () => {
  const f = fixture();
  await assert.rejects(
    releaseRuntime({ ...args, ...f, allowProjectRef: "production" }),
    /Explicit TEST/,
  );
  await assert.rejects(releaseRuntime({ ...args, ...f, mode: "apply" }), /Matching confirmed/);
  assert.equal(f.calls.length, 0);
});
test("stale prerequisites and failed journal persistence prevent submission", async () => {
  const stale = fixture({ stale: true });
  await assert.rejects(releaseRuntime({ ...args, ...stale }), /prerequisites changed/);
  assert.equal(stale.calls.length, 1);
  const f = fixture();
  await assert.rejects(
    releaseRuntime({
      ...args,
      ...f,
      persistJournal: async () => {
        throw Error("disk full");
      },
    }),
    /disk full/,
  );
  assert.equal(f.writes, 0);
});
test("lost response stays unconfirmed after one submission with a retained journal", async () => {
  const f = fixture({ lose: true });
  const result = await releaseRuntime({ ...args, ...f });
  assert.equal(result.state, "unconfirmed");
  assert.equal(f.writes, 1);
  assert.equal(f.calls.length, 3);
  assert.equal(f.journal.sourceSha256, RUNTIME_SHA);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESPONSE|sbp_/);
});
test("rehearsal rolls back and verifies both exact catalog and retained source fingerprints", async () => {
  const f = fixture();
  const result = await releaseRuntime({ ...args, ...f });
  assert.equal(result.state, "rehearsed_and_rolled_back");
  assert.equal(result.expectedFingerprint, expectedFingerprint);
  const command = f.calls.find((c) => c.read_only === false).query;
  assert.ok(command.endsWith("rollback;\n"));
  assert.doesNotMatch(command, /\ncommit;\n/);
  assert.equal(result.preservedDataSets, 52);
  const changed = fixture({ changedSources: true });
  assert.equal((await releaseRuntime({ ...args, ...changed })).state, "requires_inspection");
});
test("apply requires and confirms the rehearsed resulting catalog", async () => {
  const f = fixture({ mode: "apply" });
  const result = await releaseRuntime({
    ...args,
    ...f,
    mode: "apply",
    rehearsal: {
      state: "rehearsed_and_rolled_back",
      sourceSha256: RUNTIME_SHA,
      projectRef: TEST_PROJECT,
      expectedFingerprint,
    },
  });
  assert.equal(result.state, "installed_needs_runtime_acceptance");
  assert.ok(f.calls.find((c) => c.read_only === false).query.endsWith("commit;\n"));
});
test("uncertain-outcome confirmation only reads and never repeats a migration", async () => {
  const f = fixture();
  const result = await confirmRuntime({
    ...args,
    fetcher: f.fetcher,
    journal: {
      version: RUNTIME_MARKER,
      projectRef: TEST_PROJECT,
      sourceSha256: RUNTIME_SHA,
      mode: "rehearse",
      priorFingerprint: prior.fingerprint,
      sources: prior.preserved,
    },
  });
  assert.equal(result.state, "prior_state_confirmed");
  assert.equal(result.writeAttempted, false);
  assert.equal(f.writes, 0);
  assert.equal(f.calls.length, 2);
});
