/** Atomic handoff schema plus the complete previously accepted TEST catalog. */
import { PHONE_PROCESSING_METADATA, PHONE_PROCESSING_TABLES } from './learn-phone-processing-catalog.mjs';
import { PHONE_SAVED_RESULTS_CATALOG, phoneSavedResultsSourceQuery } from './learn-phone-saved-results-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
export const HANDOFF_FILES = [
 '20260709150000_platform_events.sql',
 '20260713120000_phone_projection_incremental.sql',
 '20260714120000_input_reliability_finalisation.sql',
 '20261101290000_learn_phone_atomic_handoff.sql',
];
const oldTables=PHONE_PROCESSING_TABLES.map(n=>`'${n}'`).join(',');
const tables="'interactions','phone_ai_insights','platform_events','learn_phone_handoff_receipts'";
export const HANDOFF_METADATA=PHONE_PROCESSING_METADATA.replaceAll(oldTables,tables).replace(
 "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
 "'learn_phone_handoff','phone_projection_version','phone_select_projectable','phone_projection_diagnostics'"
);
export const HANDOFF_CATALOG=`(${PHONE_SAVED_RESULTS_CATALOG})||jsonb_build_object('handoff',(${HANDOFF_METADATA}))`;
export async function readHandoffCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with x as materialized(select ${HANDOFF_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`);
 if(rows.length!==1||!/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint??'')||!Array.isArray(rows[0].catalog?.handoff?.tables))throw Error('Incomplete handoff catalog');
 return rows[0];
}
// Only for the 060 -> 061 transition: the two new nullable interaction columns
// do not exist in the prior schema. The package separately requires all retained
// rows to have NULL in both columns after installation. All other fields remain.
export function handoffTransitionSnapshot(catalog){
 const parts=phoneSavedResultsSourceQuery(catalog).split(' union all ');
 const matches=parts.filter(s=>s.endsWith('from public.interactions s'));
 if(matches.length!==1)throw Error('Exact interactions preservation query required');
 return parts.map(s=>s===matches[0]?s.replaceAll('to_jsonb(s)',"(to_jsonb(s)-array['source_version','source_updated_at']::text[])"):s).join(' union all ');
}
export const handoffInstalledSnapshot=(catalog)=>phoneSavedResultsSourceQuery(catalog)+['platform_events','learn_phone_handoff_receipts'].map(n=>` union all select 'public.${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.${n} s`).join('');
