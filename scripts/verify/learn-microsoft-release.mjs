/** TEST 078. Install the exact rehearsed schema; roll back every synthetic fixture. */
import { readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken,TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readVoicemailInboxCatalog,VOICEMAIL_INBOX_CATALOG,voicemailInboxSnapshot } from "./learn-voicemail-inbox-catalog.mjs";
import { readMicrosoftCatalog,MICROSOFT_CATALOG,MICROSOFT_TABLES } from "./learn-microsoft-catalog.mjs";
const prior="6993886b70c352d13bae0800ffb39f08",packagePath="supabase/release/learn-test/078_microsoft_capture";
const sha=s=>createHash("sha256").update(s).digest("hex");
const stable=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const mode=process.argv[2];
if(!["--prepare","--rehearse","--apply"].includes(mode)||process.argv.slice(3).join(" ")!=="--existing-cli-login"||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
  throw Error("Explicit fixed TEST Microsoft release required");
const token=savedCliToken(),query=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly});
const before=await readVoicemailInboxCatalog(token),msBefore=await readMicrosoftCatalog(token);
if(before.fingerprint!==prior || msBefore.catalog.microsoft.tables?.length || msBefore.catalog.microsoft.functions?.length)
  throw Error("Exact TEST 077 without Microsoft objects required; inspect before retry");
const snapshot=voicemailInboxSnapshot(before.catalog.phone),preserved=await query(snapshot);
if(preserved.length!==140 || new Set(preserved.map(r=>r.name)).size!==140) throw Error("Complete preservation baseline required");
const rehearsal=JSON.parse(readFileSync("docs/operations/evidence/learn-microsoft-worker-hosted-2026-10-12.json"));
if(rehearsal.projectRef!==TEST_PROJECT || rehearsal.state!=="full_schema_rehearsed_and_rolled_back" || rehearsal.migrations.length!==9 || rehearsal.probes.length!==5)
  throw Error("Passing full-schema evidence required");
