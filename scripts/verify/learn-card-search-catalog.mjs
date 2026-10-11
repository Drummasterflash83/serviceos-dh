/** Canonical card-search metadata and exact preceding TEST release. No source payloads. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  WORKING_RELEASE_CATALOG,
  WORKING_RELEASE_PRESERVED,
  WORKING_RELEASE_TABLES,
} from "./learn-working-release-catalog.mjs";
export const CARD_SEARCH_TABLES = ["customer_cards", "jobs", "team_members", "org_units"];
export const CARD_SEARCH_PRESERVED = [
  ...WORKING_RELEASE_PRESERVED,
  ...WORKING_RELEASE_TABLES.map((n) => "public." + n),
];
export const CARD_SEARCH_SNAPSHOT = CARD_SEARCH_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
const table = (
  name,
) => `(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename=c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}')`;
const functions = `(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_card_search')`;
export const CARD_SEARCH_CATALOG = `jsonb_build_object('base',${WORKING_RELEASE_CATALOG},'tables',jsonb_build_array(${CARD_SEARCH_TABLES.map(table).join(",")}),'functions',${functions})`;
export async function readCardSearchCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;with snapshot as materialized(select ${CARD_SEARCH_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint,md5((catalog->'base')::text) as "baseFingerprint" from snapshot`,
    options,
  );
  const r = rows[0];
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(r?.fingerprint) ||
    ![0, 1].includes(r.catalog?.functions?.length) ||
    r.catalog?.tables?.length !== 4 ||
    !r.catalog.tables.every((t, i) => t?.name === CARD_SEARCH_TABLES[i] && t.rls === true) ||
    r.catalog?.base?.functions?.length !== 27
  )
    throw Error("Card search catalog incomplete");
  return r;
}
