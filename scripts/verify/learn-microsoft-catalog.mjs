/** Complete installed TEST catalog plus private Microsoft source/queue metadata. */
import { PHONE_PROCESSING_METADATA, PHONE_PROCESSING_TABLES } from "./learn-phone-processing-catalog.mjs";
import { VOICEMAIL_INBOX_CATALOG, voicemailInboxSnapshot } from "./learn-voicemail-inbox-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const MICROSOFT_TABLES = [
  "learn_microsoft_mailbox_bindings", "learn_microsoft_capture_streams", "learn_microsoft_source_pages",
  "learn_microsoft_job_completions", "learn_microsoft_folder_dispatches", "learn_microsoft_projection_receipts",
  "learn_microsoft_discovery_rounds", "learn_microsoft_job_stops",
];
const quoted=a=>a.map(s=>`'${s}'`).join(",");
export const MICROSOFT_METADATA=PHONE_PROCESSING_METADATA.replaceAll(quoted(PHONE_PROCESSING_TABLES),quoted(MICROSOFT_TABLES))
  .replace("p.proname in ('learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness')","p.proname like 'learn_microsoft_%'");
export const MICROSOFT_CATALOG=`(${VOICEMAIL_INBOX_CATALOG})||jsonb_build_object('microsoft',(${MICROSOFT_METADATA}))`;
export async function readMicrosoftCatalog(token) {
  const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with c as materialized(select ${MICROSOFT_CATALOG} as catalog)select catalog,md5(catalog::text) as fingerprint from c`);
  if(rows.length!==1 || !rows[0].catalog?.microsoft || !/^[a-f0-9]{32}$/.test(rows[0].fingerprint??"")) throw Error("Microsoft catalog incomplete");
  return rows[0];
}
export const microsoftSnapshot=phone=>voicemailInboxSnapshot(phone)+MICROSOFT_TABLES.map(n=>
  ` union all select 'public.${n}',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from public.${n} s`).join("");