const migrations=rehearsal.migrations.map(f=>{
  const sql=readFileSync(f.file,"utf8");if(sha(sql)!==f.sha256)throw Error("Migration differs from rehearsal");return {...f,sql};
});
const probes=rehearsal.probes.map(f=>{
  if(sha(readFileSync(f.file))!==f.sourceSha256)throw Error("Probe source differs from rehearsal");
  // The readers stamp synthetic fetch time at generation. Pin only that field
  // so prepare/rehearse/apply use identical bytes; source event times stay intact.
  const sql=execFileSync(process.execPath,[f.file],{encoding:"utf8"})
    .replace(/"fetchedAt":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/g,'"fetchedAt":"2026-10-12T02:00:00.000Z"');
  return {...f,sql,sqlSha256:sha(sql)};
});
const sources=[...migrations.map(f=>({path:f.file,sha256:f.sha256})),...probes.map(f=>({path:f.file,sha256:f.sourceSha256,sqlSha256:f.sqlSha256}))];
const absent=`not exists(select 1 from tenants where id='eb190660-aaaa-4000-8000-000000000001')`;
if(!(await query(`select ${absent} as absent`))[0].absent)throw Error("Synthetic fixture already present");
const emptyChecks=MICROSOFT_TABLES.map(n=>`if exists(select 1 from public.${n}) then raise exception 'Microsoft fixture retained';end if;`).join("\n");
if(mode==="--prepare") {
  const body=migrations.map(f=>f.sql.replace(/^begin;\s*$/gm,"").replace(/^commit;\s*$/gm,"")).join("\n");
  const sql=`-- TEST 078 only: Microsoft storage, credentials and queue outcomes. No accounts, jobs or schedules activated.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from '${TEST_PROJECT}' or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or md5((${VOICEMAIL_INBOX_CATALOG})::text)<>'${prior}' or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_microsoft_%') or not (${absent}) then raise exception 'Exact TEST 077 required';end if;
end$$;
create temporary table microsoft_preserved on commit drop as ${snapshot};
${body}
savepoint microsoft_probe;
${probes.map(f=>f.sql).join("\n")}
rollback to savepoint microsoft_probe;
do $$begin
 ${emptyChecks}
 if not (${absent}) then raise exception 'Synthetic tenant retained';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from microsoft_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by name) from (${snapshot})x) then raise exception 'Microsoft release source preservation failed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_microsoft_capture_v1','${TEST_PROJECT}');
notify pgrst,'reload schema';
select 'microsoft-installed/1' as marker,md5((${MICROSOFT_CATALOG})::text) as fingerprint;
commit;
`;
  const manifest={projectRef:TEST_PROJECT,sha256:sha(sql),priorFingerprint:prior,priorMicrosoftFingerprint:msBefore.fingerprint,sources,preservedDatasets:140,emptyNewTables:8};
  writeFileSync(packagePath+".sql",sql,{flag:"wx"});
  writeFileSync(packagePath+".manifest.json",JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
  console.log(JSON.stringify({state:"prepared",...manifest},null,2));
} else {
  const sql=readFileSync(packagePath+".sql","utf8"),manifest=JSON.parse(readFileSync(packagePath+".manifest.json"));
  if(manifest.projectRef!==TEST_PROJECT || manifest.sha256!==sha(sql)||manifest.priorFingerprint!==prior||manifest.priorMicrosoftFingerprint!==msBefore.fingerprint||JSON.stringify(manifest.sources)!==JSON.stringify(sources))throw Error("Pinned Microsoft package differs");
  const verified=mode==="--apply"?JSON.parse(readFileSync(".verification-results/microsoft-release-rehearse-result.json")):null;
  if(verified && (verified.state!=="rehearsed_rolled_back"||verified.packageSha256!==manifest.sha256||Date.now()-Date.parse(verified.observedAt)>3600000||!verified.expected?.fingerprint))throw Error("Fresh exact package rehearsal required");
  const stem=".verification-results/microsoft-release-"+mode.slice(2);
  const journal={mode,projectRef:TEST_PROJECT,startedAt:new Date().toISOString(),state:"submitted",packageSha256:manifest.sha256,beforeFingerprint:msBefore.fingerprint,preserved};
  const saveJournal=exclusive=>{const fd=openSync(stem+"-journal.json",exclusive?"wx":"w",0o600);try{writeSync(fd,JSON.stringify(journal,null,2)+"\n");fsyncSync(fd);}finally{closeSync(fd);}};
  saveJournal(true);
  let response=null;
  try {
    response=await query(`set serviceos.release_target='${TEST_PROJECT}';set serviceos.release_source_sha256='${manifest.sha256}';\n`+(mode==="--rehearse"?sql.replace(/\ncommit;\n$/,"\nrollback;\n"):sql),false);
  }catch(e){writeFileSync(stem+"-error-private.txt",String(e.message),{flag:"wx",mode:0o600});}
  // No retry of the mutation. Inspect durable state even if its acknowledgement was lost.
  const after=await readMicrosoftCatalog(token),afterRows=await query(snapshot);
  const ledger=await query("select source_sha256 from of_test_deploy.migrations where migration_name='learn_microsoft_capture_v1'");
  const fixtureAbsent=(await query(`select ${absent} as absent`))[0].absent;
  const expected=mode==="--rehearse"?response?.find(r=>r.marker==="microsoft-installed/1"):verified.expected;
  const rowsPreserved=stable(preserved)===stable(afterRows);
  const empties=after.catalog.microsoft.tables?.length===8?await query(MICROSOFT_TABLES.map(n=>`select '${n}' as name,count(*)::int as count from public.${n}`).join(" union all ")):[];
  const ok=rowsPreserved&&fixtureAbsent&&/^[a-f0-9]{32}$/.test(expected?.fingerprint??"")&&
    (mode==="--rehearse"?after.fingerprint===msBefore.fingerprint&&ledger.length===0:
      after.fingerprint===expected.fingerprint&&ledger.length===1&&ledger[0].source_sha256===manifest.sha256&&empties.length===8&&empties.every(r=>r.count===0));
  const report={state:ok?(mode==="--rehearse"?"rehearsed_rolled_back":"installed_microsoft_schema_verified"):"requires_inspection",observedAt:new Date().toISOString(),projectRef:TEST_PROJECT,
    packageSha256:manifest.sha256,expected:expected??null,afterFingerprint:after.fingerprint,preservedDatasets:rowsPreserved?140:null,fixtureAbsent,emptyNewTables:empties.length===8?empties.every(r=>r.count===0):null,
    usersRetained:0,credentialsRetained:0,grantsRetained:0,providerRequests:0,productionChanged:false,
    limitations:["Microsoft schema only; no deployed worker, real mailbox, consent, active connector or signed-in acceptance."]};
  journal.state=report.state;journal.finishedAt=report.observedAt;saveJournal(false);
  writeFileSync(stem+"-readback-private.json",JSON.stringify({after,afterRows,ledger,empties},null,2)+"\n",{flag:"wx",mode:0o600});
  writeFileSync(stem+"-result.json",JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log(JSON.stringify(report,null,2));if(!ok)process.exitCode=1;
}
