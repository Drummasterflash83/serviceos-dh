/** Extended Phone schema catalog and pre-existing data fingerprints; no source values. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  PHONE_CATALOG,
  PHONE_TABLES,
  PHONE_FUNCTIONS,
  PHONE_PRESERVED,
} from "./learn-phone-publication-catalog.mjs";
const list = (xs) => xs.map((s) => "'" + s + "'").join(",");
export const SETTLEMENT_TABLES = [
  ...PHONE_TABLES,
  "learn_phone_import_completions",
  "learn_phone_schedule_settlements",
];
export const SETTLEMENT_FUNCTIONS = [
  ...PHONE_FUNCTIONS,
  "learn_phone_complete_import",
  "learn_phone_settle_schedule",
];
export const SETTLEMENT_CATALOG = PHONE_CATALOG.replace(
  list(PHONE_TABLES),
  list(SETTLEMENT_TABLES),
).replace(list(PHONE_FUNCTIONS), list(SETTLEMENT_FUNCTIONS));
export const SETTLEMENT_PRESERVED = [
  ...new Set([...PHONE_PRESERVED, "public.learn_phone_capture_pages"]),
];
export const SETTLEMENT_SNAPSHOT = SETTLEMENT_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
export async function readPhoneSettlementCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${SETTLEMENT_CATALOG} as catalog,md5((${SETTLEMENT_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.phone?.functions)
  )
    throw Error("Phone settlement catalog incomplete");
  return rows[0];
}
