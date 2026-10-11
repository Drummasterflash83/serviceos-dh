/** Full installed TEST schema only; candidate, synthetic identities and audit roll back. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhoneOperatorCatalog,
  phoneOperatorSourceQuery,
} from "./learn-phone-operator-catalog.mjs";
if (
  process.argv.slice(2).join(" ") !== "--rehearse" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST rollback rehearsal required");
const dir = ".verification-results/phone-playback-rehearsal";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const token = savedCliToken();
const query = (sql, readOnly = true) =>
  communicationQuery(token, sql, {
    readOnly,
    fetcher: async (...args) => {
      const response = await fetch(...args);
      if (!response.ok)
        writeFileSync(dir + "/private-error.txt", (await response.clone().text()).slice(0, 65536), {
          mode: 0o600,
        });
      return response;
    },
  });
const source = readFileSync("supabase/migrations/20261101230000_learn_phone_playback.sql", "utf8");
const report = {
  projectRef: TEST_PROJECT,
  state: "prepared",
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  observedAt: new Date().toISOString(),
};
try {
  const before = await readPhoneOperatorCatalog(token);
  if (before.fingerprint !== "49ce8178c104da0915f78467004b84c0")
    throw Error("Expected installed operator release 056");
  const snapshot =
    phoneOperatorSourceQuery(before.catalog.phone) +
    " union all select 'public.learn_phone_operator_reconciliations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_operator_reconciliations s";
  const preserved = await query(snapshot);
  let probe = readFileSync("scripts/verify/learn-phone-playback.assert.sql", "utf8");
  probe = probe.replace(
    "insert into tenants(id,name) values('fae019ce-aaaa-4000-8000-000000000001','Playback fixture A'),('fae019ce-aaaa-4000-8000-000000000002','Playback fixture B');",
    `insert into tenants(id,slug,display_name) values('fae019ce-aaaa-4000-8000-000000000001','playback-rollback-a','Playback fixture A'),('fae019ce-aaaa-4000-8000-000000000002','playback-rollback-b','Playback fixture B');
 insert into auth.users(id,email,banned_until) values('fae019ce-aaaa-4000-8000-000000000010','playback-rollback-owner@example.invalid','infinity'),('fae019ce-aaaa-4000-8000-000000000011','playback-rollback-viewer@example.invalid','infinity');`,
  );
  probe = probe.replace(
    "'fae019ce-aaaa-4000-8000-000000000001','viewer');",
    "'fae019ce-aaaa-4000-8000-000000000001','viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;",
  );
  probe = probe.replace(/^select 'PASS:[^\n]*';$/m, "");
  writeFileSync(dir + "/journal.json", JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  let result;
  try {
    result = await query(
      `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
 ${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}
 ${probe}
 select 'phone-playback-rehearsed/1' as marker;
 rollback;`,
      false,
    );
  } catch {
    report.submission = "failed_or_unconfirmed";
  }
  const after = await readPhoneOperatorCatalog(token),
    afterData = await query(snapshot);
  const absent = await query(
    "select to_regclass('public.learn_phone_playback_audit') is null as absent",
  );
  report.schemaUnchanged = JSON.stringify(before) === JSON.stringify(after);
  report.retainedSourcesUnchanged = JSON.stringify(preserved) === JSON.stringify(afterData);
  report.candidateAbsent = absent[0]?.absent === true;
  report.preservedDataSets = preserved.length;
  report.state =
    result?.some((r) => r.marker === "phone-playback-rehearsed/1") &&
    report.schemaUnchanged &&
    report.retainedSourcesUnchanged &&
    report.candidateAbsent
      ? "rehearsed_rolled_back"
      : "requires_inspection";
} catch {
  report.state = "requires_inspection";
}
report.completedAt = new Date().toISOString();
writeFileSync(dir + "/result.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (report.state !== "rehearsed_rolled_back") process.exitCode = 1;
