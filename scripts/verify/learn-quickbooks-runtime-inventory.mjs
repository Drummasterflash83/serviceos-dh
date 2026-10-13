import {createHash} from 'node:crypto';
export function runtimeInventory(rows) {
  if(!Array.isArray(rows)||rows.some(x=>typeof x.slug!=='string'||!Number.isSafeInteger(x.version)||x.version<1||typeof x.status!=='string'||typeof x.verify_jwt!=='boolean'||typeof x.ezbr_sha256!=='string')||new Set(rows.map(x=>x.slug)).size!==rows.length)throw Error('Invalid runtime inventory');
  return rows.map(x=>({name:x.slug,version:x.version,status:x.status,verifyJwt:x.verify_jwt,hash:x.ezbr_sha256})).sort((a,b)=>a.name.localeCompare(b.name));
}
export const runtimeDigest = rows=>createHash('sha256').update(JSON.stringify(runtimeInventory(rows))).digest('hex');
/** Reconcile the observed one-version platform increment, without ignoring any
 * code, JWT, status, identity or inventory change. The original digest remains
 * authoritative. Call only as an explicit read-only investigation, not an
 * automatic deployment tolerance. */
export function proveUniformVersionIncrement(current, originalDigest) {
  if(!/^[a-f0-9]{64}$/.test(originalDigest)||!current.length)throw Error('Missing baseline');
  runtimeInventory(current);
  if(current.some(f=>f.version<2))return {verified:false,reason:'version_cannot_have_incremented'};
  const reconstructed=current.map(f=>({...f,version:f.version-1}));
  const reconstructedDigest=runtimeDigest(reconstructed);
  return {verified:reconstructedDigest===originalDigest,endpointCount:current.length,versionIncrement:1,reconstructedDigest,originalDigest};
}
