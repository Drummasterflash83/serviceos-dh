/** Read-only source-authority diagnosis for the held Drummonds DWD mailbox. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with held as (
 select c.tenant_id,c.email_account_id,c.updated_at,c.revision,a.status account_status,
   m.id mailbox_id,m.status mailbox_status,m.sync_enabled,
   m.directory_identity_conflict,g.id connection_id,g.status connection_status,
   g.last_verified_at
 from public.email_ingestion_checkpoints c
 join public.email_accounts a on a.tenant_id=c.tenant_id
   and a.id=c.email_account_id and a.provider='gmail'
 left join public.google_workspace_mailboxes m on m.tenant_id=a.tenant_id
   and lower(m.email_address)=lower(a.email_address)
 left join public.google_workspace_connections g on g.tenant_id=m.tenant_id
   and g.id=m.connection_id
 where c.tenant_id='${tenant}'::uuid and c.stream='recent'
   and c.state='blocked' and c.block_code='admin_delegation_missing'
)
select jsonb_build_object('heldCount',count(*),
  'cases',coalesce(jsonb_agg(jsonb_build_object(
    'revision',h.revision,'blockAgeSeconds',
      extract(epoch from clock_timestamp()-h.updated_at)::int,
    'accountStatus',h.account_status,'mailboxStatus',h.mailbox_status,
    'syncEnabled',h.sync_enabled,
    'directoryIdentityConflict',h.directory_identity_conflict,
    'connectionStatus',h.connection_status,
    'connectionVerifiedAgeSeconds',
      extract(epoch from clock_timestamp()-h.last_verified_at)::int,
    'sameConnectionSuccessesInTwoHours',
      (select count(*)::int from public.email_sync_runs r
        join public.email_accounts a2 on a2.tenant_id=r.tenant_id
          and a2.id::text=r.metadata->>'email_account_id'
        join public.google_workspace_mailboxes m2 on m2.tenant_id=a2.tenant_id
          and lower(m2.email_address)=lower(a2.email_address)
        where m2.connection_id=h.connection_id
          and r.tenant_id=h.tenant_id and r.sync_type='workspace_messages'
          and r.status='success' and r.completed_at>clock_timestamp()-interval '2 hours'),
    'latestFailureAt',
      (select max(r.completed_at) from public.email_sync_runs r
        where r.tenant_id=h.tenant_id and r.sync_type='workspace_messages'
          and r.status='failed' and r.error_message='admin_delegation_missing'
          and r.metadata->>'email_account_id'=h.email_account_id::text)
    ) order by h.revision),'[]'::jsonb),
  'observedAt',clock_timestamp()) as observation from held h`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`Delegation observation failed (HTTP ${response.status})`);
const rows = await response.json();
const observation = rows?.[0]?.observation;
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(observation?.heldCount) || !Array.isArray(observation?.cases))
  throw Error("Delegation observation shape changed");
console.log(JSON.stringify({ project, ...observation,
  productionDataWrites: false, customerContentReturned: false }));
