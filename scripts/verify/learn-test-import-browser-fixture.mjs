/** Retained TEST browser import evidence around the existing signed-in UI fixture. */
import {readFileSync,writeFileSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {readImportBatchesCatalog} from './learn-import-batches-catalog.mjs';
import {installedImportBatchesEndpoint} from './learn-test-import-batches-endpoint-catalog.mjs';
const [mode,path]=process.argv.slice(2),check=(v,s)=>{if(!v)throw Error(s);},q=s=>`'${String(s).replaceAll("'","''")}'`;
check(['prepare','inspect'].includes(mode)&&path?.startsWith('/private/tmp/serviceos-learn-ui-')&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST browser fixture command required');
const plan=JSON.parse(readFileSync(path,'utf8'));check(plan.version==='learn-test-ui-fixture/1'&&plan.projectRef===TEST_PROJECT&&/^[a-f0-9-]{36}$/.test(plan.tenant)&&/^[a-f0-9-]{36}$/.test(plan.runId),'UI fixture manifest differs');
const token=savedCliToken(),catalog=await readImportBatchesCatalog({allowProjectRef:TEST_PROJECT,token});check(installedImportBatchesEndpoint(catalog),'Exact TEST import endpoint and schema required');
async function sql(query){const r=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});check(r.ok,`Fixture read failed (${r.status})`);return r.json();}
const marked=await sql(`select id from tenants where id=${q(plan.tenant)} and metadata->>'learn_ui_run'=${q(plan.runId)} and metadata->>'synthetic'='true'`);check(marked.length===1,'Synthetic company marker differs');
const names=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions','sites','jobs','people','companies','contact_points','data_imports','import_entity_links','import_row_results','import_row_provenance','import_conflicts'];
check(names.every(n=>catalog.tables.some(t=>t.name===n)),'Source table missing from verified TEST catalog');
const sources=(await sql(names.map(n=>`select ${q(n)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${n} s where tenant_id<>${q(plan.tenant)}`).join(' union all '))).sort((a,b)=>a.name.localeCompare(b.name));
if(mode==='prepare'){
 check(!plan.importBrowser,'Import browser fixture already prepared');
 const csvPath=`/private/tmp/serviceos-learn-ui-${plan.runId}-customers.csv`;
 writeFileSync(csvPath,'source_system,external_id,record_kind,display_name,active\ncommusoft,BROWSER-C1,person,SYNTHETIC Browser Customer,true\n',{mode:0o600,flag:'wx'});
 plan.importBrowser={csvPath,sourceBefore:sources,preparedAt:new Date().toISOString()};writeFileSync(path,JSON.stringify(plan,null,2),{mode:0o600});
 console.log(JSON.stringify({state:'prepared',projectRef:TEST_PROJECT,runId:plan.runId,csvPath},null,2));
}else{
 check(Array.isArray(plan.importBrowser?.sourceBefore),'Source baseline missing');
 const preserved=JSON.stringify(plan.importBrowser.sourceBefore)===JSON.stringify(sources);
 const imports=await sql(`select id,status,row_count,created_records,updated_records,invalid_rows,conflict_records from data_imports where tenant_id=${q(plan.tenant)} order by created_at,id`);
 const counts=(await sql(`select (select count(*)::int from people where tenant_id=${q(plan.tenant)}) as people,(select count(*)::int from import_entity_links where tenant_id=${q(plan.tenant)}) as links,(select count(*)::int from import_row_results where tenant_id=${q(plan.tenant)}) as outcomes,(select count(*)::int from import_row_provenance where tenant_id=${q(plan.tenant)}) as provenance,(select count(*)::int from customer_cards where tenant_id=${q(plan.tenant)}) as customer_cards`))[0];
 const expected=imports.length===1&&imports[0].status==='completed'&&imports[0].row_count===1&&imports[0].created_records===1&&imports[0].invalid_rows===0&&counts.people===1&&counts.links===1&&counts.outcomes===1&&counts.provenance===1;
 console.log(JSON.stringify({version:'learn-import-browser-inspection/1',projectRef:TEST_PROJECT,runId:plan.runId,observedAt:new Date().toISOString(),state:preserved&&expected?'passed':'requires_inspection',preExistingSourcesPreserved:preserved,imports,counts,accessRevoked:plan.accessRevoked,limitations:['Database inspection supplements actual UI observations; it does not prove UI behavior by itself.','Synthetic single customer only; no original package or provider traffic.']},null,2));
 if(!preserved||!expected)process.exitCode=1;
}
