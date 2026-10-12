import { MICROSOFT_CATALOG, microsoftSnapshot } from './learn-microsoft-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
export const MICROSOFT_STATUS_METADATA=`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_operator_microsoft_status'))`;
export const MICROSOFT_STATUS_CATALOG=`(${MICROSOFT_CATALOG})||jsonb_build_object('microsoftStatus',(${MICROSOFT_STATUS_METADATA}))`;
export async function readMicrosoftStatusCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with c as materialized(select ${MICROSOFT_STATUS_CATALOG} as catalog)select catalog,md5(catalog::text) as fingerprint from c`);
 if(rows.length!==1||!rows[0].catalog?.microsoftStatus||!/^[a-f0-9]{32}$/.test(rows[0].fingerprint??''))throw Error('Microsoft status catalog unavailable');return rows[0];
}
export const microsoftStatusSnapshot=microsoftSnapshot;
