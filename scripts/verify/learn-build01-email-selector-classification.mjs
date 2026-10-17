/** Classify LIVE Email selector output without returning source IDs or content. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-ten-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `begin read only;
set local role service_role;
set local statement_timeout='20s';
with selected as materialized (
  select source_id from public.learn_projection_pending(
    '${tenant}'::uuid,'email',10)
), classified as (
  select s.source_id,
    exists(select 1 from public.interactions i
      where i.tenant_id='${tenant}'::uuid
        and i.source_table='email_messages' and i.source_id=s.source_id) linked,
    exists(select 1 from public.email_messages m
      where m.tenant_id='${tenant}'::uuid and m.id=s.source_id
        and m.created_at>=clock_timestamp()-interval '30 days') recently_imported
  from selected s
), definition as (
  select pg_get_functiondef(
    'public.learn_projection_pending(uuid,text,integer)'::regprocedure) body
)
select count(*)::int selected,
  count(*) filter(where not linked)::int unlinked,
  count(*) filter(where linked)::int linked,
  count(*) filter(where not linked and recently_imported)::int recent_unlinked,
  (select md5(body) from definition) selector_digest,
  (select position('learn_projection_pending_email_updates' in body) from definition)
    update_branch_position,
  (select position('return query with unlinked as materialized' in body) from definition)
    unlinked_branch_position,
  (select position('m.created_at>=clock_timestamp()-interval ''30 days''' in body)
    from definition) recent_import_position
from classified;
rollback;`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) {
  const detail = await response.json().catch(() => ({}));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
    state: "unconfirmed", httpStatus: response.status,
    code: typeof detail.code === "string" ? detail.code : null,
    statementTimeout: /statement timeout|canceling statement/i.test(detail.message ?? ""),
    sourceIdsReturned: false, messageContentReturned: false,
    productionDataWrites: false }));
  process.exitCode = 1;
  process.exit();
}
const rows = await response.json();
const result = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
    ["selected", "unlinked", "linked", "recent_unlinked",
      "update_branch_position", "unlinked_branch_position",
      "recent_import_position"].some(
      field => !Number.isSafeInteger(result[field]) || result[field] < 0) ||
    !/^[a-f0-9]{32}$/.test(result.selector_digest) ||
    result.selected !== result.unlinked + result.linked)
  throw Error("LIVE Email selector classification shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...result, sourceIdsReturned: false, messageContentReturned: false,
  productionDataWrites: false }));
