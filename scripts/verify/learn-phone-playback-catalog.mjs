/** Retained audio access extends the installed operator catalog without changing old grants. */
import {
  PHONE_OPERATOR_CATALOG,
  PHONE_OPERATOR_PRESERVED,
  phoneOperatorSourceQuery,
} from "./learn-phone-operator-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const PHONE_PLAYBACK_FILES = ["supabase/migrations/20261101230000_learn_phone_playback.sql"];
export const PHONE_PLAYBACK_CATALOG = PHONE_OPERATOR_CATALOG.replaceAll(
  "'learn_phone_operator_reconciliations'",
  "'learn_phone_operator_reconciliations','learn_phone_playback_audit'",
).replace(
  "'learn_operator_phone_reconcile'",
  "'learn_operator_phone_reconcile','learn_phone_recordings_read','learn_phone_playback_authorize'",
);
export const PHONE_PLAYBACK_PRESERVED = [
  ...PHONE_OPERATOR_PRESERVED,
  "public.learn_phone_operator_reconciliations",
];
export const phonePlaybackSourceQuery = (catalog) =>
  phoneOperatorSourceQuery(catalog) +
  " union all select 'public.learn_phone_operator_reconciliations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_operator_reconciliations s";
export async function readPhonePlaybackCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with snapshot as materialized(select ${PHONE_PLAYBACK_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from snapshot`,
  );
  const r = rows[0];
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(r?.fingerprint ?? "") ||
    !Array.isArray(r.catalog?.phone?.tables) ||
    !Array.isArray(r.catalog?.base?.ledger)
  )
    throw Error("Playback catalog incomplete");
  return r;
}
