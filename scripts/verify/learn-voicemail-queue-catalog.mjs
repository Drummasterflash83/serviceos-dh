/** TEST queue schema/permissions and preservation metadata only. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import { VOICEMAIL_CATALOG, voicemailInstalledSnapshot } from "./learn-voicemail-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const VOICEMAIL_QUEUE_TABLES = [
  "receptionist_voicemail_jobs",
  "receptionist_voicemail_job_receipts",
];
export const VOICEMAIL_QUEUE_FUNCTIONS = [
  "voicemail_job_immutable",
  "voicemail_queue_step",
  "voicemail_queue_recover",
];
const quoted = (a) => a.map((x) => `'${x}'`).join(",");
export const VOICEMAIL_QUEUE_METADATA = PHONE_PROCESSING_METADATA.replaceAll(
  quoted(PHONE_PROCESSING_TABLES),
  quoted(VOICEMAIL_QUEUE_TABLES),
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  quoted(VOICEMAIL_QUEUE_FUNCTIONS),
);
export const VOICEMAIL_QUEUE_CATALOG = `(${VOICEMAIL_CATALOG})||jsonb_build_object('voicemailQueue',(${VOICEMAIL_QUEUE_METADATA}))`;
export async function readVoicemailQueueCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with c as materialized(select ${VOICEMAIL_QUEUE_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from c`,
  );
  if (
    rows.length !== 1 ||
    !rows[0].catalog?.voicemailQueue ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint ?? "")
  )
    throw Error("Queue catalog incomplete");
  return rows[0];
}
export const voicemailQueueSnapshot = (phone) =>
  voicemailInstalledSnapshot(phone) +
  VOICEMAIL_QUEUE_TABLES.map(
    (n) =>
      ` union all select 'public.${n}',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from public.${n} s`,
  ).join("");
