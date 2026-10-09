/** Actual application, fixed TEST backend, loopback only. No simulated API client. */
import {spawn} from 'node:child_process';
import {readPacingCatalog} from './learn-slack-pacing-catalog.mjs';
import {installedPacing} from './learn-test-pacing-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
if(process.argv.slice(2).join(' ')!=='--serve --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST local UI and saved login required');
const token=savedCliToken(),catalog=await readPacingCatalog({allowProjectRef:TEST_PROJECT,token});
if(!installedPacing(catalog))throw Error('Verified TEST pacing schema required');
const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Existing TEST public key unavailable');
const rows=(await response.json()).filter(r=>r.name==='anon'&&typeof r.api_key==='string');
if(rows.length!==1)throw Error('Unique TEST public key required');
const claims=JSON.parse(Buffer.from(rows[0].api_key.split('.')[1],'base64url').toString());
if(claims.ref!==TEST_PROJECT||claims.role!=='anon')throw Error('Public key target differs');
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','dev','--host','127.0.0.1','--port','47872','--strictPort'],{cwd:new URL('../../',import.meta.url),env:{...process.env,VITE_SUPABASE_URL:`https://${TEST_PROJECT}.supabase.co`,VITE_SUPABASE_ANON_KEY:rows[0].api_key,VITE_ENABLE_SIGNUP:'false'},stdio:'inherit'});
console.log('Actual LEARN app: http://127.0.0.1:47872/client?section=learn; fixed TEST backend; no provider sync requested.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
