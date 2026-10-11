/** TEST retained-voicemail discovery metadata and preservation; no message content returned. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import {
  VOICEMAIL_DISCOVERY_CATALOG,
  voicemailDiscoverySnapshot,
} from "./learn-voicemail-discovery-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const VOICEMAIL_DISPATCH_TABLES = ["receptionist_voicemail_dispatch_receipts"];
export const VOICEMAIL_DISPATCH_FUNCTIONS = [
  "voicemail_schedule_tick",
  "voicemail_discovery_status_data",
  "learn_operator_voicemail_status",
];
const quoted = (a) => a.map((x) => `'${x}'`).join(",");
export const VOICEMAIL_DISPATCH_METADATA = PHONE_PROCESSING_METADATA.replaceAll(
  quoted(PHONE_PROCESSING_TABLES),
  quoted(VOICEMAIL_DISPATCH_TABLES),
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  quoted(VOICEMAIL_DISPATCH_FUNCTIONS),
);
export const VOICEMAIL_DISPATCH_CATALOG = `(${VOICEMAIL_DISCOVERY_CATALOG})||jsonb_build_object('voicemailDispatch',(${VOICEMAIL_DISPATCH_METADATA}))`;
export async function readVoicemailDispatchCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with c as materialized(select ${VOICEMAIL_DISPATCH_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from c`,
  );
  if (
    rows.length !== 1 ||
    !rows[0].catalog?.voicemailDispatch ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint ?? "")
  )
    throw Error("Dispatch catalog incomplete");
  return rows[0];
}
export const voicemailDispatchSnapshot = (phone) =>
  voicemailDiscoverySnapshot(phone) +
  VOICEMAIL_DISPATCH_TABLES.map(
    (n) =>
      ` union all select 'public.${n}',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from public.${n} s`,
  ).join("");
