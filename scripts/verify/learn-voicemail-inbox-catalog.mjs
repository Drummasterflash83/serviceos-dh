import {
  VOICEMAIL_DISPATCH_CATALOG,
  voicemailDispatchSnapshot,
} from "./learn-voicemail-dispatch-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const VOICEMAIL_INBOX_METADATA = `select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_voicemail_mailboxes'))`;
export const VOICEMAIL_INBOX_CATALOG = `(${VOICEMAIL_DISPATCH_CATALOG})||jsonb_build_object('voicemailInbox',(${VOICEMAIL_INBOX_METADATA}))`;
export async function readVoicemailInboxCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with c as materialized(select ${VOICEMAIL_INBOX_CATALOG} as catalog)select catalog,md5(catalog::text) as fingerprint from c`,
  );
  if (
    rows.length !== 1 ||
    !rows[0].catalog?.voicemailInbox ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint ?? "")
  )
    throw Error("Inbox catalog unavailable");
  return rows[0];
}
export const voicemailInboxSnapshot = voicemailDispatchSnapshot;
