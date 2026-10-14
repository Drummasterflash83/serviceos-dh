import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPackage,files,project} from './learn-quickbooks-production-package.mjs';
const root=new URL('../../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('supabase/release/quickbooks-production/001_quickbooks.manifest.json',root),'utf8'));
const sources=files.map(name=>readFileSync(new URL('supabase/migrations/'+name,root),'utf8'));
function catalog(){
 const tables=[];
 for(const c of manifest.columns){
  const [schema,name]=c.relation.split('.');
  let t=tables.find(t=>t.schema===schema&&t.name===name);
  if(!t){t={schema,name,columns:[]};tables.push(t);}
  t.columns.push({name:c.name,type:c.type});
 }
 return {project,checkedAt:new Date().toISOString(),functions:structuredClone(manifest.helpers),tables,existingQuickBooksObjects:[]};
}
test('requires exact production identity and fresh metadata before assembly',()=>{
 for(const mutation of [c=>c.project='saatxzwxvdvqevbnskxy',c=>c.checkedAt=new Date(Date.now()-3600001).toISOString(),c=>c.checkedAt='invalid',c=>c.checkedAt=new Date(Date.now()+120000).toISOString()]){
  const c=catalog();mutation(c);assert.throws(()=>buildPackage(c,sources));
 }
});
test('refuses incomplete authority, duplicate helpers and incompatible customer schema',()=>{
 for(const mutation of [c=>c.functions.pop(),c=>c.functions[0]=c.functions[1],c=>c.functions[0].exists=false,c=>delete c.functions[0].serviceExecute,c=>c.tables.find(t=>t.name==='customer_cards').columns[0].type='text',c=>c.existingQuickBooksObjects.push({name:'learn_quickbooks_apps'})]){
  const c=catalog();mutation(c);assert.throws(()=>buildPackage(c,sources));
 }
});
test('rejects transaction boundary changes rather than producing a partial migration',()=>{
 for(const changed of [sources[0].replace(/^begin;$/m,''),sources[0]+'\ncommit;\n',sources[0]+'\nselect 1;']){
  assert.throws(()=>buildPackage(catalog(),[changed,...sources.slice(1)]));
 }
});
test('guards function permissions/settings and includes all four migrations in one transaction',()=>{
 const {bundle,manifest:m}=buildPackage(catalog(),sources);
 assert.equal((bundle.match(/^begin;$/gm)||[]).length,1);
 assert.equal((bundle.match(/^commit;$/gm)||[]).length,1);
 assert.equal(m.sourceHashes.length,4);
 assert.match(bundle,/has_function_privilege\('authenticated',oid,'execute'\)/);
 assert.match(bundle,/to_jsonb\(proconfig\) is not distinct from/);
 assert.match(bundle,/p.proname like 'learn_quickbooks_%'/);
 assert.ok(bundle.indexOf('create table public.learn_quickbooks_apps')<bundle.indexOf('create table public.learn_quickbooks_customer_links'));
 assert.ok(bundle.indexOf('create table public.learn_quickbooks_customer_links')<bundle.indexOf('create table public.learn_quickbooks_disconnections'));
 assert.equal(m.status,'prepared_not_installed');
});
