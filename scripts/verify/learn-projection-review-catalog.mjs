/** Prior TEST catalog plus authenticated, audited projection review. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import {
  PROJECTION_CATALOG,
  projectionInstalledSnapshot,
} from "./learn-interaction-projection-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const tables = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  tables,
  "'learn_projection_operator_reviews'",
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  "'learn_projection_review_state','learn_operator_projection_reviews','learn_operator_projection_review_detail','learn_operator_projection_review'",
);
export const REVIEW_CATALOG = `(${PROJECTION_CATALOG})||jsonb_build_object('projectionReview',(${metadata}))`;
export async function readReviewCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with x as materialized(select ${REVIEW_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint ?? "") ||
    (rows[0].catalog?.projectionReview?.tables !== null &&
      !Array.isArray(rows[0].catalog?.projectionReview?.tables))
  )
    throw Error("Incomplete projection review catalog");
  return rows[0];
}
export const reviewInstalledSnapshot = (catalog) =>
  projectionInstalledSnapshot(catalog) +
  " union all select 'public.learn_projection_operator_reviews' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_projection_operator_reviews s";
