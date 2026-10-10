/** Exact endpoint-v3 metadata extends the pinned SQL/prior endpoint chain. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {digest} from './learn-test-foundation-release.mjs';
import {installedImportBatchesEndpoint} from './learn-test-import-batches-endpoint-catalog.mjs';
import {withPriorImportEndpoint} from './learn-test-import-pagination-deploy.mjs';
export function expectedImportPaginationEndpoint(){const raw=readFileSync(new URL('../../supabase/release/learn-test/import_endpoint_v3.expected.json',import.meta.url));if(createHash('sha256').update(raw).digest('hex')!=='a86a75b933179dac2d03f509c382130c0c8c9131179525dbcc427846dfde25c7')throw Error('Reviewed pagination endpoint metadata differs');return JSON.parse(raw);}
export function installedImportPaginationEndpoint(c){if(!Array.isArray(c?.base?.functions))return false;const actual=c.base.functions.filter(f=>f.slug==='learn-data-import');return actual.length===1&&digest(actual[0])===digest(expectedImportPaginationEndpoint().endpoint)&&installedImportBatchesEndpoint(withPriorImportEndpoint(c));}
