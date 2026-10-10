/** Recognize the exact governed-only endpoint without relaxing the earlier release chain. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from './learn-test-foundation-release.mjs';
import {installedImportAuthority} from './learn-test-import-authority-release.mjs';
import {withoutImportEndpoint} from './learn-test-import-deploy.mjs';

export function expectedImportEndpoint(){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/import_endpoint_v1.expected.json',import.meta.url));
 if(createHash('sha256').update(raw).digest('hex')!=='190a2efc6946295b96cf85fbbe8ebc9f7928507e15a4e5d487d0fa97fdc72e1c')throw Error('Reviewed import endpoint metadata differs');
 return JSON.parse(raw);
}
export function installedImportEndpoint(c){
 if(!Array.isArray(c?.base?.functions))return false;
 const actual=c.base.functions.filter(f=>f.slug==='learn-data-import');
 if(actual.length!==1||digest(actual[0])!==digest(expectedImportEndpoint().endpoint))return false;
 return installedImportAuthority(withoutImportEndpoint(c));
}
