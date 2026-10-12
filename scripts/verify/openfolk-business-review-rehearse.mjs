/** Full existing TEST schema; new function and synthetic access always roll back. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { preservationQuery } from "./learn-commusoft-operator-run.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const stem = ".verification-results/operator-business-review-rehearsal-v1";
if (
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
  process.argv.slice(2).join(" ") !== "--rehearse"
)
  throw Error("Explicit TEST rehearsal required");
const token = savedCliToken(),
  q = (sql, readOnly = true) =>
    communicationQuery(token, sql, {
      readOnly,
      fetcher: async (url, options) => {
        const r = await fetch(url, options);
        if (!r.ok)
          writeFileSync(stem + "-error-private.txt", await r.clone().text(), { mode: 0o600 });
        return r;
      },
    });
const files = [
  "supabase/migrations/20261101510000_openfolk_business_review.sql",
  "scripts/verify/openfolk-business-review.assert.sql",
];
const texts = files.map((p) => readFileSync(p, "utf8")),
  hash = (s) => createHash("sha256").update(s).digest("hex");
const tables = (
  await q(
    "select n.nspname||'.'||c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where ((n.nspname in('public','storage','vault')) or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1",
  )
).map((r) => r.name);
if (
  tables.length < 192 ||
  tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Unexpected dataset inventory");
// The supervised contact worker is active. Preserve every pre-run source row
// and every unrelated dataset; its exact permitted appends are checked separately.
const run = JSON.parse(readFileSync(".verification-results/commusoft-operator-2026-10-12.json"));
if (run.tables.length !== tables.length) throw Error("Preservation table set changed");
const snapshot = preservationQuery(run);
const catalog = `select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'' order by p.oid),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in('f','p')`;
const prior = await q(catalog),
  before = await q(snapshot);
const exists = await q(
  "select to_regprocedure('public.openfolk_business_review(uuid,text,text,jsonb)') is null absent",
);
if (exists[0]?.absent !== true) throw Error("Reader already installed; inspect before retry");
const journal = {
  project: TEST_PROJECT,
  startedAt: new Date().toISOString(),
  sources: files.map((path, i) => ({ path, sha256: hash(texts[i]) })),
  prior,
  before,
};
writeFileSync(stem + "-journal.json", JSON.stringify(journal, null, 2), {
  mode: 0o600,
  flag: "wx",
});
const body = texts[0].replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
let passed = false;
try {
  const r = await q(
    `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';${body}\n${texts[1]}\nselect 'operator_business_review_rehearsed' marker;rollback;`,
    false,
  );
  passed = r.some((x) => x.marker === "operator_business_review_rehearsed");
} catch {
  passed = false;
}
const after = await q(snapshot),
  post = await q(catalog),
  sort = (rs) => JSON.stringify(rs.sort((a, b) => a.name.localeCompare(b.name)));
const result = {
  state:
    passed && sort(before) === sort(after) && JSON.stringify(prior) === JSON.stringify(post)
      ? "passed_rolled_back"
      : "requires_inspection",
  project: TEST_PROJECT,
  observedAt: new Date().toISOString(),
  sources: journal.sources,
  preservedDatasets: sort(before) === sort(after) ? tables.length : null,
  priorCatalogRestored: JSON.stringify(prior) === JSON.stringify(post),
  newAccountsRetained: 0,
  newGrantsRetained: 0,
  providerCalls: 0,
  productionChanged: false,
};
writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
  mode: 0o600,
  flag: "wx",
});
console.log(JSON.stringify(result, null, 2));
if (result.state !== "passed_rolled_back") process.exitCode = 1;
