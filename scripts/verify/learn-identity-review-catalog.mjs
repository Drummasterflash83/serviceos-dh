/** Prior TEST catalog plus authenticated, audited identity review. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import { REVIEW_CATALOG, reviewInstalledSnapshot } from "./learn-projection-review-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const tables = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  tables,
  "'learn_identity_operator_reviews'",
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  "'learn_identity_deliver_internal','learn_identity_review_state','learn_operator_identity_reviews','learn_operator_identity_people','learn_operator_identity_review_detail','learn_operator_identity_review'",
);
export const IDENTITY_REVIEW_CATALOG = `(${REVIEW_CATALOG})||jsonb_build_object('identityReview',(${metadata}))`;
export async function readIdentityReviewCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with x as materialized(select ${IDENTITY_REVIEW_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint ?? "") ||
    (rows[0].catalog?.identityReview?.tables !== null &&
      !Array.isArray(rows[0].catalog?.identityReview?.tables))
  )
    throw Error("Incomplete identity review catalog");
  return rows[0];
}
export const identityReviewInstalledSnapshot = (catalog) =>
  reviewInstalledSnapshot(catalog) +
  " union all select 'public.learn_identity_operator_reviews' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_identity_operator_reviews s";
