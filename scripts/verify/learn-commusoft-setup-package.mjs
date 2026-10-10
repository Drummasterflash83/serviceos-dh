/** Build the additive TEST package from the reviewed, unreleased source migrations. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CONNECTION_TABLES, CONNECTION_FUNCTIONS } from "./learn-commusoft-setup-catalog.mjs";
const header =
  "-- Commusoft connection setup and verification, TEST only. No keys or work seeded.\nbegin;\nset local lock_timeout='3s';\nset local statement_timeout='30s';\nset local search_path=public,pg_temp;\nlock table of_test_deploy.migrations in share row exclusive mode;\ndo $$begin\n if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;\n if (select count(*) from of_test_deploy.migrations)<>28 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_operator_inputs_v1' and source_sha256='f8954339b1c5e9d86391160882f6d30081bcf53b1247e6e05d3a79866e3ed6d2' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact release 027 required';end if;\n if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('learn_commusoft_connection_requests','learn_commusoft_verification_requests','learn_commusoft_verification_permits','learn_commusoft_verification_results')) then raise exception 'Connection objects already exist; inspect contract';end if;\n if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('provider_secret_name','provider_secret_store','learn_commusoft_configure','learn_commusoft_verification_binding','learn_commusoft_verification_authority','learn_commusoft_verification_receipt','learn_commusoft_verify_request','learn_commusoft_verify_acquire','learn_commusoft_verify_authorized','learn_commusoft_verify_finish')) then raise exception 'Connection functions already exist; inspect contract';end if;\nend $$;\n";
const paths = [
  "supabase/migrations/20260810120000_provider_secret_broker.sql",
  "supabase/migrations/20261031170000_learn_commusoft_connection_setup.sql",
  "supabase/migrations/20261031180000_learn_commusoft_connection_verification.sql",
];
const sources = paths.map((p) => readFileSync(p, "utf8"));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const strip = (s) => {
  if (s.split("\nbegin;\n").length !== 2 || s.split("\ncommit;\n").length !== 2)
    throw Error("Source transaction framing differs");
  return s.slice(s.indexOf("\nbegin;\n") + 8, s.lastIndexOf("\ncommit;\n"));
};
const broker = sources[0]
  .slice(
    sources[0].indexOf("create or replace function public.provider_secret_name"),
    sources[0].indexOf("-- Resolve (decrypt)"),
  )
  .replaceAll("create or replace function", "create function");
const sql =
  header +
  broker +
  `
revoke all on function public.provider_secret_name(uuid,text,text),public.provider_secret_store(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.provider_secret_name(uuid,text,text),public.provider_secret_store(uuid,text,text,text) to service_role;
${strip(sources[1])}
${strip(sources[2])}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_commusoft_connection_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
commit;
`;
writeFileSync("supabase/release/learn-test/028_commusoft_connection.sql", sql);
writeFileSync(
  "supabase/release/learn-test/028_commusoft_connection.manifest.json",
  JSON.stringify(
    {
      version: "learn-commusoft-connection-package/1",
      sha256: hash(sql),
      sources: paths.map((path, i) => ({ path, sha256: hash(sources[i]) })),
      tables: CONNECTION_TABLES,
      functions: CONNECTION_FUNCTIONS,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    sourceSha256: hash(sql),
    tables: CONNECTION_TABLES.length,
    functions: CONNECTION_FUNCTIONS.length,
  }),
);
