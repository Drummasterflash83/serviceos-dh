/** Schema-only metadata for the additive thread recovery release. */
import {readAssessmentCatalog} from './learn-assessments-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const THREAD_RECOVERY_FUNCTIONS=['learn_slack_resume_thread','learn_slack_thread_recovery_read','learn_slack_thread_recovery_state'];
export const THREAD_RECOVERY_INDEXES=['learn_slack_thread_approval_order','learn_slack_thread_one_recovery'];
export const THREAD_RECOVERY_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,`p.proname in (${THREAD_RECOVERY_FUNCTIONS.map(n=>`'${n}'`).join(',')})`).replace(' as functions',' as thread_recovery_functions');
export async function readThreadRecoveryCatalog(args){
 const c=await readAssessmentCatalog(args),rows=await communicationQuery(args.token,THREAD_RECOVERY_FUNCTION_QUERY,args);
 if(rows?.length!==1||!Array.isArray(rows[0]?.thread_recovery_functions))throw Error('Thread recovery metadata incomplete');
 return {...c,threadRecoveryFunctions:rows[0].thread_recovery_functions};
}
