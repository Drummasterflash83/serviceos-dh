import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeDigest,proveUniformVersionIncrement} from './learn-quickbooks-runtime-inventory.mjs';
const before=[{slug:'alpha',version:4,status:'ACTIVE',verify_jwt:true,ezbr_sha256:'original-alpha'},{slug:'beta',version:6,status:'ACTIVE',verify_jwt:false,ezbr_sha256:'original-beta'}],digest=runtimeDigest(before);
const after=()=>before.map(x=>({...x,version:x.version+1}));
test('proves exactly one increment with ordering independent',()=>assert.equal(proveUniformVersionIncrement(after().reverse(),digest).verified,true));
for(const [field,value] of [['ezbr_sha256','replacement'],['verify_jwt',false],['status','REMOVED'],['slug','replacement'],['version',6]])test('rejects unrelated '+field+' change',()=>{const rows=after();rows[0][field]=value;assert.equal(proveUniformVersionIncrement(rows,digest).verified,false);});
test('rejects missing and added endpoints',()=>{assert.equal(proveUniformVersionIncrement(after().slice(1),digest).verified,false);assert.equal(proveUniformVersionIncrement([...after(),{...before[0],slug:'extra'}],digest).verified,false);});
test('rejects malformed and duplicate identities',()=>{assert.throws(()=>proveUniformVersionIncrement([{...before[0],version:1.5}],digest));assert.throws(()=>proveUniformVersionIncrement([after()[0],after()[0]],digest));});
