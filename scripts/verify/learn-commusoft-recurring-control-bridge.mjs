/** Real application request/outbox + real recurring SQL; disposable synthetic DB only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readCommusoftRecurring,
  readSavedCommusoftRecurring,
  resolveSavedCommusoftRecurring,
} from "../../src/lib/learn-commusoft-recurring.ts";
const [docker, container] = process.argv.slice(2);
if (!docker || !/^serviceos-contact-traversal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Disposable fixture required");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(100), actorId: id(180), backend: "https://synthetic.example.invalid" };
const lit = (v) =>
  `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
const user = `set request.jwt.claim.role='authenticated';set request.jwt.claim.sub=${lit(scope.actorId)};set role authenticated;`;
const sql = (q) =>
  execFileSync(
    docker,
    ["exec", container, "psql", "-X", "-qAt", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", q],
    { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
  ).trim();
const params = {
  learn_commusoft_recurring_read: ["p_tenant"],
  current_user_is_openfolk_operator: ["required_permission"],
  learn_commusoft_recurring_control: ["p_tenant", "p_request", "p_actor", "p_definition", "p_mode"],
};
let loseNextApply = false,
  applies = 0;
const db = {
  rpc: async (name, args) => {
    assert.ok(params[name]);
    assert.deepEqual(Object.keys(args).sort(), [...params[name]].sort());
    const data = JSON.parse(
      sql(user + `select to_jsonb(${name}(${params[name].map((k) => lit(args[k])).join(",")}));`),
    );
    if (name === "learn_commusoft_recurring_control" && args.p_mode === "apply") {
      applies++;
      if (loseNextApply) {
        loseNextApply = false;
        throw Error("Synthetic lost response after SQL committed");
      }
    }
    return { data, error: null };
  },
};
const values = new Map();
const store = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
  removeItem: (k) => values.delete(k),
};
const lock = async (_key, task) => task();
const fingerprint = () =>
  sql(
    "select md5(coalesce(string_agg(v::text,'' order by v::text),'')) from (select to_jsonb(p) v from learn_business_input_pages p union all select to_jsonb(v) from learn_business_input_versions v) q;",
  );
const before = fingerprint();
let account = (await readCommusoftRecurring(db, scope.tenantId)).accounts[0];
assert.equal(account.enabled, true);
const draft = (n, enabled) => ({
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    requestId: id(n),
    definition: {
      account_id: account.account_id,
      expected_revision: account.revision,
      enabled,
      max_pages: account.max_pages,
      page_size: account.page_size,
      reason: "Synthetic application-to-SQL acceptance",
    },
  },
});
const pause = draft(940, false);
loseNextApply = true;
await assert.rejects(
  resolveSavedCommusoftRecurring(db, store, lock, scope, pause, "apply", () => true),
);
assert.ok(readSavedCommusoftRecurring(store, scope));
assert.equal(
  (await resolveSavedCommusoftRecurring(db, store, lock, scope, pause, "check", () => true))
    .enabled,
  false,
);
assert.equal(applies, 1);
account = (await readCommusoftRecurring(db, scope.tenantId)).accounts[0];
assert.equal(account.enabled, false);
assert.equal(account.last_state, "paused");
const resume = draft(941, true);
assert.equal(
  (await resolveSavedCommusoftRecurring(db, store, lock, scope, resume, "apply", () => true))
    .enabled,
  true,
);
assert.equal(applies, 2);
account = (await readCommusoftRecurring(db, scope.tenantId)).accounts[0];
assert.equal(account.enabled, true);
assert.equal(fingerprint(), before);
assert.equal(values.size, 0);
console.log(
  JSON.stringify({
    state: "commusoft_recurring_application_sql_verified",
    lostResponseReconciled: true,
    applyCount: applies,
    pauseResume: true,
    sourcePagesAndVersionsPreserved: true,
    hostedChanges: 0,
    providerRequests: 0,
  }),
);
