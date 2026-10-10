/** Recognize the exact four phone additions without relaxing release-014 checks. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installedRecovery} from './learn-test-recovery-release.mjs';
import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';
import {digest} from './learn-test-foundation-release.mjs';

export function expectedPhoneEndpoints(){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/phone_endpoints_v1.expected.json',import.meta.url));
 if(createHash('sha256').update(raw).digest('hex')!=='e6281e4e6229f9a46bd8d5f0eade8d8a83f9b0aac0dc6a4e39c745b095feccbd')throw Error('Reviewed phone deployment metadata differs');
 return JSON.parse(raw);
}
export function installedPhone(c){
 const expected=expectedPhoneEndpoints().endpoints,names=expected.map(f=>f.slug);
 if(!Array.isArray(c?.base?.functions))return false;
 const actual=c.base.functions.filter(f=>names.includes(f.slug)).sort((a,b)=>a.slug.localeCompare(b.slug));
 if(digest(actual)!==digest(expected))return false;
 const prior=structuredClone(c);
 prior.base.functions=prior.base.functions.filter(f=>!names.includes(f.slug));
 prior.readinessCatalogSha256=catalogFingerprint(prior.base);
 return installedRecovery(prior);
}
