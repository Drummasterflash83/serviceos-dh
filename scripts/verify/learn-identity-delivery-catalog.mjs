/** Complete prior TEST catalog plus atomic identity/card delivery. */
import {PHONE_PROCESSING_METADATA,PHONE_PROCESSING_TABLES} from './learn-phone-processing-catalog.mjs';
import {HANDOFF_CATALOG,handoffInstalledSnapshot} from './learn-phone-handoff-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
const priorTables=PHONE_PROCESSING_TABLES.map(n=>`'${n}'`).join(',');
export const IDENTITY_METADATA=PHONE_PROCESSING_METADATA.replaceAll(priorTables,"'interactions','people','companies','customer_cards','recommendations','interaction_match_suggestions','learn_identity_delivery_receipts'").replace("'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'","'learn_identity_revision','learn_identity_pending','learn_identity_deliver'");
export const IDENTITY_CATALOG=`(${HANDOFF_CATALOG})||jsonb_build_object('identity',(${IDENTITY_METADATA}))`;
export async function readIdentityCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with x as materialized(select ${IDENTITY_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`);
 if(rows.length!==1||!/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint??'')||!Array.isArray(rows[0].catalog?.identity?.tables))throw Error('Incomplete identity catalog');
 return rows[0];
}
export const identityInstalledSnapshot=catalog=>handoffInstalledSnapshot(catalog)+" union all select 'public.learn_identity_delivery_receipts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_identity_delivery_receipts s";
