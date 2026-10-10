/** Metadata-only read of the private estimate, its authority dependencies and preservation. */
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {DELIVERY_CATALOG,DELIVERY_PRESERVED} from './learn-delivery-catalog.mjs';
export const INVESTMENT_CATALOG=`jsonb_build_object('delivery',${DELIVERY_CATALOG},'functions',
 (select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('care_desk_operator','openfolk_build_investment')))`;
export const INVESTMENT_PRESERVED=[...DELIVERY_PRESERVED,'public.client_delivery_updates','public.controlplane_change_log'];
export const INVESTMENT_SNAPSHOT=INVESTMENT_PRESERVED.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
export async function readInvestmentCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;select ${INVESTMENT_CATALOG} as catalog,md5((${INVESTMENT_CATALOG})::text) as fingerprint`);
 if(rows.length!==1||!/^[a-f0-9]{32}$/.test(rows[0].fingerprint)||!Array.isArray(rows[0].catalog?.functions))throw Error('Private estimate catalog incomplete');
 return rows[0];
}
