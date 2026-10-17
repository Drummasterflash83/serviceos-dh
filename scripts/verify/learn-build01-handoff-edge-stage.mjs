/** Download the currently installed operator route and compare its source closure. */
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { edgeRuntimeBundle } from './learn-email-runtime-edge-bundle.mjs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
if(!['--stage-test','--stage-live'].includes(mode))throw Error('Exact stage mode required');
const test=mode.endsWith('test'),project=test?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const endpoint='openfolk-control-plane';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const token=savedCliToken();
const inventory=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
 headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!inventory.ok)throw Error('Edge inventory unavailable');
const before=(await inventory.json()).find(v=>v.slug===endpoint);
if(!before||before.status!=='ACTIVE'||before.verify_jwt!==false||!Number.isSafeInteger(before.version))
 throw Error('Installed operator route changed');
const stage=mkdtempSync(join(tmpdir(),`learn-handoff-${test?'test':'live'}-`));
const downloaded=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',stage],{
 env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:60000,maxBuffer:2097152});
if(downloaded.status!==0)throw Error('Current operator route source download failed');
const root=join(stage,'supabase/functions');
function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path];});}
const paths=walk(root).map(path=>relative(root,path).replaceAll('\\','/')).sort();
const local=edgeRuntimeBundle([{name:endpoint,verifyJwt:false}]);
const expected=new Map(local.files.map(f=>[f.path,f.source]));
const changes=paths.filter(path=>expected.has(path)&&readFileSync(join(root,path),'utf8')!==expected.get(path));
const extra=paths.filter(path=>!expected.has(path)),missing=[...expected.keys()].filter(path=>!paths.includes(path));
const digest=createHash('sha256').update(JSON.stringify(paths.map(path=>({path,source:readFileSync(join(root,path),'utf8')})))).digest('hex');
const result={project,endpoint,version:before.version,stage,files:paths.length,sourceSha256:digest,
 localSourceSha256:local.sha256,changedPaths:changes,extraPaths:extra,missingPaths:missing};
writeFileSync(join(stage,'handoff-stage.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result));
