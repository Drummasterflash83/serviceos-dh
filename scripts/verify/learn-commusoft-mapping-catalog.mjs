/** TEST review-function metadata and all retained source fingerprints. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  TRAVERSAL_CATALOG,
  TRAVERSAL_PRESERVED,
} from "./learn-commusoft-contact-traversal-catalog.mjs";
export const MAPPING_FUNCTIONS = [
  "learn_commusoft_customer_candidates",
  "learn_commusoft_confirm_work_record",
  "learn_business_contact_phone",
];
export const MAPPING_FUNCTION_CATALOG = `(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${MAPPING_FUNCTIONS.map((n) => `'${n}'`).join(",")}))`;
export const MAPPING_CATALOG = `jsonb_build_object('base',${TRAVERSAL_CATALOG},'mapping',${MAPPING_FUNCTION_CATALOG})`;
export const MAPPING_PRESERVED = [...TRAVERSAL_PRESERVED, "public.learn_commusoft_contact_targets"];
export const MAPPING_SNAPSHOT = MAPPING_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export async function readMappingCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${MAPPING_CATALOG} as catalog,md5((${MAPPING_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    rows[0].catalog?.mapping?.length !== 3
  )
    throw Error("Mapping catalog incomplete");
  return rows[0];
}
