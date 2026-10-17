/** Counts-only LIVE readiness for a human-assigned OpenFolk job review. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select
  (select count(*)::int from public.team_members m
    where m.tenant_id='${tenant}'::uuid and m.effective_to is null) active_members,
  (select count(*)::int from public.team_members m
    where m.tenant_id='${tenant}'::uuid and m.effective_to is null
      and m.confirmed_at is not null)
    confirmed_members,
  (select count(*)::int from public.team_members m
    where m.tenant_id='${tenant}'::uuid and m.effective_to is null
      and m.confirmed_at is not null
      and m.profile_id is not null) confirmed_signed_in_members,
  (select count(distinct g.member_id)::int from public.authority_grants g
    join public.team_members m on m.id=g.member_id and m.tenant_id=g.tenant_id
    where g.tenant_id='${tenant}'::uuid and g.permission='work.assign'
      and g.confirmed and g.effective_from<=clock_timestamp()
      and (g.effective_to is null or g.effective_to>clock_timestamp())
      and m.effective_to is null and m.profile_id is not null)
    signed_in_assigners,
  (select count(*)::int from public.intelligence_objects o
    where o.tenant_id='${tenant}'::uuid and o.object_class='action'
      and o.source_entities<>'{}'::uuid[]
      and o.status not in ('complete','cancelled')) source_linked_active_actions`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE job handoff readiness HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
    ["active_members", "confirmed_members", "confirmed_signed_in_members",
      "signed_in_assigners", "source_linked_active_actions"].some(key =>
      !Number.isSafeInteger(result[key]) || result[key] < 0))
  throw Error("LIVE job handoff readiness shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...result, memberIdsReturned: false, sourceContentReturned: false,
  productionDataWrites: false }));
