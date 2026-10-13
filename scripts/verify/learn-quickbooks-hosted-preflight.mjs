/** Read-only metadata from the two explicitly named ServiceOS backends. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const targets={test:'saatxzwxvdvqevbnskxy',production:'tgbnakbxwcqjeimygroz'};
const label=process.argv[2],project=targets[label];
if(!project||process.argv.length!==3)throw Error('Specify test or production for the read-only catalog check');
const query=readFileSync(new URL('./learn-quickbooks-preflight.sql',import.meta.url),'utf8');
const token=savedCliToken();
try{
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('Metadata read returned HTTP '+r.status);
 const chunks=[];let bytes=0;
 for await(const c of r.body){bytes+=c.byteLength;if(bytes>1048576)throw Error('Metadata response exceeds bound');chunks.push(c);}
 const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 const data=rows?.length===1?Object.values(rows[0])[0]:null;
 if(!Array.isArray(data?.tables)||!Array.isArray(data?.functions)||!Array.isArray(data?.existingQuickBooksObjects))throw Error('Metadata incomplete');
 mkdirSync('.verification-results',{recursive:true,mode:0o700});
 const path=`.verification-results/quickbooks-${label}-preflight-${Date.now()}.json`;
 writeFileSync(path,JSON.stringify({project,...data},null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({project,label,checkedAt:data.checkedAt,path,querySha256:createHash('sha256').update(query).digest('hex'),tables:data.tables.length,functions:data.functions.length,missingFunctions:data.functions.filter(f=>!f.exists).map(f=>f.signature),existingQuickBooksObjects:data.existingQuickBooksObjects,changes:0,providerRequests:0}));
}catch(e){console.error(e instanceof Error&&/^Metadata /.test(e.message)?e.message:'QuickBooks metadata check unavailable; details withheld');process.exitCode=1;}
