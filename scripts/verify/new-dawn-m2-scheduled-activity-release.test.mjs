import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  PROJECT,
  VERSION,
  NAME,
  SLUG,
  MERGED_SOURCE,
  assessStage,
  installEdge,
  installSql,
  migrationSql,
  pinnedSources,
  verifyDownloaded,
} from "./new-dawn-m2-scheduled-activity-release.mjs";

const source = pinnedSources();
const baseScope = {
  probe_table: false,
  event_table: false,
  probe_functions: 0,
  flag_rows: 0,
  authority_ready: true,
  operator_gate_ready: true,
  quota_gate_ready: true,
};
const edge = {
  slug: SLUG,
  version: 1,
  status: "ACTIVE",
  verify_jwt: false,
  ezbr_sha256: "a".repeat(64),
};
const snapshot = (stage) => ({
  project: { id: PROJECT, status: "ACTIVE_HEALTHY" },
  functions: stage === "complete" ? [edge] : [],
  scope: [
    {
      ...baseScope,
      probe_table: stage !== "absent",
      event_table: stage !== "absent",
      probe_functions: stage === "absent" ? 0 : 9,
    },
  ],
  ledger: stage === "absent" ? [] : [{ version: VERSION, name: NAME, statements: [source.sql] }],
});

test("release pins all merged sources and rejects changed scope", () => {
  assert.equal(MERGED_SOURCE.length, 40);
  assert.equal(source.files.length, 4);
  assert.throws(
    () =>
      pinnedSources((path) =>
        path.endsWith("retry_after.ts") ? Buffer.from("changed") : readFileSync(path),
      ),
    /reviewed_source_changed/,
  );
  assert.equal(source.closureSha256.length, 64);
  assert.equal(assessStage(snapshot("absent"), "absent").flagEnabled, false);
  assert.equal(assessStage(snapshot("sql"), "sql").state, "sql");
  assert.equal(assessStage(snapshot("complete"), "complete").edgeVersion, 1);
  assert.throws(() =>
    assessStage({ ...snapshot("absent"), scope: [{ ...baseScope, flag_rows: 1 }] }, "absent"),
  );
  assert.throws(() =>
    assessStage(
      { ...snapshot("sql"), ledger: [{ version: VERSION, name: NAME, statements: ["changed"] }] },
      "sql",
    ),
  );
  assert.match(migrationSql(source), /insert into supabase_migrations\.schema_migrations/);
  assert.match(migrationSql(source, true), /rollback;$/);
});

test("SQL installer reads back exact ledger and never silently replays unknown write", async () => {
  let stage = "absent",
    writes = 0;
  const options = {
    token: "synthetic",
    read: async () => snapshot(stage),
    grants: async () => true,
    write: async (sql) => {
      writes++;
      assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
      stage = "sql";
      return [{ installed_version: VERSION }];
    },
  };
  const result = await installSql(options);
  assert.equal(result.state, "exact_sql_installed");
  assert.equal(writes, 1);
  stage = "absent";
  await assert.rejects(
    installSql({
      ...options,
      write: async () => {
        writes++;
        throw Error("timeout");
      },
    }),
    /sql_outcome_unverified_no_replay/,
  );
  assert.equal(writes, 2);
});

test("Edge installer stages only the three pinned files and verifies downloaded source", async () => {
  let stage = "sql",
    attempts = 0,
    downloads = 0;
  const result = await installEdge({
    token: "synthetic",
    read: async () => snapshot(stage),
    grants: async () => true,
    runCli: (_cli, args, options) => {
      attempts++;
      assert.deepEqual(args.slice(0, 3), ["functions", "deploy", SLUG]);
      assert.ok(args.includes("--no-verify-jwt"));
      assert.ok(options.env.SUPABASE_ACCESS_TOKEN === "synthetic");
      for (const file of source.files.slice(1)) {
        assert.equal(
          readFileSync(join(options.env.NEW_DAWN_STAGE ?? args.at(-1), file.path), "utf8"),
          file.source,
        );
      }
      stage = "complete";
      return { status: 0 };
    },
    downloader: async (_token, root) => {
      downloads++;
      for (const file of source.files.slice(1)) {
        const path = join(
          root,
          "supabase/functions",
          SLUG,
          file.path.endsWith(`${SLUG}/index.ts`) ? "index.ts" : `work/${file.path}`,
        );
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.source);
      }
    },
  });
  assert.equal(result.state, "exact_edge_source_readback");
  assert.equal(attempts, 1);
  assert.equal(downloads, 1);
});

test("download readback accepts the current CLI layout, rejects ambiguity and changed source", () => {
  const root = mkdtempSync(join(tmpdir(), "scheduled-layout-test-"));
  try {
    for (const file of source.files.slice(1)) {
      const path = join(
        root,
        "supabase/functions",
        SLUG,
        file.path.endsWith(`${SLUG}/index.ts`)
          ? "index.ts"
          : `functions/${file.path.replace(/^supabase\/functions\//, "")}`,
      );
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.source);
    }
    assert.equal(verifyDownloaded(root, source), source.closureSha256);
    const shared = source.files.find((x) => x.path.endsWith("scheduled_activity_probe.ts"));
    const alternate = join(root, "supabase/functions", SLUG, "work", shared.path);
    mkdirSync(dirname(alternate), { recursive: true });
    writeFileSync(alternate, shared.source);
    assert.throws(() => verifyDownloaded(root, source), /downloaded_layout_missing_or_ambiguous/);
    rmSync(alternate);
    const current = join(
      root,
      "supabase/functions",
      SLUG,
      "functions/_shared/commusoft/scheduled_activity_probe.ts",
    );
    writeFileSync(current, shared.source.replace("response_invalid", "response_changed"));
    assert.throws(() => verifyDownloaded(root, source), /downloaded_source_changed/);
    rmSync(current);
    assert.throws(() => verifyDownloaded(root, source), /downloaded_layout_missing_or_ambiguous/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
