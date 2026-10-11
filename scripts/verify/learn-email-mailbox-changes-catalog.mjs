/** Gmail source history belongs in both release metadata and preservation inventory. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import { QUEUE_CATALOG, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
const names = PHONE_PROCESSING_TABLES.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  names,
  "'learn_email_source_versions','email_messages'",
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  "'learn_email_preserve_source_version','learn_email_store_unavailable','learn_email_store_page','email_ingestion_transition_v2'",
);
export const MAILBOX_CHANGES_CATALOG = `(${QUEUE_CATALOG})||jsonb_build_object('mailboxChanges',(${metadata}))`;
export async function readMailboxChangesCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with x as materialized(select ${MAILBOX_CHANGES_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from x`,
  );
  if (
    rows.length !== 1 ||
    !Array.isArray(rows[0]?.catalog?.mailboxChanges?.tables) ||
    !/^[a-f0-9]{32}$/.test(rows[0]?.fingerprint ?? "")
  )
    throw Error("Mailbox change catalog incomplete");
  return rows[0];
}
export const mailboxChangesSnapshot = (phone, { archive = false } = {}) =>
  queueInstalledSnapshot(phone) +
  [
    "recommendations",
    "interaction_match_suggestions",
    ...(archive ? ["learn_email_source_versions"] : []),
  ]
    .map(
      (n) =>
        ` union all select 'public.${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.${n} s`,
    )
    .join("");
