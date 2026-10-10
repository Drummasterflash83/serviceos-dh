/** Package only the reviewed contact functions; no data, grants to users or schedules. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  CONTACT_FUNCTIONS,
  CONTACT_CHANGED_FUNCTIONS,
  CONTACT_BASE_TABLES,
} from "./learn-commusoft-contacts-catalog.mjs";
import { installedVerificationRuntime } from "./learn-test-commusoft-verification-runtime.mjs";
const c = JSON.parse(
  readFileSync(process.argv[2] ?? ".verification-results/commusoft-contacts-catalog-before.json"),
);
if (
  !installedVerificationRuntime(c) ||
  CONTACT_FUNCTIONS.some((n) => c.contactFunctions.some((f) => f.name === n))
)
  throw Error("Verified prior TEST runtime required");
const path = "supabase/migrations/20261031190000_learn_business_input_contacts.sql",
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
const changes = CONTACT_CHANGED_FUNCTIONS.map((n) => {
  const matches = c.contactFunctions.filter((f) => f.name === n);
  if (matches.length !== 1) throw Error("Changed function is ambiguous");
  return matches[0];
});
const sql = `-- TEST contact projection. Existing canonical models and records are retained.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_temp;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>29 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_commusoft_connection_v1' and source_sha256='15c41fa4166c4584e768d922ed8d4a2e10a103fd2ecd003074e33cc75597437c' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 028 required';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${CONTACT_FUNCTIONS.map((n) => `'${n}'`).join(",")})) then raise exception 'Contact functions already exist';end if;
 ${changes.map((f) => `if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${createHash("md5").update(f.definition).digest("hex")}' then raise exception 'Prior ${f.name} differs';end if;`).join("\n ")}
end $$;
${source.slice(source.indexOf("\nbegin;\n") + 8, source.lastIndexOf("\ncommit;\n"))}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_contacts_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
`;
const prefix = "supabase/release/learn-test/029_commusoft_contacts";
writeFileSync(prefix + ".sql", sql);
writeFileSync(prefix + ".prerequisites.json", JSON.stringify(prior, null, 2) + "\n");
const manifest = {
  version: "learn-commusoft-contacts-package/1",
  sha256: hash(sql),
  sources: [{ path, sha256: hash(source) }],
  functions: CONTACT_FUNCTIONS,
  changedFunctions: CONTACT_CHANGED_FUNCTIONS,
  tables: [],
};
writeFileSync(prefix + ".manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    sourceSha256: hash(sql),
    functions: CONTACT_FUNCTIONS.length,
    changedFunctions: CONTACT_CHANGED_FUNCTIONS.length,
    newTables: 0,
  }),
);
