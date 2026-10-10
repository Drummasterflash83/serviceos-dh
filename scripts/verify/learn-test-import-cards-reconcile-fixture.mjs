/** Bounded repair of one retained synthetic browser import; never a real company. */
import {readFileSync,writeFileSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {readImportBatchesCatalog} from './learn-import-batches-catalog.mjs';
import {installedImportBatchesEndpoint} from './learn-test-import-batches-endpoint-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
const [flag,path]=process.argv.slice(2),check=(v,s)=>{if(!v)throw Error(s);},q=s=>`'${String(s).replaceAll("'","''")}'`,uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
check(flag==='--repair'&&path?.startsWith('/private/tmp/serviceos-learn-ui-')&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST synthetic repair required');
const p=JSON.parse(readFileSync(path));check(p.version==='learn-test-ui-fixture/1'&&p.projectRef===TEST_PROJECT&&p.accessRevoked===true&&p.importBrowser&&uuid(p.tenant)&&uuid(p.runId),'Retired synthetic import manifest required');
const token=savedCliToken(),catalog=await readImportBatchesCatalog({allowProjectRef:TEST_PROJECT,token});check(installedImportBatchesEndpoint(catalog),'Exact TEST card release required');
const sql=(query,readOnly=true)=>communicationQuery(token,query,{readOnly});
const marked=await sql(`select id from tenants where id=${q(p.tenant)} and metadata->>'learn_ui_run'=${q(p.runId)} and metadata->>'synthetic'='true'`);check(marked.length===1,'Synthetic company marker differs');
const imports=await sql(`select id from data_imports where tenant_id=${q(p.tenant)} and status='completed'`);check(imports.length===1,'Exact retained completed browser import required');
const names=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions','sites','jobs','people','companies','contact_points','data_imports','import_entity_links','import_row_results','import_row_provenance','import_conflicts'];
const sources=()=>sql(names.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${n} s`).join(' union all '));
const cards=()=>sql('select id,tenant_id,md5(row_to_json(c)::text) as fingerprint from customer_cards c order by id');
const before={sources:await sources(),cards:await cards()};
const auditPath=`.verification-results/learn-import-card-repair-${p.runId}.json`;
writeFileSync(auditPath,JSON.stringify({projectRef:TEST_PROJECT,runId:p.runId,tenant:p.tenant,before},null,2)+'\n',{flag:'wx'});
let result=null,failure=null;
try{result=await sql(`begin;set local lock_timeout='3s';set local statement_timeout='30s';set local role service_role;select learn_import_customer_cards_reconcile(${q(p.tenant)},null,100) as result;commit;`,false);}catch{failure='Repair outcome requires inspection; do not repeat automatically';}
const after={sources:await sources(),cards:await cards()};
const preserved=JSON.stringify(before.sources)===JSON.stringify(after.sources)&&before.cards.every(c=>after.cards.some(a=>JSON.stringify(a)===JSON.stringify(c)));
const newCards=after.cards.filter(c=>!before.cards.some(b=>b.id===c.id));
check(newCards.every(c=>c.tenant_id===p.tenant),'Unexpected card appeared outside fixture');
const joined=await sql(`select count(*)::int as cards from customer_cards c join import_entity_links l on l.tenant_id=c.tenant_id and l.entity_kind='customer' and l.entity_table='people' and l.entity_id=c.person_id where c.tenant_id=${q(p.tenant)}`);
const passed=!failure&&preserved&&joined[0]?.cards===1&&newCards.length<=1;
const report={version:'learn-test-import-card-repair/1',projectRef:TEST_PROJECT,runId:p.runId,tenant:p.tenant,observedAt:new Date().toISOString(),state:passed?'passed':'requires_inspection',failure,result,preExistingRowsPreserved:preserved,createdCards:newCards.length,linkedCards:joined[0]?.cards,before,after};
writeFileSync(auditPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,before:undefined,after:undefined},null,2));if(!passed)process.exitCode=1;
