/** TEST retained-voicemail discovery metadata and preservation; no message content returned. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import {
  VOICEMAIL_QUEUE_CATALOG,
  voicemailQueueSnapshot,
} from "./learn-voicemail-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const VOICEMAIL_DISCOVERY_TABLES = [
  "receptionist_voicemail_scans",
  "receptionist_voicemail_candidates",
  "receptionist_voicemail_scan_receipts",
];
export const VOICEMAIL_DISCOVERY_FUNCTIONS = [
  "voicemail_discover_page",
  "voicemail_discovery_status",
];
const quoted = (a) => a.map((x) => `'${x}'`).join(",");
export const VOICEMAIL_DISCOVERY_METADATA = PHONE_PROCESSING_METADATA.replaceAll(
  quoted(PHONE_PROCESSING_TABLES),
  quoted(VOICEMAIL_DISCOVERY_TABLES),
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  quoted(VOICEMAIL_DISCOVERY_FUNCTIONS),
);
export const VOICEMAIL_DISCOVERY_CATALOG = `(${VOICEMAIL_QUEUE_CATALOG})||jsonb_build_object('voicemailDiscovery',(${VOICEMAIL_DISCOVERY_METADATA}))`;
export async function readVoicemailDiscoveryCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with c as materialized(select ${VOICEMAIL_DISCOVERY_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from c`,
  );
  if (
    rows.length !== 1 ||
    !rows[0].catalog?.voicemailDiscovery ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint ?? "")
  )
    throw Error("Discovery catalog incomplete");
  return rows[0];
}
export const voicemailDiscoverySnapshot = (phone) =>
  voicemailQueueSnapshot(phone) +
  VOICEMAIL_DISCOVERY_TABLES.map(
    (n) =>
      ` union all select 'public.${n}',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from public.${n} s`,
  ).join("");
