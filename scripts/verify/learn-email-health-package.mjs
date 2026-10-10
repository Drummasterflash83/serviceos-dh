/** Package the mailbox evidence reader and lookup index; no source writes or user grants. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EMAIL_HEALTH_TABLES } from "./learn-email-health-catalog.mjs";
import { installedCapture, CAPTURE_SHA } from "./learn-test-capture-health-release.mjs";
const FUNCTIONS = ["learn_operator_capture_health"];
const c = JSON.parse(
  readFileSync(process.argv[2] ?? ".verification-results/email-health-catalog-before.json"),
);
if (
  !installedCapture(c) ||
  c.tables
    .find((t) => t.name === "email_sync_runs")
    .indexes.some((i) => i.name === "learn_email_capture_run_lookup")
)
  throw Error("Verified prior TEST runtime required");
const path = "supabase/migrations/20261031220000_learn_email_capture_evidence.sql",
  source = readFileSync(path, "utf8");
if (source.split("\nbegin;\n").length !== 2 || source.split("\ncommit;\n").length !== 2)
  throw Error("Source framing changed");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const prior = {
  tables: c.tables.filter((t) => EMAIL_HEALTH_TABLES.includes(t.name)),
  functions: c.emailHealthFunctions,
  grants: c.emailHealthGrants,
};
if (prior.tables.length !== EMAIL_HEALTH_TABLES.length)
  throw Error("Capture prerequisites incomplete");
const sql = `-- TEST import capture health. Existing source pages and checkpoints are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_temp;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>32 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_capture_health_v1' and source_sha256='${CAPTURE_SHA}' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 031 required';end if;
 if to_regclass('public.learn_email_capture_run_lookup') is not null then raise exception 'Email run index already exists';end if;

end $$;
${source.slice(source.indexOf("\nbegin;\n") + 8, source.lastIndexOf("\ncommit;\n"))}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_email_capture_evidence_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
`;
const prefix = "supabase/release/learn-test/032_email_capture_evidence";
writeFileSync(prefix + ".sql", sql);
writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
const manifest = {
  version: "learn-email-health-package/1",
  sha256: hash(sql),
  sources: [{ path, sha256: hash(source) }],
  functions: [],
  changedFunctions: FUNCTIONS,
  tables: [],
  changedTables: ["email_sync_runs"],
};
writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    sourceSha256: hash(sql),
    functions: 0,
    changedFunctions: 1,
    newTables: 0,
  }),
);
