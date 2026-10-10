/** Exact metadata for the correction ledger, RPC and all previously verified TEST objects. */
import {readCommunicationCatalog,communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const CORRECTION_TABLE='learn_performance_corrections',CORRECTION_FUNCTION='learn_performance_correct';
export const CORRECTION_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,"p.proname in ('learn_performance_correct')");
export const CORRECTION_ACCESS_QUERY=`select coalesce(jsonb_agg(x order by x::text),'[]') as access from (
 select jsonb_build_object('role',r,'privilege',p,'allowed',has_table_privilege(r,c.oid,p)) x
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
 where n.nspname='public' and c.relname='learn_performance_corrections'
) a`;
export async function readCorrectionCatalog(args){
 const c=await readCommunicationCatalog(args);
 const f=await communicationQuery(args.token,CORRECTION_FUNCTION_QUERY,args);
 const a=await communicationQuery(args.token,CORRECTION_ACCESS_QUERY,args);
 if(f?.length!==1||!Array.isArray(f[0].functions)||a?.length!==1||!Array.isArray(a[0].access))throw Error('Correction catalog incomplete');
 return {...c,correctionFunctions:f[0].functions,correctionAccess:a[0].access};
}
