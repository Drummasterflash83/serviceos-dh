/** Package only the reviewed continuation function; no data, grants to users or schedules. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CONTACT_BASE_TABLES } from "./learn-commusoft-contacts-catalog.mjs";
import { installedContacts, CONTACT_SHA } from "./learn-test-commusoft-contacts-release.mjs";
const FUNCTIONS = ["learn_operator_resume_commusoft"];
const c = JSON.parse(
  readFileSync(process.argv[2] ?? ".verification-results/commusoft-resume-catalog-before.json"),
);
if (!installedContacts(c) || FUNCTIONS.some((n) => c.contactFunctions.some((f) => f.name === n)))
  throw Error("Verified prior TEST runtime required");
const path = "supabase/migrations/20261031200000_learn_commusoft_resume.sql",
  source = readFileSync(path, "utf8");
if (source.split("\nbegin;\n").length !== 2 || source.split("\ncommit;\n").length !== 2)
  throw Error("Source framing changed");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const prior = {
  tables: c.tables.filter((t) => CONTACT_BASE_TABLES.includes(t.name)),
  functions: c.contactFunctions,
  grants: c.contactGrants,
};
if (prior.tables.length !== CONTACT_BASE_TABLES.length)
  throw Error("Contact prerequisites incomplete");
const sql = `-- TEST import continuation. Existing source pages and checkpoints are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_temp;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>30 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_commusoft_contacts_v1' and source_sha256='${CONTACT_SHA}' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 029 required';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${FUNCTIONS.map((n) => `'${n}'`).join(",")})) then raise exception 'Continuation function already exists';end if;

end $$;
${source.slice(source.indexOf("\nbegin;\n") + 8, source.lastIndexOf("\ncommit;\n"))}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_resume_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
`;
const prefix = "supabase/release/learn-test/030_commusoft_resume";
writeFileSync(prefix + ".sql", sql);
writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
const manifest = {
  version: "learn-commusoft-resume-package/1",
  sha256: hash(sql),
  sources: [{ path, sha256: hash(source) }],
  functions: FUNCTIONS,
  changedFunctions: [],
  tables: [],
};
writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    sourceSha256: hash(sql),
    functions: FUNCTIONS.length,
    changedFunctions: 0,
    newTables: 0,
  }),
);
