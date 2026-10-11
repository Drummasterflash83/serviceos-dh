/** Operator recovery extends the installed Phone catalog; source contents stay private. */
import {PHONE_PROCESSING_METADATA,PHONE_PROCESSING_TABLES,phoneProcessingSourceQuery} from './learn-phone-processing-catalog.mjs';
import {EMAIL_DIAGNOSTIC_CATALOG,EMAIL_DIAGNOSTIC_PRESERVED} from './learn-email-diagnostic-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
export const PHONE_OPERATOR_FILES=['supabase/migrations/20261101220000_learn_phone_operator_attempts.sql'];
const metadata=PHONE_PROCESSING_METADATA.replaceAll("'learn_phone_result_versions'","'learn_phone_result_versions','learn_phone_operator_reconciliations'")
 .replace("'phone_pending_readiness'","'phone_pending_readiness','learn_operator_phone_attempts','learn_operator_phone_reconcile'");
export const PHONE_OPERATOR_CATALOG=`jsonb_build_object('phone',(${metadata}),'base',${EMAIL_DIAGNOSTIC_CATALOG})`;
const added=[...PHONE_PROCESSING_TABLES.slice(3).map(n=>'public.'+n),'auth.users','auth.sessions','auth.identities'];
export const PHONE_OPERATOR_PRESERVED=[...EMAIL_DIAGNOSTIC_PRESERVED,...added];
export const phoneOperatorSourceQuery=catalog=>phoneProcessingSourceQuery(catalog)+' union all '+added.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
export async function readPhoneOperatorCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with snapshot as materialized(select ${PHONE_OPERATOR_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from snapshot`);
 const r=rows[0];if(rows.length!==1||!/^[a-f0-9]{32}$/.test(r?.fingerprint??'')||!Array.isArray(r.catalog?.phone?.tables)||!Array.isArray(r.catalog?.base?.ledger))throw Error('Phone operator catalog incomplete');return r;
}
