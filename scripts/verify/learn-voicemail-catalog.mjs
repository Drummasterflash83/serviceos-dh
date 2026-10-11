/** Exact TEST voicemail schema/permissions and retained-source fingerprints. */
import {
  PHONE_PROCESSING_METADATA,
  PHONE_PROCESSING_TABLES,
} from "./learn-phone-processing-catalog.mjs";
import {
  MAILBOX_CHANGES_CATALOG,
  mailboxChangesSnapshot,
} from "./learn-email-mailbox-changes-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const VOICEMAIL_TABLES = [
  "receptionist_mailboxes",
  "receptionist_mailbox_managers",
  "receptionist_voicemails",
  "receptionist_voicemail_access_log",
  "receptionist_voicemail_email_routes",
  "receptionist_voicemail_intakes",
  "receptionist_voicemail_sources",
];
export const VOICEMAIL_FUNCTIONS = [
  "can_manage_voicemail",
  "voicemail_mailbox_summary",
  "voicemail_intake_immutable",
  "voicemail_intake_route",
  "voicemail_intake_prepare",
  "voicemail_intake_publish",
];
const quoted = (a) => a.map((n) => `'${n}'`).join(",");
const metadata = PHONE_PROCESSING_METADATA.replaceAll(
  quoted(PHONE_PROCESSING_TABLES),
  quoted(VOICEMAIL_TABLES),
).replace(
  "'learn_phone_download_attempt','learn_phone_derived_attempt','learn_phone_apply_intelligence','phone_pending_readiness'",
  quoted(VOICEMAIL_FUNCTIONS),
);
export const VOICEMAIL_METADATA = `(${metadata})||jsonb_build_object(
 'buckets',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public,'size',file_size_limit,'mime',allowed_mime_types) order by id),'[]') from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources')),
 'storagePolicies',(select coalesce(jsonb_agg(to_jsonb(p) order by policyname),'[]') from pg_policies p where schemaname='storage' and policyname in ('voicemail_no_direct_storage_access','voicemail_source_no_direct_storage_access')))`;
export const VOICEMAIL_CATALOG = `(${MAILBOX_CHANGES_CATALOG})||jsonb_build_object('voicemail',${VOICEMAIL_METADATA})`;
export async function readVoicemailCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with c as materialized(select ${VOICEMAIL_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from c`,
  );
  if (
    rows.length !== 1 ||
    !rows[0]?.catalog?.voicemail ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint ?? "")
  )
    throw Error("Voicemail catalog incomplete");
  return rows[0];
}
export const voicemailPreservedSnapshot = (phone) =>
  mailboxChangesSnapshot(phone, { archive: true }) +
  `
 union all select 'storage.other_buckets',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from storage.buckets s where id not in ('receptionist-voicemails','learn-voicemail-sources')
 union all select 'security.roles',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from pg_roles s
 union all select 'security.memberships',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from pg_auth_members s`;
export const voicemailInstalledSnapshot = (phone) =>
  voicemailPreservedSnapshot(phone) +
  VOICEMAIL_TABLES.map(
    (n) =>
      ` union all select 'public.${n}',count(*)::int,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) from public.${n} s`,
  ).join("");
