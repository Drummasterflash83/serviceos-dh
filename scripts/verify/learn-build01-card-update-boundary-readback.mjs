/** LIVE catalog-only guard before any isolated rollback update diagnostic. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`LIVE card catalog HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("LIVE card catalog shape changed");
  return rows;
}
const rows = await read(`select t.tgname trigger_name,
    p.proname function_name,n.nspname function_schema,
    t.tgisinternal internal
  from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  join pg_namespace n on n.oid=p.pronamespace
  where t.tgrelid='public.customer_cards'::regclass
  order by t.tgname`);
if (rows.some((r) => typeof r.trigger_name !== "string" ||
  typeof r.function_name !== "string" || typeof r.function_schema !== "string" ||
  typeof r.internal !== "boolean")) throw Error("LIVE card trigger shape changed");
const foreignKeys = await read(`select k.conname constraint_name,
  sa.attname child_column, sn.nspname parent_schema,
  pc.relname parent_table, pa.attname parent_column
from pg_constraint k join pg_class pc on pc.oid=k.confrelid
join pg_namespace sn on sn.oid=pc.relnamespace
join pg_attribute sa on sa.attrelid=k.conrelid and sa.attnum=k.conkey[1]
join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
where k.conrelid='public.customer_cards'::regclass and k.contype='f'
  and cardinality(k.conkey)=1 and cardinality(k.confkey)=1
order by k.conname`);
if (foreignKeys.some((r) => ["constraint_name","child_column","parent_schema",
  "parent_table","parent_column"].some((key) => typeof r[key] !== "string")))
  throw Error("LIVE card FK catalog shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, triggers: rows,
  foreignKeys,
  productionDataWrites: false }));
