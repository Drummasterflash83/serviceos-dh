/** Schema-only assessment ledger/RPC and every previously verified TEST object. */
import {readSourceCatalog} from './learn-card-sources-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const ASSESSMENT_TABLE='learn_assessments',ASSESSMENT_FUNCTIONS=['learn_assessment_immutable','learn_assessment_save'];
export const ASSESSMENT_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,"p.proname in ('learn_assessment_immutable','learn_assessment_save')").replace(' as functions',' as assessment_functions');
export const ASSESSMENT_ACCESS_QUERY=`select coalesce(jsonb_agg(x order by x::text),'[]') as assessment_access from (
 select jsonb_build_object('role',r,'column',null,'privilege',p,'allowed',has_table_privilege(r,c.oid,p)) x
 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
 where n.nspname='public' and c.relname='learn_assessments'
 union all select jsonb_build_object('role',r,'column',a.attname,'privilege',p,'allowed',has_column_privilege(r,c.oid,a.attnum,p))
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
 cross join unnest(array['anon','authenticated','service_role']) r cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
 where n.nspname='public' and c.relname='learn_assessments'
) a`;
export async function readAssessmentCatalog(args){const c=await readSourceCatalog(args),f=await communicationQuery(args.token,ASSESSMENT_FUNCTION_QUERY,args),a=await communicationQuery(args.token,ASSESSMENT_ACCESS_QUERY,args);if(f?.length!==1||!Array.isArray(f[0].assessment_functions)||a?.length!==1||!Array.isArray(a[0].assessment_access))throw Error('Assessment catalog incomplete');return {...c,assessmentFunctions:f[0].assessment_functions,assessmentAccess:a[0].assessment_access};}
