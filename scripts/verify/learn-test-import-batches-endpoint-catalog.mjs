/** Exact endpoint-v2 metadata extends the pinned SQL/prior endpoint chain. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {digest} from './learn-test-foundation-release.mjs';
import {installedImportBatches} from './learn-test-import-batches-release.mjs';
import {withPriorImportEndpoint} from './learn-test-import-batches-deploy.mjs';
export function expectedImportBatchesEndpoint(){const raw=readFileSync(new URL('../../supabase/release/learn-test/import_endpoint_v2.expected.json',import.meta.url));if(createHash('sha256').update(raw).digest('hex')!=='43dff9e3a4607866afde9e7bfe4156f23fa35993b073f04068bd58b2b316e4db')throw Error('Reviewed batch endpoint metadata differs');return JSON.parse(raw);}
export function installedImportBatchesEndpoint(c){if(!Array.isArray(c?.base?.functions))return false;const actual=c.base.functions.filter(f=>f.slug==='learn-data-import');return actual.length===1&&digest(actual[0])===digest(expectedImportBatchesEndpoint().endpoint)&&installedImportBatches(withPriorImportEndpoint(c));}
