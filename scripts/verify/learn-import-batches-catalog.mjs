import {readImportCardsCatalog} from './learn-import-cards-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const IMPORT_BATCH_FUNCTIONS=['learn_import_apply_batch','learn_import_batch_authority','learn_import_match_batch'];
export const IMPORT_BATCH_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,`p.proname in (${IMPORT_BATCH_FUNCTIONS.map(n=>`'${n}'`).join(',')})`).replace(' as functions',' as import_batch_functions');
export async function readImportBatchesCatalog(args){const c=await readImportCardsCatalog(args),r=await communicationQuery(args.token,IMPORT_BATCH_FUNCTION_QUERY,args);if(r?.length!==1||!Array.isArray(r[0]?.import_batch_functions))throw Error('Import batch metadata incomplete');return {...c,importBatchFunctions:r[0].import_batch_functions};}
