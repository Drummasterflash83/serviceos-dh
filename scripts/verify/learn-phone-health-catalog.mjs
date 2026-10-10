/** Complete TEST metadata for the operator Phone evidence release. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  MAPPING_CATALOG,
  MAPPING_SNAPSHOT,
  MAPPING_PRESERVED,
} from "./learn-commusoft-mapping-catalog.mjs";
export const PHONE_HEALTH_PRESERVED = MAPPING_PRESERVED;
export const PHONE_HEALTH_SNAPSHOT = MAPPING_SNAPSHOT;
export const PHONE_HEALTH_FUNCTIONS = [
  "phone_pending_readiness",
  "learn_phone_account_evidence",
  "learn_phone_processing_evidence",
  "learn_operator_capture_health",
];
export const PHONE_HEALTH_CATALOG = `jsonb_build_object('base',${MAPPING_CATALOG},'phoneEvidence',jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${PHONE_HEALTH_FUNCTIONS.map((n) => `'${n}'`).join(",")})),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and indexname='learn_phone_schedule_health_lookup')))`;
export async function readPhoneHealthCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${PHONE_HEALTH_CATALOG} as catalog,md5((${PHONE_HEALTH_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    ![2, 4].includes(rows[0].catalog?.phoneEvidence?.functions?.length)
  )
    throw Error("Phone evidence catalog incomplete");
  return rows[0];
}
