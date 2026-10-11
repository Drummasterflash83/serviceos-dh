import {
  PHONE_PLAYBACK_CATALOG,
  PHONE_PLAYBACK_PRESERVED,
  phonePlaybackSourceQuery,
} from "./learn-phone-playback-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const PHONE_SAVED_RESULTS_CATALOG = PHONE_PLAYBACK_CATALOG.replace(
  "'learn_phone_playback_authorize'",
  "'learn_phone_playback_authorize','learn_phone_saved_results_read'",
);
export const PHONE_SAVED_RESULTS_FILES = [
  "supabase/migrations/20261101240000_learn_phone_saved_results.sql",
];
export const PHONE_SAVED_RESULTS_PRESERVED = [
  ...PHONE_PLAYBACK_PRESERVED,
  "public.learn_phone_playback_audit",
];
export const phoneSavedResultsSourceQuery = (catalog) =>
  phonePlaybackSourceQuery(catalog) +
  " union all select 'public.learn_phone_playback_audit' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from public.learn_phone_playback_audit s";
export async function readPhoneSavedResultsCatalog(token) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with snapshot as materialized(select ${PHONE_SAVED_RESULTS_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from snapshot`,
  );
  const r = rows[0];
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(r?.fingerprint ?? "") ||
    !Array.isArray(r.catalog?.phone?.functions) ||
    !Array.isArray(r.catalog?.base?.ledger)
  )
    throw Error("Saved result catalog incomplete");
  return r;
}
