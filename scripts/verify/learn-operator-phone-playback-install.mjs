/** Install the exact rehearsed additive reader in TEST; no provider/source writes. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { preservationQuery } from "./learn-commusoft-operator-run.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const stem = ".verification-results/operator-phone-playback-install-v1";
if (
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT ||
  process.argv.slice(2).join(" ") !== "--apply"
)
  throw Error("Explicit TEST install required");
const rehearsal = JSON.parse(
  readFileSync(".verification-results/operator-phone-playback-rehearsal-v1-result.json"),
);
const old = JSON.parse(
  readFileSync(".verification-results/operator-phone-playback-rehearsal-v1-journal.json"),
);
const hash = (s) => createHash("sha256").update(s).digest("hex");
if (
  rehearsal.state !== "passed_rolled_back" ||
  rehearsal.project !== TEST_PROJECT ||
  Date.now() - Date.parse(rehearsal.observedAt) > 3600000 ||
  !rehearsal.sources.every((s) => hash(readFileSync(s.path)) === s.sha256)
)
  throw Error("Fresh exact rehearsal required");
const token = savedCliToken(),
  q = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const tables = old.before.map((r) => r.name);
if (
  tables.length !== 194 ||
  tables.some((t) => !/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t))
)
  throw Error("Preservation inventory differs");
// The ongoing contact worker may append its approved TEST source pages.
const run = JSON.parse(readFileSync(".verification-results/commusoft-operator-2026-10-12.json"));
if (run.tables.length !== tables.length) throw Error("Preservation table set changed");
const snapshot = preservationQuery(run);
const catalog = `select md5(coalesce(string_agg(pg_get_functiondef(p.oid),'' order by p.oid),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in('f','p')`;
const prior = await q(catalog);
if (JSON.stringify(prior) !== JSON.stringify(old.prior))
  throw Error("TEST function catalog changed");
const before = await q(snapshot),
  source = readFileSync(rehearsal.sources[0].path, "utf8"),
  sha = hash(source),
  body = source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "");
const sql = `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin if (${catalog}) is distinct from '${prior[0].fingerprint}' or to_regprocedure('public.learn_operator_phone_playback_authorize(uuid,uuid,uuid,text,text,uuid)') is not null then raise exception 'TEST catalog changed';end if;end$$;
create temporary table information_preserved on commit drop as ${snapshot};
${body}
do $$begin if (select jsonb_agg(to_jsonb(x) order by name) from information_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Source data changed';end if;end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values('${sha}','learn_operator_phone_playback_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';select 'operator_phone_playback_installed' marker,'installed' fingerprint,(select jsonb_agg(md5(pg_get_functiondef(p.oid)) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('learn_operator_phone_playback_authorize','learn_operator_phone_recordings_read')) definitions;commit;`;
writeFileSync(
  stem + "-journal.json",
  JSON.stringify(
    {
      project: TEST_PROJECT,
      startedAt: new Date().toISOString(),
      sourceSha256: sha,
      before,
      prior,
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
let response = null;
try {
  response = await q(sql, false);
} catch (e) {
  writeFileSync(stem + "-error-private.txt", String(e.message), { mode: 0o600 });
}
const after = await q(snapshot),
  installed = await q(
    `select md5(pg_get_functiondef(p.oid)) fingerprint,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('learn_operator_phone_playback_authorize','learn_operator_phone_recordings_read') order by p.proname`,
  ),
  ledger = await q(
    "select source_sha256 from of_test_deploy.migrations where migration_name='learn_operator_phone_playback_v1'",
  );
const expected = response?.find((r) => r.marker === "operator_phone_playback_installed"),
  sort = (rs) => JSON.stringify(rs.sort((a, b) => a.name.localeCompare(b.name)));
const preserved = sort(before) === sort(after),
  ok =
    preserved &&
    installed.length === 2 &&
    expected?.fingerprint === "installed" &&
    installed.every((f) => f.authenticated && !f.anon && !f.service) &&
    JSON.stringify(installed.map((f) => f.fingerprint)) === JSON.stringify(expected?.definitions) &&
    ledger.length === 1 &&
    ledger[0].source_sha256 === sha;
const result = {
  state: ok ? "installed_verified" : "requires_inspection",
  project: TEST_PROJECT,
  observedAt: new Date().toISOString(),
  sourceSha256: sha,
  preservedDatasets: preserved ? 194 : null,
  installed,
  newAccounts: 0,
  newGrants: 0,
  providerCalls: 0,
  productionChanged: false,
};
writeFileSync(stem + "-result.json", JSON.stringify(result, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(result, null, 2));
if (!ok) process.exitCode = 1;
