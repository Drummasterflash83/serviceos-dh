/** Read-only worker and scheduler runtime metadata for the exact TEST/LIVE pair. */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
const project=mode==='--test-read-only'?TEST_PROJECT:
  mode==='--live-read-only'?'tgbnakbxwcqjeimygroz':null;
if(!project) throw Error('Exact TEST or LIVE read-only mode required');
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
  redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${savedCliToken()}`}});
if(!response.ok) throw Error(`Runtime inventory HTTP ${response.status}`);
const rows=(await response.json()).filter(r=>
  ['platform-worker','interactions-scheduled-sync'].includes(r.slug));
if(rows.length!==2||rows.some(r=>!Number.isInteger(r.version)||
  typeof r.ezbr_sha256!=='string')) throw Error('Runtime inventory shape changed');
console.log(JSON.stringify({project,rows:rows.map(r=>({slug:r.slug,
  version:r.version,wire:r.ezbr_sha256,verifyJwt:r.verify_jwt,status:r.status})),
  productionDataWrites:false}));
