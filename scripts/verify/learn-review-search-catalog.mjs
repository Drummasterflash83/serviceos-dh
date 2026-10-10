/** Full TEST metadata plus retained-record search and its existing access boundary. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  PHONE_HEALTH_CATALOG,
  PHONE_HEALTH_PRESERVED,
  PHONE_HEALTH_SNAPSHOT,
} from "./learn-phone-health-catalog.mjs";
export const REVIEW_SEARCH_PRESERVED = PHONE_HEALTH_PRESERVED;
export const REVIEW_SEARCH_SNAPSHOT = PHONE_HEALTH_SNAPSHOT;
const functions = (names) =>
  `(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${names.map((n) => `'${n}'`).join(",")}))`;
export const REVIEW_SEARCH_CATALOG = `jsonb_build_object('base',${PHONE_HEALTH_CATALOG},'search',${functions(["learn_commusoft_source_matches", "learn_commusoft_review_search", "learn_commusoft_work_review_search"])},'existingReview',${functions(["learn_business_input_review_access", "learn_import_batch_authority", "learn_commusoft_review_page", "learn_commusoft_work_review_page"])})`;
export async function readReviewSearchCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${REVIEW_SEARCH_CATALOG} as catalog,md5((${REVIEW_SEARCH_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    ![0, 3].includes(rows[0].catalog?.search?.length) ||
    rows[0].catalog?.existingReview?.length !== 4
  )
    throw Error("Review search catalog incomplete");
  return rows[0];
}
