/** Prior TEST catalog plus authenticated, audited identity review. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import {
  IDENTITY_REVIEW_CATALOG,
  identityReviewInstalledSnapshot,
} from "./learn-identity-review-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const tables = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  tables,
  "'learn_processing_publications','learn_processing_settlements'",
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  "'learn_identity_review_count','learn_processing_publish','learn_processing_settle'",
);
export const QUEUE_CATALOG = `(${IDENTITY_REVIEW_CATALOG})||jsonb_build_object('processingQueue',(${metadata}))`;
export async function readQueueCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with x as materialized(select ${QUEUE_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint ?? "") ||
    (rows[0].catalog?.processingQueue?.tables !== null &&
      !Array.isArray(rows[0].catalog?.processingQueue?.tables))
  )
    throw Error("Incomplete identity review catalog");
  return rows[0];
}
export const queueInstalledSnapshot = (catalog) =>
  identityReviewInstalledSnapshot(catalog) +
  ["learn_processing_publications", "learn_processing_settlements"]
    .map(
      (n) =>
        ` union all select 'public.${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.${n} s`,
    )
    .join("");
