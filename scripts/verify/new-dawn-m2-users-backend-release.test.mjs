import assert from "node:assert/strict";
import test from "node:test";
import {
  assess,
  assessDownloadedWorker,
  FUNCTIONS,
  installLive,
  NAME,
  PROJECT,
  releaseSql,
  RESUME_NAME,
  RESUME_SOURCE_SHA256,
  RESUME_VERSION,
  resumeSource,
  source,
  SOURCE_SHA256,
  VERSION,
  WORKER,
} from "./new-dawn-m2-users-backend-release.mjs";

function catalog(stage = "before") {
  return {
    functions: Object.entries(FUNCTIONS).map(([signature, x]) => ({
      signature,
      hash: x[stage],
      definer: true,
      config: ["search_path=pg_catalog"],
      anon: false,
      authenticated: x.authenticated,
      service: x.service,
    })),
    ledger:
      stage === "after"
        ? [
            { version: VERSION, name: NAME, statements: [source().text] },
            { version: RESUME_VERSION, name: RESUME_NAME, statements: [resumeSource().text] },
          ]
        : [],
    flag_count: 0,
    active_jobs: 0,
    source_versions: 0,
    base_flags: 2,
    connections: 1,
  };
}

test("exact source, default-off stage and immutable ledger receipt", () => {
  assert.match(SOURCE_SHA256, /^[a-f0-9]{64}$/);
  assert.match(RESUME_SOURCE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(assess(catalog()).state, "users_backend_ready_default_off");
  assert.equal(assess(catalog("after"), "after").state, "users_backend_installed_default_off");
  for (const mutate of [
    (c) => (c.flag_count = 1),
    (c) => (c.active_jobs = 1),
    (c) => (c.source_versions = 1),
    (c) => (c.functions[0].hash = "0".repeat(64)),
    (c) => (c.functions[0].anon = true),
    (c) => (c.functions[0].service = false),
    (c) => c.functions.push(c.functions[0]),
  ]) {
    const c = catalog();
    mutate(c);
    assert.throws(() => assess(c));
  }
  const wrong = catalog("after");
  wrong.ledger[0].statements = ["changed"];
  assert.throws(() => assess(wrong, "after"));
});

test("transaction only changes four authority functions and two exact ledger rows", () => {
  const sql = releaseSql();
  assert.match(sql, /^begin;\n/);
  assert.match(sql, /lock table supabase_migrations\.schema_migrations/);
  assert.match(sql, /users_exact_live_preflight_changed/);
  assert.equal(sql.match(/insert into supabase_migrations\.schema_migrations/g)?.length, 1);
  assert.match(sql, /pages<>retained\+1/);
  assert.match(sql, /learn\.inputs\.commusoft\.users\.enabled/);
  assert.match(sql, /\ncommit;$/);
  assert.match(releaseSql(true), /\nrollback;$/);
  assert.doesNotMatch(sql, /insert into public\.feature_flags|update public\.feature_flags/i);
  for (const x of Object.values(FUNCTIONS)) assert.ok(sql.includes(x.before));
});

test("unknown LIVE write is read back once and never automatically replayed", async () => {
  const worker = {
    slug: WORKER.slug,
    version: WORKER.version,
    ezbr_sha256: WORKER.hash,
    status: "ACTIVE",
    verify_jwt: true,
  };
  let reads = 0,
    writes = 0;
  const result = await installLive({
    token: "synthetic",
    read: async () => ({
      catalog: ++reads === 1 ? catalog() : catalog("after"),
      worker,
    }),
    write: async () => {
      writes++;
      throw Error("transport_unknown");
    },
  });
  assert.equal(result.state, "users_backend_installed_default_off");
  assert.equal(result.acknowledged, false);
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  reads = 0;
  writes = 0;
  await assert.rejects(
    installLive({
      token: "synthetic",
      read: async () => ({
        catalog: (reads++, catalog()),
        worker,
      }),
      write: async () => {
        writes++;
        throw Error("unknown");
      },
    }),
    /users_install_outcome_unverified_no_replay/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 1);
});

test("downloaded worker must match exact pinned LIVE source and /users bounds", () => {
  assert.equal(WORKER.slug, "learn-commusoft-worker");
  assert.equal(WORKER.version, 11);
  assert.match(WORKER.hash, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      assessDownloadedWorker("/nonexistent", {
        slug: WORKER.slug,
        version: 12,
        ezbr_sha256: WORKER.hash,
        status: "ACTIVE",
        verify_jwt: true,
      }),
    /users_worker_version_changed/,
  );
  assert.equal(PROJECT, "tgbnakbxwcqjeimygroz");
});
