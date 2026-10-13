/** Offline pin check only. Does not connect to production or print SQL/data. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='supabase/release/learn-production-patches/slack-customer-context-v1/';
const manifest=JSON.parse(readFileSync(root+'manifest.json'));
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(manifest.version!=='learn-slack-customer-context-release/1'||manifest.project!=='tgbnakbxwcqjeimygroz')throw Error('Reviewed patch identity differs');
if(sha(manifest.source.path)!==manifest.source.sha256)throw Error('Migration source changed');
for(const[name,hash]of Object.entries(manifest.files))if(!['apply.sql','rollback.sql','original-reader.sql'].includes(name)||sha(root+name)!==hash)throw Error('Reviewed patch file changed');
console.log(JSON.stringify({state:'offline_pins_verified',project:manifest.project,files:Object.keys(manifest.files),productionWrites:0}));
