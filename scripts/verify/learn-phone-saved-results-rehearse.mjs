/** Full hosted TEST schema probe. Candidate and banned, passwordless fixtures always roll back. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readPhonePlaybackCatalog,
  PHONE_PLAYBACK_PRESERVED,
} from "./learn-phone-playback-catalog.mjs";
if (process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT || process.argv[2] !== "--rehearse")
  throw Error("Explicit TEST rollback rehearsal required");
const dir = ".verification-results/phone-saved-results-rehearsal";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const token = savedCliToken(),
  query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
const source = readFileSync(
  "supabase/migrations/20261101240000_learn_phone_saved_results.sql",
  "utf8",
);
let probe = readFileSync("scripts/verify/learn-phone-saved-results.assert.sql", "utf8");
probe = probe.replace(
  "insert into tenants(id) values(pg_temp.saved_result_id(1)),(pg_temp.saved_result_id(2));",
  `insert into tenants(id,slug,display_name) values(pg_temp.saved_result_id(1),'saved-results-rollback-a','Synthetic rollback A'),(pg_temp.saved_result_id(2),'saved-results-rollback-b','Synthetic rollback B');
insert into auth.users(id,email,banned_until) values(pg_temp.saved_result_id(10),'saved-results-rollback-owner@example.invalid','infinity'),(pg_temp.saved_result_id(11),'saved-results-rollback-viewer@example.invalid','infinity');`,
);
const snapshot = [...PHONE_PLAYBACK_PRESERVED, "public.learn_phone_playback_audit"]
  .map(
    (t) =>
      `select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${t} s`,
  )
  .join(" union all ");
const before = await readPhonePlaybackCatalog(token);
if (before.fingerprint !== "a6f5cfa886fe094cc5318ecbb75b472c")
  throw Error("Expected installed TEST 057");
const preserved = await query(snapshot);
const report = {
  projectRef: TEST_PROJECT,
  state: "prepared",
  startedAt: new Date().toISOString(),
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  assertionSha256: createHash("sha256").update(probe).digest("hex"),
};
writeFileSync(dir + "/journal.json", JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
let result;
try {
  result = await query(
    `begin;set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
${source.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}
${probe}
select 'saved-results-rehearsed/1' as marker;rollback;`,
    false,
  );
} catch (e) {
  report.submission = "failed_or_unconfirmed";
  report.safeError = String(e.message);
}
const after = await readPhonePlaybackCatalog(token),
  afterData = await query(snapshot),
  absent = await query(
    "select to_regprocedure('public.learn_phone_saved_results_read(uuid,uuid,integer,text)') is null as absent",
  );
Object.assign(report, {
  schemaUnchanged: JSON.stringify(before) === JSON.stringify(after),
  retainedSourcesUnchanged: JSON.stringify(preserved) === JSON.stringify(afterData),
  candidateAbsent: absent[0]?.absent === true,
  preservedDataSets: preserved.length,
  newPersistentUsers: 0,
  newPersistentGrants: 0,
  providerRequests: 0,
  completedAt: new Date().toISOString(),
});
report.state =
  result?.some((r) => r.marker === "saved-results-rehearsed/1") &&
  report.schemaUnchanged &&
  report.retainedSourcesUnchanged &&
  report.candidateAbsent
    ? "rehearsed_rolled_back"
    : "requires_inspection";
writeFileSync(dir + "/result.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (report.state !== "rehearsed_rolled_back") process.exitCode = 1;
