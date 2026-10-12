/** One-shot TEST 077 rollback rehearsal. Never installs or activates Microsoft. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readVoicemailInboxCatalog, VOICEMAIL_INBOX_CATALOG, voicemailInboxSnapshot } from "./learn-voicemail-inbox-catalog.mjs";

const prior = "6993886b70c352d13bae0800ffb39f08";
const prefix = ".verification-results/microsoft-worker-full-schema-rehearsal-v1";
const migrations = [
  "20261101180000_learn_microsoft_source_journal.sql",
  "20261101181000_learn_microsoft_job_receipts.sql",
  "20261101182000_learn_microsoft_queue_completion.sql",
  "20261101192000_learn_microsoft_folder_dispatch.sql",
  "20261101260000_learn_microsoft_incremental_queue.sql",
  "20261101280000_learn_microsoft_message_projection.sql",
  "20261101350000_learn_microsoft_recurring_discovery.sql",
  "20261101470000_learn_microsoft_credentials.sql",
  "20261101480000_learn_microsoft_worker_failures.sql",
];
const probes = ["hosted", "projection", "card", "discovery", "worker-hosted"];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const absence = `select
 to_regclass('public.platform_events') is not null as event_bus_present,
 not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_microsoft_%') as tables_absent,
 not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_microsoft_%') as functions_absent,
 not exists(select 1 from tenants where id='eb190660-aaaa-4000-8000-000000000001') as fixture_absent`;
function durableJournal(value, exclusive = false) {
  const fd=openSync(prefix+"-journal.json",exclusive?"wx":"w",0o600);
  try { writeSync(fd,JSON.stringify(value,null,2)+"\n");fsyncSync(fd); } finally {closeSync(fd);}
}
function validSnapshot(rows) {
  return rows.length===140 && new Set(rows.map(r=>r.name)).size===140 &&
    rows.every(r=>typeof r.name==="string" && Number.isInteger(r.count) && r.count>=0 && /^[a-f0-9]{32}$/.test(r.fingerprint));
}
try {
  if(process.argv.slice(2).join(" ")!=="--rehearse --existing-cli-login" || process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
    throw Error("Explicit fixed TEST rollback rehearsal required");
  const token=savedCliToken();
  const query=(sql)=>communicationQuery(token,sql);
  const catalog=await readVoicemailInboxCatalog(token);
  if(catalog.fingerprint!==prior) throw Error("Exact TEST 077 required");
  const absent=await query(absence);
  if(absent.length!==1 || !Object.values(absent[0]).every(v=>v===true)) throw Error("Microsoft absence guard failed");
  const snapshot=voicemailInboxSnapshot(catalog.catalog.phone),before=await query(snapshot);
  if(!validSnapshot(before)) throw Error("Complete 140-dataset preservation baseline required");
  const files=migrations.map(file=>({file:"supabase/migrations/"+file,sql:readFileSync("supabase/migrations/"+file,"utf8")}));
  const generated=probes.map(name=>{
    const file=`scripts/verify/learn-microsoft-${name}-probe.mjs`;
    return {file,sourceSha256:hash(readFileSync(file)),sql:execFileSync(process.execPath,[file],{encoding:"utf8"})};
  });
  const body=files.map(f=>f.sql.replace(/^begin;\s*$/gm,"").replace(/^commit;\s*$/gm,"")).join("\n");
  const sql=`begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if md5((${VOICEMAIL_INBOX_CATALOG})::text)<>'${prior}' then raise exception 'Exact TEST 077 required';end if;
 if not (select bool_and(v) from (${absence}) a cross join lateral jsonb_each_text(to_jsonb(a)) e(k,s) cross join lateral (select s::boolean v) b) then raise exception 'Microsoft absence guard failed';end if;
end$$;
${body}
${generated.map(p=>p.sql).join("\n")}
select 'microsoft_worker_full_schema_rehearsal_passed' as marker;rollback;`;
  const journal={projectRef:TEST_PROJECT,startedAt:new Date().toISOString(),state:"prepared",beforeFingerprint:prior,before,
    migrations:files.map(f=>({file:f.file,sha256:hash(f.sql)})),
    probes:generated.map(p=>({file:p.file,sourceSha256:p.sourceSha256,sqlSha256:hash(p.sql)})),sqlSha256:hash(sql)};
  durableJournal(journal,true);
  journal.state="submitted";durableJournal(journal);
  let result=null;
  try {
    result=await communicationQuery(token,sql,{readOnly:false,fetcher:async(url,options)=>{
      const response=await fetch(url,options);
      if(!response.ok) writeFileSync(prefix+"-sql-error-private.txt",(await response.clone().text()).slice(0,16000),{flag:"wx",mode:0o600});
      return response;
    }});
  } catch(e) {
    writeFileSync(prefix+"-request-error-private.txt",String(e?.message??"Unknown request outcome"),{flag:"wx",mode:0o600});
  }
  // Always inspect the state after the single submission, including errors or lost acknowledgements.
  let afterCatalog=null,afterRows=null,afterAbsence=null;
  try {
    afterCatalog=await readVoicemailInboxCatalog(token);
    afterRows=await query(snapshot);
    afterAbsence=await query(absence);
  } catch(e) {
    writeFileSync(prefix+"-readback-error-private.txt",String(e?.message??"Unknown readback outcome"),{flag:"wx",mode:0o600});
  }
  const preservation=afterRows!==null && validSnapshot(afterRows) && stable(before)===stable(afterRows);
  const schemaRestored=afterCatalog?.fingerprint===prior;
  const objectsAbsent=afterAbsence?.length===1 && Object.values(afterAbsence[0]).every(v=>v===true);
  const marker=result?.some(r=>r.marker==="microsoft_worker_full_schema_rehearsal_passed")===true;
  const ok=marker && preservation && schemaRestored && objectsAbsent;
  const report={projectRef:TEST_PROJECT,state:ok?"full_schema_rehearsed_and_rolled_back":schemaRestored&&objectsAbsent&&preservation?"rehearsal_unconfirmed_rollback_verified":"requires_inspection",
    observedAt:new Date().toISOString(),migrations:journal.migrations,probes:journal.probes,sqlSha256:journal.sqlSha256,
    assertionsConfirmed:marker,preservedDatasets:preservation?140:null,originalCatalogRestored:schemaRestored,fixturesAndMicrosoftObjectsRemoved:objectsAbsent,
    retainedCredentials:0,newSessions:0,newPlatformGrants:0,providerRequests:0,productionChanged:false,
    limitations:["Synthetic source pages and credentials, SQL roles, complete hosted TEST schema. No Microsoft network, deployed worker or signed-in browser acceptance.",
      "Microsoft schema, tokens and fixtures roll back. Existing TEST worker remains unchanged. Mailbox coverage remains unverified."]};
  journal.state=report.state;journal.finishedAt=report.observedAt;durableJournal(journal);
  writeFileSync(prefix+"-readback-private.json",JSON.stringify({afterCatalog,afterRows,afterAbsence},null,2)+"\n",{flag:"wx",mode:0o600});
  writeFileSync(prefix+"-result.json",JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if(!ok) process.exitCode=1;
} catch(e) {
  console.error("Microsoft TEST rehearsal stopped; inspect private evidence. "+String(e?.message??"Unknown failure"));
  process.exitCode=1;
}
