/** Metadata and aggregate preservation for the existing client progress model. */
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {OPERATOR_HEALTH_CATALOG,OPERATOR_HEALTH_TABLES,OPERATOR_HEALTH_FUNCTIONS} from './learn-operator-health-catalog.mjs';
import {RUNTIME_CATALOG_EXPRESSION} from './learn-email-runtime-catalog.mjs';
import {RECURRING_PRESERVED} from './learn-slack-recurring-catalog.mjs';
const list=xs=>xs.map(s=>"'"+s+"'").join(',');
export const DELIVERY_TABLES=['client_delivery_updates','controlplane_change_log','view_as_context'];
const delivery=OPERATOR_HEALTH_CATALOG.replace(`'runtime',${RUNTIME_CATALOG_EXPRESSION},`,'')
 .replace(list(OPERATOR_HEALTH_TABLES),list(DELIVERY_TABLES))
 .replace(list(OPERATOR_HEALTH_FUNCTIONS),"'operator_update_delivery','learn_delivery_audit_immutable'");
export const DELIVERY_CATALOG=`jsonb_build_object('health',${OPERATOR_HEALTH_CATALOG},'delivery',${delivery})`;
export const DELIVERY_PRESERVED=[...new Set([...RECURRING_PRESERVED,'public.slack_recurring_channels','public.slack_recurring_requests'])];
export const DELIVERY_SNAPSHOT=DELIVERY_PRESERVED.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`).join(' union all ');
export async function readDeliveryCatalog(token){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;select ${DELIVERY_CATALOG} as catalog,md5((${DELIVERY_CATALOG})::text) as fingerprint`);
 if(rows.length!==1||!/^[a-f0-9]{32}$/.test(rows[0].fingerprint)||!Array.isArray(rows[0].catalog?.delivery?.tables))throw Error('Delivery catalog incomplete');
 return rows[0];
}
