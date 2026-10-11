/** Prior TEST catalog plus scoped retained-source publication. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import { IDENTITY_CATALOG, identityInstalledSnapshot } from "./learn-identity-delivery-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const tables = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  tables,
  "'interactions','email_messages','phone_calls','learn_interaction_projection_receipts'",
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  "'learn_phone_source_fields','learn_email_source_fields','learn_projection_revision','learn_projection_pending','learn_project_interaction','learn_projection_review_count'",
);
export const PROJECTION_CATALOG = `(${IDENTITY_CATALOG})||jsonb_build_object('projection',(${metadata}))`;
export async function readProjectionCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with x as materialized(select ${PROJECTION_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint ?? "") ||
    !Array.isArray(rows[0].catalog?.projection?.tables)
  )
    throw Error("Incomplete interaction projection catalog");
  return rows[0];
}
export const projectionInstalledSnapshot = (catalog) =>
  identityInstalledSnapshot(catalog) +
  " union all select 'public.learn_interaction_projection_receipts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_interaction_projection_receipts s";
