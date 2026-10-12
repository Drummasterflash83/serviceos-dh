/** Prepare exact function-only production package. No hosted operations. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = p => readFileSync(p, "utf8"), sha = x => createHash("sha256").update(x).digest("hex");
const quote = x => "'" + x.replaceAll("'", "''") + "'";
const root = "supabase/release/learn-production/";
const prior = JSON.parse(read(root + "016_roster_support.manifest.json"));
const catalog = JSON.parse(read(".verification-results/production-roster-rehearsal-v2/schema.json"));
const rehearsal = JSON.parse(read(".verification-results/production-roster-rehearsal-v2/report.json"));
if (rehearsal.state !== "production_roster_support_rehearsed_offline" || !rehearsal.containerRemoved ||
    rehearsal.packages.length !== 16 || rehearsal.packages.at(-1) !== prior.sha256 ||
    sha(read(root + "016_roster_support.sql")) !== prior.sha256 ||
    JSON.stringify(rehearsal.archive) !== JSON.stringify(prior.baselineArchive)) throw Error("Reviewed prior archive rehearsal required");
const changedFunctions = ["learn_operator_input_request", "learn_commusoft_acquire_page",
  "learn_commusoft_commit_page", "learn_commusoft_finish_job", "learn_operator_inputs"].sort();
const functions = catalog.functions.filter(f => changedFunctions.includes(f.name));
const newFunctions = ["learn_commusoft_update_window"];
if (functions.length !== 5 || catalog.functions.some(f => newFunctions.includes(f.name))) throw Error("Function baseline differs");
const path = "supabase/migrations/20261101540000_learn_commusoft_update_windows.sql";
const migration = read(path), sources = [{ path, sha256: sha(migration) }];
if ((migration.match(/^begin;$/gm) ?? []).length !== 1 || (migration.match(/^commit;$/gm) ?? []).length !== 1)
  throw Error("Single migration transaction required");
const body = migration.replace(/^begin;\n/m, "").replace(/^commit;\n/m, "");
const inventory = read("scripts/verify/learn-release-schema-inventory.sql").trim().replace(/;$/, "");
const sql = `-- DRAFT: fixed Commusoft update windows; no activation or data modification.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production update-window target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_roster_support_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then
  raise exception 'Pinned production update-window prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_update_windows_v1')
 or to_regprocedure('public.learn_commusoft_update_window(jsonb)') is not null then
  raise exception 'Production update-window candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${changedFunctions.map(quote).join(",")}]);
 if observed is distinct from ${quote(JSON.stringify(functions))}::jsonb then
  raise exception 'Production update-window function baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_commusoft_update_windows_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem = root + "017_commusoft_update_windows";
writeFileSync(stem + ".sql", sql);
writeFileSync(stem + ".manifest.json", JSON.stringify({ version: "learn-production-commusoft-update-windows/1",
  status: "draft_requires_rehearsal_and_production_approval", projectRef: "tgbnakbxwcqjeimygroz",
  sha256: sha(sql), priorSha256: prior.sha256, baselineArchive: prior.baselineArchive, sources,
  newFunctions, changedFunctions, newTables: [], changedViews: [], newSequences: [], extendedTables: {},
  limitations: ["Fixed windows require operator approval; no recurring refresh schedule or watermark is created.",
    "Matching worker and frontend, real-provider date-filter acceptance and canonical update reconciliation remain required.",
    "No source history, customer records, credentials, permissions or capture activation changes."] }, null, 2) + "\n");
console.log(JSON.stringify({ sha256: sha(sql), changedFunctions: functions.length, newFunctions: 1 }));
