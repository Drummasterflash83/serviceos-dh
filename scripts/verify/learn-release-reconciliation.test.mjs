import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {reconcileSchema,inspectPackagePins} from './learn-release-reconciliation.mjs';
const empty=()=>({tables:[],functions:[],views:[]});

test('partial TEST cannot prescribe removal of production objects or columns',()=>{
 const p=empty(),t=empty();
 p.tables=[{name:'emails',columns:[{name:'id',type:'uuid'},{name:'origin',type:'text'}],triggers:[{name:'legacy_writer',hash:'old'}]},
  {name:'other_service',columns:[]}];
 t.tables=[{name:'emails',columns:[{name:'id',type:'uuid'},{name:'journal_id',type:'uuid'}],triggers:[{name:'new_guard',hash:'new'}]}];
 const d=reconcileSchema(p,t).tables;
 assert.deepEqual(d.preserveProductionOnly,['other_service']);
 assert.deepEqual(d.changed[0].columns.preserveProductionOnly,['origin']);
 assert.deepEqual(d.changed[0].columns.additions,['journal_id']);
 assert.deepEqual(d.changed[0].triggers.preserveProductionOnly,['legacy_writer']);
 assert.deepEqual(d.changed[0].triggers.additions,['new_guard']);
});
test('changed types, authority and overloaded signatures stay explicit',()=>{
 const p=empty(),t=empty();
 p.tables=[{name:'jobs',columns:[{name:'id',type:'text'}],rls:true}];
 t.tables=[{name:'jobs',columns:[{name:'id',type:'uuid'}],rls:false}];
 p.functions=[{name:'read',arguments:'p_id uuid',hash:'a',anonExecute:false},{name:'read',arguments:'p_id text',hash:'b'}];
 t.functions=[{name:'read',arguments:'p_id uuid',hash:'a',anonExecute:true}];
 const d=reconcileSchema(p,t);
 assert.deepEqual(d.tables.changed[0].changedFacets,['columns','rls']);
 assert.deepEqual(d.tables.changed[0].columns.changed[0].changedFacets,['type']);
 assert.deepEqual(d.functions.preserveProductionOnly,['read(p_id text)']);
 assert.deepEqual(d.functions.changed[0].changedFacets,['anonExecute']);
});
test('duplicate or incomplete metadata cannot silently overwrite inventory',()=>{
 assert.throws(()=>reconcileSchema({...empty(),tables:[{name:'x'},{name:'x'}]},empty()),/duplicate/);
 assert.throws(()=>reconcileSchema({...empty(),functions:[{name:'x'}]},empty()),/signature/);
 assert.throws(()=>reconcileSchema({...empty(),tables:null},empty()),/Missing/);
});
test('package pins distinguish matching, altered and unmanifested SQL',()=>{
 const dir=mkdtempSync(join(tmpdir(),'learn-release-pins-'));
 try{
  for(const n of ['001','002','003'])writeFileSync(join(dir,n+'_test.sql'),'select 1;');
  writeFileSync(join(dir,'001_test.manifest.json'),JSON.stringify({sha256:createHash('sha256').update('select 1;').digest('hex')}));
  writeFileSync(join(dir,'002_test.manifest.json'),JSON.stringify({sha256:'altered'}));
  const rows=inspectPackagePins(dir);
  assert.deepEqual(rows.map(r=>r.manifestPin),['matched','mismatch','absent']);
  assert.ok(rows.every(r=>r.productionExecutionAllowed===false));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
