begin;set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $test_guard$begin if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or current_setting('serviceos.release_sha256',true) is distinct from 'e79685c57b546c9fde4eb904aee6fc7d8f68865f3d18db065b660848d7614851' then raise exception 'Exact TEST context target/source required';end if;
if (select md5(pg_get_functiondef(oid))='d93bd0eed0f4a1876ae9967b6b86a51e' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_business_input_latest(uuid,uuid,text,text,text)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: learn_business_input_latest';end if;
if (select md5(pg_get_functiondef(oid))='5029bcc91c0f0b5985a7f8dc4fdf5140' and pg_get_userbyid(proowner)='learn_card_communication_reader' and proacl::text is not distinct from '{learn_card_communication_reader=X/learn_card_communication_reader,authenticated=X/learn_card_communication_reader}' from pg_proc where oid='public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure) is not true then raise exception 'TEST prerequisite differs: learn_card_communications_read';end if;
if (select md5(pg_get_functiondef(oid))='3bbe4369a69b2657ffe228fdba4332cd' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' from pg_proc where oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: learn_slack_campaign_job_allowed';end if;
if (select md5(pg_get_functiondef(oid))='f64096149cb752fd4e9f0e47aa6b3774' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: learn_slack_message_kind';end if;
if (select md5(pg_get_functiondef(oid))='aa799b0527a6b378a77f970a6ad4ebe4' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: learn_slack_store_records';end if;
if (select md5(pg_get_functiondef(oid))='1a899d4787d1b5f0d9db0b690562b9af' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' from pg_proc where oid='public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: slack_history_commit_page';end if;
if (select md5(pg_get_functiondef(oid))='5d970b50504644dbad3cb67af63bd30c' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,service_role=X/postgres}' from pg_proc where oid='public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb)'::regprocedure) is not true then raise exception 'TEST prerequisite differs: slack_thread_commit_page';end if;
if (select md5(pg_get_functiondef(oid))='d9c1d8449edf61a95c97976f3a3f222f' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.slack_version_immutable()'::regprocedure) is not true then raise exception 'TEST prerequisite differs: slack_version_immutable';end if;
if to_regclass('public.slack_channel_visibility_receipts') is not null then raise exception 'TEST capture proof storage already exists';end if;
if to_regclass('public.slack_source_visibility_proofs') is not null then raise exception 'TEST capture proof storage already exists';end if;
if to_regprocedure('public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)') is not null then raise exception 'TEST context function already exists';end if;
if to_regprocedure('public.learn_card_slack_job_context(uuid,uuid,uuid)') is not null then raise exception 'TEST context function already exists';end if;
end$test_guard$;


-- Capture-time proof is durable, not a claim about current channel visibility.
-- Only the fenced service worker can atomically attest an actual source page.
create table public.slack_channel_visibility_receipts(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 job_id uuid not null unique references public.platform_jobs(id),
 account_id uuid not null references public.connector_accounts(id),
 claimed_by text not null,attempt_count integer not null check(attempt_count>0),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 team_id text not null,channel_id text not null,
 evidence jsonb not null,evidence_sha256 text not null,
 page_sha256 text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create table public.slack_source_visibility_proofs(
 receipt_id uuid not null references public.slack_channel_visibility_receipts(id),
 version_id uuid not null references public.slack_message_versions(id),
 primary key(receipt_id,version_id)
);
alter table public.slack_channel_visibility_receipts enable row level security;
alter table public.slack_source_visibility_proofs enable row level security;
revoke all on public.slack_channel_visibility_receipts,public.slack_source_visibility_proofs from public,anon,authenticated,service_role;
create trigger slack_channel_visibility_immutable before update or delete on public.slack_channel_visibility_receipts for each row execute function public.slack_version_immutable();
create trigger slack_channel_visibility_no_truncate before truncate on public.slack_channel_visibility_receipts for each statement execute function public.slack_version_immutable();
create trigger slack_source_visibility_immutable before update or delete on public.slack_source_visibility_proofs for each row execute function public.slack_version_immutable();
create trigger slack_source_visibility_no_truncate before truncate on public.slack_source_visibility_proofs for each statement execute function public.slack_version_immutable();
create index slack_source_visibility_version on public.slack_source_visibility_proofs(version_id);

create function public.slack_commit_attested_page(
 p_tenant_id uuid,p_job_id uuid,p_account_id uuid,p_import_id uuid,p_claimed_by text,p_attempt_count integer,
 p_expected jsonb,p_next jsonb,p_records jsonb,p_visibility jsonb
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 cfg jsonb;prior public.slack_channel_visibility_receipts%rowtype;rid uuid;page_hash text;vid uuid;r jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_visibility_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_visibility_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>(case when p_import_id is null then 'slack.history_sync' else 'slack.thread_sync' end)
  or j.payload->>'connector_account_id' is distinct from p_account_id::text
  or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
 then raise exception 'slack_visibility_not_owned' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then raise exception 'slack_visibility_account';end if;
 cfg:=a.settings->'slack_history';
 if p_import_id is not null then
  select scope into cfg from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id and account_id=p_account_id for share;
  if not found or j.payload->>'thread_import_id' is distinct from p_import_id::text then raise exception 'slack_visibility_thread';end if;
 end if;
 select * into c from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id
  and provider='slack' and status='configured' and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'slack_visibility_connection';end if;
 -- Explicit core flags establish public channel scope; optional flags retain null
 -- when Slack omits them. Every affirmative private/DM/shared flag is rejected.
 if jsonb_typeof(p_visibility) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_visibility))<>14
  or not(p_visibility ?& array['version','connection_id','connection_revision','team_id','channel_id','is_channel','is_private','is_im','is_mpim','is_shared','is_ext_shared','is_org_shared','is_pending_ext_shared','pending_shared'])
  or p_visibility->>'version' is distinct from 'slack-capture-visibility/1'
  or p_visibility->>'connection_id' is distinct from c.id::text
  or (p_visibility->>'connection_revision')::timestamptz is distinct from c.updated_at
  or p_visibility->>'team_id' is distinct from cfg->>'teamId' or p_visibility->>'channel_id' is distinct from cfg->>'channelId'
  or p_visibility->'is_channel' is distinct from 'true'::jsonb or p_visibility->'is_private' is distinct from 'false'::jsonb
  or p_visibility->'is_shared' is distinct from 'false'::jsonb or p_visibility->'pending_shared' is distinct from 'false'::jsonb
  or exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
   where p_visibility->f not in('false'::jsonb,'null'::jsonb))
 then raise exception 'slack_visibility_not_public' using errcode='22023';end if;
 page_hash:=encode(sha256(convert_to(jsonb_build_object('expected',p_expected,'next',p_next,'records',p_records)::text,'UTF8')),'hex');
 select * into prior from public.slack_channel_visibility_receipts where job_id=j.id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.account_id<>p_account_id or prior.page_sha256<>page_hash or prior.evidence<>p_visibility
  then raise exception 'slack_visibility_replay_changed' using errcode='PT409';end if;
 else
  -- A legacy committed page cannot be retrospectively attested by a bare RPC.
  -- It must be genuinely fetched again under a newly authorised replay job.
  if j.metadata ? 'slack_page_v1' then raise exception 'slack_visibility_requires_replay' using errcode='PT409';end if;
 end if;
 -- Existing commits retain all scope, request-budget, pause and checkpoint fences.
 if p_import_id is null then
  perform public.slack_history_commit_page(p_tenant_id,p_job_id,p_account_id,p_claimed_by,p_attempt_count,p_expected,p_next,p_records);
 else
  perform public.slack_thread_commit_page(p_tenant_id,p_job_id,p_import_id,p_claimed_by,p_attempt_count,p_expected,p_next,p_records);
 end if;
 if prior.id is not null then return true;end if;
 insert into public.slack_channel_visibility_receipts(tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256)
 values(p_tenant_id,j.id,a.id,p_claimed_by,p_attempt_count,c.id,c.updated_at,cfg->>'teamId',cfg->>'channelId',p_visibility,
  encode(sha256(convert_to(p_visibility::text,'UTF8')),'hex'),page_hash) returning id into rid;
 for r in select value from jsonb_array_elements(p_records) loop
  select v.id into vid from public.slack_message_versions v join public.slack_messages m on m.id=v.message_id and m.tenant_id=v.tenant_id
   where v.tenant_id=p_tenant_id and m.source_external_id=r->>'source_external_id' and m.team_id=cfg->>'teamId' and m.channel_id=cfg->>'channelId'
    and v.source_version=encode(sha256(convert_to((r->'provider_payload')::text,'UTF8')),'hex') and v.provider_payload=r->'provider_payload';
  if not found then raise exception 'slack_visibility_source_missing';end if;
  insert into public.slack_source_visibility_proofs(receipt_id,version_id) values(rid,vid);
 end loop;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_visibility_not_owned' using errcode='PT409';end if;
 return true;
end$$;
revoke all on function public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb) to service_role;

create function public.learn_card_slack_job_context(p_tenant uuid,p_person uuid,p_company uuid)
returns table(interaction_id uuid,context jsonb)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and tenant_id=p_tenant and role in('owner','admin'))
 then raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or (p_person is null and p_company is null) then return;end if;
 return query
 with owned as materialized(
  select j.*,l.connection_id,l.source_version_id,l.external_id provider_job,l.id job_link_id
  from public.jobs j join public.learn_business_input_links l on l.tenant_id=j.tenant_id and l.entity_id=j.id
   and l.entity_kind='job' and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs'
  join public.provider_connections c on c.tenant_id=l.tenant_id and c.id=l.connection_id and c.provider=l.provider
   and c.status='configured' and c.revoked_at is null
  where j.tenant_id=p_tenant and (j.customer_person_id=p_person or j.customer_company_id=p_company)
   and j.source_system='commusoft:connection:'||l.connection_id::text and j.external_id=l.external_id
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
 ), current_jobs as materialized(
  select j.*,cp.id customer_source_version,cl.id customer_link_id,pl.source_version_id property_source_version
  from owned j
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','jobs',j.provider_job)v
   on v.id=j.source_version_id and v.payload->>'id'=j.provider_job and jsonb_typeof(v.payload->'id')='number'
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',v.payload->>'propertyID')p
   on p.id is not null and jsonb_typeof(v.payload->'propertyID')='number'
   and p.payload->>'id'=v.payload->>'propertyID' and jsonb_typeof(p.payload->'id')='number'
   and j.metadata#>>'{learn_business_input,property_external_id}'=v.payload->>'propertyID'
  join public.learn_business_input_links pl on pl.tenant_id=p_tenant and pl.connection_id=j.connection_id
   and pl.provider='commusoft' and pl.collection='properties' and pl.external_id=p.external_id and pl.source_version_id=p.id
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',
   case p.payload->>'type' when 'customer' then p.external_id when 'workaddress' then p.payload->>'parentPropertyID' end)cp
   on cp.id is not null and cp.payload->>'type'='customer' and cp.payload->>'id'=cp.external_id and jsonb_typeof(cp.payload->'id')='number'
  join public.learn_business_input_links cl on cl.tenant_id=p_tenant and cl.connection_id=j.connection_id
   and cl.provider='commusoft' and cl.collection='properties' and cl.external_id=cp.external_id and cl.source_version_id=cp.id and cl.entity_kind='customer'
  join public.customer_cards card on card.tenant_id=p_tenant and card.id=cl.card_id
   and ((cl.entity_table='people' and card.person_id=cl.entity_id) or (cl.entity_table='companies' and card.person_id is null and card.company_id=cl.entity_id))
  where j.customer_person_id is not distinct from case when cl.entity_table='people' then cl.entity_id end
   and j.customer_company_id is not distinct from case when cl.entity_table='companies' then cl.entity_id end
   and ((cl.entity_table='people' and exists(select 1 from public.people where tenant_id=p_tenant and id=cl.entity_id))
    or (cl.entity_table='companies' and exists(select 1 from public.companies where tenant_id=p_tenant and id=cl.entity_id)))
   and ((p.payload->>'type'='customer' and j.site_id is null and pl.id=cl.id)
    or (p.payload->>'type'='workaddress' and pl.entity_kind='site' and pl.entity_table='sites' and pl.entity_id=j.site_id
     and jsonb_typeof(p.payload->'parentPropertyID')='number' and p.payload->>'parentPropertyID'=cp.external_id
     and exists(select 1 from public.sites site where site.tenant_id=p_tenant and site.id=j.site_id
      and site.person_id is not distinct from j.customer_person_id and site.company_id is not distinct from j.customer_company_id
      and site.metadata#>>'{learn_business_input,connection_id}'=j.connection_id::text
      and site.metadata#>>'{learn_business_input,source_version_id}'=p.id::text)))
 )
 select i.id,jsonb_build_object('version','learn-customer-job-context/1','kind','reviewed_slack_job',
  'job_id',j.id,'person_id',j.customer_person_id,'company_id',j.customer_company_id,
  'review_request_id',r.request_id,'source_version',s.source_version,'job_source_version_id',j.source_version_id,
  'property_source_version_id',j.property_source_version,'customer_source_version_id',j.customer_source_version)
 from public.interactions i
 join current_jobs j on j.tenant_id=i.tenant_id and j.id=i.related_job_id
 join public.slack_messages s on s.tenant_id=i.tenant_id and s.id=i.source_id and s.source_version=i.metadata->>'source_version'
 join public.learn_slack_context_reviews r on r.tenant_id=i.tenant_id and r.interaction_id=i.id
  and r.request_id::text=i.metadata#>>'{work_context,request_id}' and r.receipt->>'state'='committed'
  and r.receipt->'context'=i.metadata->'work_context' and r.definition->>'job_id'=j.id::text
 where i.tenant_id=p_tenant and i.source_table='slack_messages' and i.source_connector_id='slack'
  and i.interaction_type='slack_message' and i.processing_status='enriched' and coalesce(i.status,'') not in('deleted','removed')
  and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
  and i.metadata#>>'{work_context,state}'='reviewed' and i.metadata#>>'{work_context,scope}'='job'
  and i.metadata#>>'{work_context,source_version}'=s.source_version and i.metadata#>>'{work_context,job_id}'=j.id::text
  and public.learn_slack_message_kind(s.provider_payload)='conversation'
  and exists(select 1 from public.slack_message_versions version
   join public.slack_source_visibility_proofs proof on proof.version_id=version.id
   join public.slack_channel_visibility_receipts visibility on visibility.id=proof.receipt_id and visibility.tenant_id=version.tenant_id
   join public.provider_connections slack_connection on slack_connection.id=visibility.connection_id and slack_connection.tenant_id=visibility.tenant_id
    and slack_connection.provider='slack' and slack_connection.status='configured' and slack_connection.revoked_at is null
    and slack_connection.non_secret_config->>'team_id'=visibility.team_id
   where version.tenant_id=s.tenant_id and version.message_id=s.id and version.source_version=s.source_version and version.provider_payload=s.provider_payload
    and visibility.team_id=s.team_id and visibility.channel_id=s.channel_id
    and visibility.evidence->>'version'='slack-capture-visibility/1'
    and visibility.evidence->'is_channel'='true'::jsonb and visibility.evidence->'is_private'='false'::jsonb
    and visibility.evidence->'is_shared'='false'::jsonb and visibility.evidence->'pending_shared'='false'::jsonb
    and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
     where visibility.evidence->f not in('false'::jsonb,'null'::jsonb)))
 order by i.occurred_at desc nulls last,i.id limit 51;
end$$;
revoke all on function public.learn_card_slack_job_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_slack_job_context(uuid,uuid,uuid) to learn_card_communication_reader;

-- Use the deployer's existing ADMIN OPTION for this transaction only.
-- The original supabase_admin grant remains untouched; remove only our own grant.
create temporary table slack_context_role_baseline on commit drop as
select (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members) as memberships;
do $role_guard$begin
 if current_user<>'postgres' or (select rolsuper from pg_roles where rolname=current_user)
 or not has_schema_privilege(current_user,'public','CREATE')
 or (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members where roleid='learn_card_communication_reader'::regrole) is distinct from '[{"role": "learn_card_communication_reader", "member": "postgres", "grantor": "supabase_admin", "admin": true, "inherit": false, "set": false}]'::jsonb
 then raise exception 'Exact restricted-reader maintenance authority required';end if;
end$role_guard$;
grant learn_card_communication_reader to postgres with admin false,inherit true,set false granted by postgres;

-- Preserve existing reader ownership/grants and all direct-scope/draft filters.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure);
 needle:='i.status,i.related_person_id,i.related_company_id,i.related_job_id';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed communication projection differs';end if;
 d:=replace(d,needle,needle||',jc.context as job_context');
 needle:='from public.interactions i where';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed communication source differs';end if;
 d:=replace(d,needle,'from public.interactions i left join public.learn_card_slack_job_context(p_tenant,p_person,p_company) jc on jc.interaction_id=i.id where');
 needle:='i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed communication scope differs';end if;
 d:=replace(d,needle,needle||' or jc.interaction_id is not null');
 execute d;
end$$;
revoke learn_card_communication_reader from postgres granted by postgres;
do $role_restore$begin
 if (select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members) is distinct from (select memberships from slack_context_role_baseline)
 or pg_has_role('postgres','learn_card_communication_reader','USAGE')
 or pg_has_role('postgres','learn_card_communication_reader','SET')
 then raise exception 'Restricted-reader maintenance authority not restored';end if;
end$role_restore$;
notify pgrst,'reload schema';
-- Candidate only: exclude jobs that cannot contribute reviewed Slack context
-- before evaluating their current provider versions. Final evidence, visibility,
-- ownership and source-version checks remain intact.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure);
 needle:='where j.tenant_id=p_tenant and (j.customer_person_id=p_person or j.customer_company_id=p_company)';
 replacement:=needle||$filter$
   and exists (
    select 1 from public.interactions scoped_i
    join public.learn_slack_context_reviews scoped_r on scoped_r.tenant_id=scoped_i.tenant_id
     and scoped_r.interaction_id=scoped_i.id and scoped_r.receipt->>'state'='committed'
    where scoped_i.tenant_id=j.tenant_id and scoped_i.related_job_id=j.id
     and scoped_i.source_table='slack_messages' and scoped_i.source_connector_id='slack'
   )$filter$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed customer-context baseline differs';end if;
 execute replace(d,needle,replacement);
end$$;

commit;
