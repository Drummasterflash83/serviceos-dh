/** One-shot TEST 078 rollback rehearsal. Never installs or activates Microsoft. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readMicrosoftCatalog, MICROSOFT_CATALOG, microsoftSnapshot } from "./learn-microsoft-catalog.mjs";

const prior = "eed0d2261da216333a705c4b00f54bd5";
const prefix = ".verification-results/microsoft-status-rehearsal-v2";
const migrations = ["20261101490000_learn_microsoft_operator_status.sql"];
const probes = ["hosted", "projection", "card", "discovery", "worker-hosted"];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const stable = (rows) => JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const absence = `select
 to_regprocedure('public.learn_operator_microsoft_status(uuid,uuid)') is null as function_absent,
 not exists(select 1 from tenants where id in('eb190660-aaaa-4000-8000-000000000001','ce790000-aaaa-4000-8000-000000000001')) as fixtures_absent,
 not exists(select 1 from auth.users where id='ce790000-aaaa-4000-8000-000000000010') as user_absent`;
function durableJournal(value, exclusive = false) {
  const fd=openSync(prefix+"-journal.json",exclusive?"wx":"w",0o600);
  try { writeSync(fd,JSON.stringify(value,null,2)+"\n");fsyncSync(fd); } finally {closeSync(fd);}
}
function validSnapshot(rows) {
  return rows.length===148 && new Set(rows.map(r=>r.name)).size===148 &&
    rows.every(r=>typeof r.name==="string" && Number.isInteger(r.count) && r.count>=0 && /^[a-f0-9]{32}$/.test(r.fingerprint));
}
try {
  if(process.argv.slice(2).join(" ")!=="--rehearse --existing-cli-login" || process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
    throw Error("Explicit fixed TEST rollback rehearsal required");
  const token=savedCliToken();
  const query=(sql)=>communicationQuery(token,sql);
  const catalog=await readMicrosoftCatalog(token);
  if(catalog.fingerprint!==prior) throw Error("Exact TEST 078 required");
  const absent=await query(absence);
  if(absent.length!==1 || !Object.values(absent[0]).every(v=>v===true)) throw Error("Microsoft absence guard failed");
  const snapshot=microsoftSnapshot(catalog.catalog.phone),before=await query(snapshot);
  if(!validSnapshot(before)) throw Error("Complete 148-dataset preservation baseline required");
  const files=migrations.map(file=>({file:"supabase/migrations/"+file,sql:readFileSync("supabase/migrations/"+file,"utf8")}));
  const generated=probes.map(name=>{
    const file=`scripts/verify/learn-microsoft-${name}-probe.mjs`;
    return {file,sourceSha256:hash(readFileSync(file)),sql:execFileSync(process.execPath,[file],{encoding:"utf8"})};
  });
  const statusProbe=readFileSync('scripts/verify/learn-microsoft-status.assert.sql','utf8');
  generated.push({file:'scripts/verify/learn-microsoft-status.assert.sql',sourceSha256:hash(statusProbe),sql:statusProbe});
  const body=files.map(f=>f.sql.replace(/^begin;\s*$/gm,"").replace(/^commit;\s*$/gm,"")).join("\n");
  const sql=`begin;set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if md5((${MICROSOFT_CATALOG})::text)<>'${prior}' then raise exception 'Exact TEST 078 required';end if;
 if not (select bool_and(v) from (${absence}) a cross join lateral jsonb_each_text(to_jsonb(a)) e(k,s) cross join lateral (select s::boolean v) b) then raise exception 'Microsoft absence guard failed';end if;
end$$;
${body}
${generated.map(p=>p.sql).join("\n")}
select 'microsoft_status_full_schema_rehearsal_passed' as marker;rollback;`;
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
    afterCatalog=await readMicrosoftCatalog(token);
    afterRows=await query(snapshot);
    afterAbsence=await query(absence);
  } catch(e) {
    writeFileSync(prefix+"-readback-error-private.txt",String(e?.message??"Unknown readback outcome"),{flag:"wx",mode:0o600});
  }
  const preservation=afterRows!==null && validSnapshot(afterRows) && stable(before)===stable(afterRows);
  const schemaRestored=afterCatalog?.fingerprint===prior;
  const objectsAbsent=afterAbsence?.length===1 && Object.values(afterAbsence[0]).every(v=>v===true);
  const marker=result?.some(r=>r.marker==="microsoft_status_full_schema_rehearsal_passed")===true;
  const ok=marker && preservation && schemaRestored && objectsAbsent;
  const report={projectRef:TEST_PROJECT,state:ok?"full_schema_rehearsed_and_rolled_back":schemaRestored&&objectsAbsent&&preservation?"rehearsal_unconfirmed_rollback_verified":"requires_inspection",
    observedAt:new Date().toISOString(),migrations:journal.migrations,probes:journal.probes,sqlSha256:journal.sqlSha256,
    assertionsConfirmed:marker,preservedDatasets:preservation?148:null,originalCatalogRestored:schemaRestored,fixturesAndNewStatusFunctionRemoved:objectsAbsent,
    retainedCredentials:0,retainedOperatorGrants:0,newSessions:0,newPlatformGrants:0,providerRequests:0,productionChanged:false,
    limitations:["Complete hosted TEST schema and actual SQL roles; one banned/passwordless synthetic actor and temporary view grant exist only inside the rolled-back transaction. No real session or browser acceptance.",
      "New status function and all fixtures roll back. Installed Microsoft schema and worker remain unchanged; mailbox coverage stays unverified."]};
  journal.state=report.state;journal.finishedAt=report.observedAt;durableJournal(journal);
  writeFileSync(prefix+"-readback-private.json",JSON.stringify({afterCatalog,afterRows,afterAbsence},null,2)+"\n",{flag:"wx",mode:0o600});
  writeFileSync(prefix+"-result.json",JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if(!ok) process.exitCode=1;
} catch(e) {
  console.error("Microsoft TEST rehearsal stopped; inspect private evidence. "+String(e?.message??"Unknown failure"));
  process.exitCode=1;
}
