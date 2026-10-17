/** Content-free LIVE proof of the first Owner / MD source-job review handoff. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with owner as (
  select m.id, m.profile_id, m.confirmed_at from public.team_members m
  join public.profiles p on p.id=m.profile_id and p.tenant_id=m.tenant_id
  where m.tenant_id='${tenant}'::uuid and m.display_name='Owner / MD'
    and m.effective_to is null
), reviews as (
  select o.id, o.attributes, o.responsible_ref
  from public.intelligence_objects o
  where o.tenant_id='${tenant}'::uuid and o.object_class='action'
    and o.attributes->>'action_type'='openfolk_commusoft_job_review'
    and o.status not in ('complete','cancelled','dismissed')
), accepted as (
  select distinct r.id from reviews r
  join public.object_state_history h on h.tenant_id='${tenant}'::uuid
    and h.object_id=r.id and h.transition_verb='accept'
  join owner m on h.actor->>'user_id'=m.profile_id::text
    and h.actor->>'member_id'=m.id::text and m.confirmed_at is not null
  where coalesce(h.work_before->'responsible_ref','null'::jsonb)='null'::jsonb
    and h.work_after->'responsible_ref'->>'kind'='user'
    and h.work_after->'responsible_ref'->>'ref'=m.profile_id::text
    and r.responsible_ref->>'ref'=m.profile_id::text
    and r.attributes->>'source_connection_id' is not null
    and r.attributes->>'source_version_id' is not null
    and r.attributes->>'job_external_id' is not null
)
select
  (select count(*)::int from owner) owner_login_links,
  (select count(*)::int from owner where confirmed_at is not null) confirmed_owner_links,
  (select count(*)::int from public.controlplane_change_log c join owner m
    on c.resource_id=m.id::text and c.tenant_id='${tenant}'::uuid
    where c.action='controlplane.roster.member_identity_confirm') owner_confirmation_audits,
  (select count(*)::int from reviews) open_source_reviews,
  (select count(*)::int from public.controlplane_change_log c join reviews r
    on c.resource_id=r.id::text and c.tenant_id='${tenant}'::uuid
    where c.action='learn.job_review_action.create') reviewed_source_creation_audits,
  (select count(*)::int from accepted) accepted_owner_source_reviews`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  },
);
if (!response.ok) throw Error(`LIVE owner handoff readback HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
const fields = ["owner_login_links", "confirmed_owner_links", "owner_confirmation_audits",
  "open_source_reviews", "reviewed_source_creation_audits", "accepted_owner_source_reviews"];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
    fields.some((field) => !Number.isSafeInteger(result[field]) || result[field] < 0))
  throw Error("LIVE owner handoff readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  ...result, sourceContentReturned: false, identityReturned: false,
  productionDataWrites: false }));
