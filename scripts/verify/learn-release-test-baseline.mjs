/** Fresh metadata-only TEST comparison for the offline production release plan. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';

if(process.argv.slice(2).join(' ')!=='--read-only --existing-cli-login' || process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
  throw Error('Explicit named TEST metadata-only operation required');
const directory='.verification-results/test-release-baseline-v1';
mkdirSync(directory,{mode:0o700});
const token=savedCliToken();
const sql=readFileSync('scripts/verify/learn-release-schema-inventory.sql','utf8');
const rows=await communicationQuery(token,sql);
const inventory=rows?.length===1?rows[0].inventory:null;
if(!inventory||!['tables','functions','views'].every(k=>Array.isArray(inventory[k])))throw Error('Incomplete TEST inventory');
const ledger=await communicationQuery(token,'select migration_name,source_sha256,project_ref,applied_at from of_test_deploy.migrations order by applied_at,migration_name');
if(!ledger.length||ledger.some(r=>r.project_ref!==TEST_PROJECT))throw Error('Unexpected TEST ledger');
const write=(name,data)=>writeFileSync(directory+'/'+name,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
write('schema.json',inventory);write('migration-ledger.json',ledger);
const report={state:'test_release_metadata_recorded',projectRef:TEST_PROJECT,observedAt:new Date().toISOString(),
 objectCounts:Object.fromEntries(Object.entries(inventory).map(([k,v])=>[k,v.length])),migrationCount:ledger.length,
 inventorySqlSha256:createHash('sha256').update(sql).digest('hex'),sourceRowsRead:0,hostedWrites:0};
write('report.json',report);console.log(JSON.stringify(report));
