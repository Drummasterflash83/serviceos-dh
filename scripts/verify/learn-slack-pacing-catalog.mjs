/** The three changed functions are already included in the thread catalog. */
import {readOperatorCatalog} from './learn-slack-operator-catalog.mjs';
import {THREADS_FUNCTIONS,THREADS_FUNCTION_QUERY} from './learn-slack-threads-catalog.mjs';
import {PACING_FUNCTIONS} from './learn-slack-pacing-bundle.mjs';
export {PACING_FUNCTIONS};
export const PACING_FUNCTION_QUERY=THREADS_FUNCTION_QUERY.replace(THREADS_FUNCTIONS.map(n=>`'${n}'`).join(','),PACING_FUNCTIONS.map(n=>`'${n}'`).join(','));
export async function readPacingCatalog(args){const c=await readOperatorCatalog(args);return {...c,pacingFunctions:c.threadFunctions.filter(f=>PACING_FUNCTIONS.includes(f.name))};}
