set local plpgsql.check_asserts=on;
-- Synthetic-only sender states and real trigger chain inside a rolled-back offline restore.
insert into public.tenants(id,display_name,slug) values
 ('ae430001-aaaa-4000-8000-000000000001','Discovery fixture','discovery-fixture'),
 ('ae430001-aaaa-4000-8000-000000000002','Other fixture','discovery-other');
insert into public.google_workspace_connections(id,tenant_id,domain,status) values
 ('ae430001-aaaa-4000-8000-000000000011','ae430001-aaaa-4000-8000-000000000001','discovery.example.invalid','active');
insert into public.google_workspace_mailboxes(id,tenant_id,connection_id,email_address,status,sync_enabled) values
 ('ae430001-aaaa-4000-8000-000000000021','ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000011','absent@discovery.example.invalid','active',false),
 ('ae430001-aaaa-4000-8000-000000000022','ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000011','present@discovery.example.invalid','active',true);
insert into public.marketing_sender_profiles(id,tenant_id,source_kind,mailbox_address,enabled) values
 ('ae430001-aaaa-4000-8000-000000000031','ae430001-aaaa-4000-8000-000000000001','resend','notice@discovery.example.invalid',true),
 ('ae430001-aaaa-4000-8000-000000000032','ae430001-aaaa-4000-8000-000000000001','resend','onboarding@resend.dev',false);
-- Must still default-deny unverified exact identity, cross-tenant and lookalike inputs.
set local role service_role;
set local search_path=pg_catalog;
do $test$ declare r jsonb;begin
 r:=public.marketing_sender_readiness('ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000031');
 assert r->>'state'='unavailable' and r->'ready'='false' and r->'campaigns_blocked'='true';
 r:=public.marketing_sender_readiness('ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000032');
 assert r->>'state'='sandbox_ready' and r->'test_to_self_only'='true' and r->'campaigns_blocked'='true';
 assert public.marketing_sender_authority_state(null,'resend','notice@discovery.example.invalid')='none';
 assert public.marketing_sender_authority_state('ae430001-aaaa-4000-8000-000000000001','resend',E'bad\n@discovery.example.invalid')='none';
 begin perform public.marketing_sender_readiness('ae430001-aaaa-4000-8000-000000000002','ae430001-aaaa-4000-8000-000000000031');raise exception 'Cross-tenant read accepted';exception when no_data_found then null;end;
end $test$;
reset role;
set local search_path=public,pg_catalog;
set local search_path=public,pg_catalog;
insert into public.marketing_sender_authorities(tenant_id,transport,sender_address,domain,state,verified_at,granted_by,request_id) values
 ('ae430001-aaaa-4000-8000-000000000001','resend','notice@discovery.example.invalid','discovery.example.invalid','verified',now(),'synthetic-fixture','discovery-fixture-0001');
set local role service_role;
set local search_path=pg_catalog;
do $test$ declare r jsonb;begin
 assert public.marketing_sender_authority_state('ae430001-aaaa-4000-8000-000000000001','resend',' NOTICE@DISCOVERY.EXAMPLE.INVALID ')='verified';
 assert public.marketing_sender_authority_state('ae430001-aaaa-4000-8000-000000000002','resend','notice@discovery.example.invalid')='none';
 assert public.marketing_sender_authority_state('ae430001-aaaa-4000-8000-000000000001','resend','notice@sub.discovery.example.invalid')='none';
 r:=public.marketing_sender_readiness('ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000031');
 assert r->>'state'='ready' and r->'ready'='true' and r->'authority_state'='"verified"';
end $test$;
reset role;
set local search_path=public,pg_catalog;
update public.marketing_sender_authorities set state='revoked',revoked_at=now() where tenant_id='ae430001-aaaa-4000-8000-000000000001';
CREATE OR REPLACE FUNCTION public.marketing_sender_readiness(p_tenant uuid, p_sender uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_p public.marketing_sender_profiles%rowtype;
  v_acc public.email_accounts%rowtype;
  v_scope text;
  v_has_token boolean;
  v_mbx public.google_workspace_mailboxes%rowtype;
  v_conn public.google_workspace_connections%rowtype;
  v_state text;
  v_auth text;
begin
  if p_tenant is null or p_sender is null then
    raise exception 'tenant and sender required' using errcode = '22023';
  end if;
  select * into v_p from public.marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  if v_p.source_kind = 'resend' then
    if v_p.mailbox_address = 'onboarding@resend.dev' then
      v_state := 'sandbox_ready';
    else
      -- DEFAULT DENY: only an exactly-matching ACTIVE authority is usable
      v_auth := marketing_sender_authority_state(p_tenant, 'resend', v_p.mailbox_address);
      v_state := case v_auth
                   when 'verified' then 'ready'
                   when 'revoked'  then 'revoked'
                   else 'unavailable'
                 end;
    end if;
  elsif v_p.source_kind = 'gmail_oauth' then
    if v_p.email_account_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_acc from public.email_accounts
       where id = v_p.email_account_id and tenant_id = p_tenant and provider = 'gmail';
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_acc.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_acc.status <> 'active' then
        v_state := 'source_inactive';
      elsif v_acc.auth_state is distinct from 'ok' then
        v_state := 'auth_invalid';
      else
        select t.access_token is not null, t.scope
          into v_has_token, v_scope
          from public.email_oauth_tokens t
         where t.email_account_id = v_acc.id and t.tenant_id = p_tenant;
        if not found or not coalesce(v_has_token, false) then
          v_state := 'token_missing';
        elsif not public.marketing_scope_has(v_scope,
                    'https://www.googleapis.com/auth/gmail.send') then
          v_state := 'send_scope_missing';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  else
    if v_p.workspace_mailbox_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_mbx from public.google_workspace_mailboxes
       where id = v_p.workspace_mailbox_id and tenant_id = p_tenant;
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_mbx.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_mbx.status <> 'active' then
        v_state := 'source_inactive';
      else
        select * into v_conn from public.google_workspace_connections
         where id = v_mbx.connection_id and tenant_id = p_tenant;
        if not found or v_conn.status <> 'active' then
          v_state := 'connection_inactive';
        elsif v_p.send_scope_state <> 'authorized' then
          v_state := 'send_scope_unverified';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'sender_id', v_p.id,
    'ready', v_state in ('ready', 'sandbox_ready'),
    'sandbox', v_state = 'sandbox_ready',
    'state', v_state,
    'enabled', v_p.enabled,
    'test_to_self_only', v_state = 'sandbox_ready',
    -- only a genuinely production-ready sender may carry bulk work
    'campaigns_blocked', v_state <> 'ready',
    'sequences_blocked', v_state <> 'ready',
    -- true once a real provider submission has been proven for this class
    'provider_submission_verified', v_state = 'ready',
    'authority_state', case when v_p.source_kind = 'resend'
                              and v_p.mailbox_address <> 'onboarding@resend.dev'
                            then coalesce(v_auth, 'none') else null end,
    'transport', case when v_p.source_kind = 'resend' then 'resend' else 'gmail' end);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_sender_authority_state(p_tenant uuid, p_transport text, p_address text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare v_addr text; v_state text;
begin
  if p_tenant is null or p_transport is null then return 'none'; end if;
  v_addr := marketing_normalise_email(p_address);
  if v_addr is null then return 'none'; end if;          -- untrustworthy input
  select a.state into v_state from marketing_sender_authorities a
   where a.tenant_id = p_tenant
     and a.transport = p_transport
     and a.sender_address = v_addr;                       -- EXACT equality only
  return coalesce(v_state, 'none');
end $function$;

set local role service_role;
set local search_path=pg_catalog;
do $repro$ begin
 begin
  update public.google_workspace_mailboxes set status='removed' where id='ae430001-aaaa-4000-8000-000000000021';
  raise exception 'Expected original dependency failure';
 exception when undefined_function then assert sqlerrm='function marketing_sender_authority_state(uuid, unknown, text) does not exist';end;
 assert (select status from public.google_workspace_mailboxes where id='ae430001-aaaa-4000-8000-000000000021')='active';
end $repro$;
reset role;
set local search_path=public,pg_catalog;
CREATE OR REPLACE FUNCTION public.marketing_sender_readiness(p_tenant uuid, p_sender uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_p public.marketing_sender_profiles%rowtype;
  v_acc public.email_accounts%rowtype;
  v_scope text;
  v_has_token boolean;
  v_mbx public.google_workspace_mailboxes%rowtype;
  v_conn public.google_workspace_connections%rowtype;
  v_state text;
  v_auth text;
begin
  if p_tenant is null or p_sender is null then
    raise exception 'tenant and sender required' using errcode = '22023';
  end if;
  select * into v_p from public.marketing_sender_profiles
   where id = p_sender and tenant_id = p_tenant;
  if not found then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;

  if v_p.source_kind = 'resend' then
    if v_p.mailbox_address = 'onboarding@resend.dev' then
      v_state := 'sandbox_ready';
    else
      -- DEFAULT DENY: only an exactly-matching ACTIVE authority is usable
      v_auth := public.marketing_sender_authority_state(p_tenant, 'resend', v_p.mailbox_address);
      v_state := case v_auth
                   when 'verified' then 'ready'
                   when 'revoked'  then 'revoked'
                   else 'unavailable'
                 end;
    end if;
  elsif v_p.source_kind = 'gmail_oauth' then
    if v_p.email_account_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_acc from public.email_accounts
       where id = v_p.email_account_id and tenant_id = p_tenant and provider = 'gmail';
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_acc.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_acc.status <> 'active' then
        v_state := 'source_inactive';
      elsif v_acc.auth_state is distinct from 'ok' then
        v_state := 'auth_invalid';
      else
        select t.access_token is not null, t.scope
          into v_has_token, v_scope
          from public.email_oauth_tokens t
         where t.email_account_id = v_acc.id and t.tenant_id = p_tenant;
        if not found or not coalesce(v_has_token, false) then
          v_state := 'token_missing';
        elsif not public.marketing_scope_has(v_scope,
                    'https://www.googleapis.com/auth/gmail.send') then
          v_state := 'send_scope_missing';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  else
    if v_p.workspace_mailbox_id is null then
      v_state := 'source_disconnected';
    else
      select * into v_mbx from public.google_workspace_mailboxes
       where id = v_p.workspace_mailbox_id and tenant_id = p_tenant;
      if not found then
        v_state := 'source_disconnected';
      elsif lower(coalesce(v_mbx.email_address, '')) <> v_p.mailbox_address then
        v_state := 'source_changed';
      elsif v_mbx.status <> 'active' then
        v_state := 'source_inactive';
      else
        select * into v_conn from public.google_workspace_connections
         where id = v_mbx.connection_id and tenant_id = p_tenant;
        if not found or v_conn.status <> 'active' then
          v_state := 'connection_inactive';
        elsif v_p.send_scope_state <> 'authorized' then
          v_state := 'send_scope_unverified';
        else
          v_state := 'ready';
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'sender_id', v_p.id,
    'ready', v_state in ('ready', 'sandbox_ready'),
    'sandbox', v_state = 'sandbox_ready',
    'state', v_state,
    'enabled', v_p.enabled,
    'test_to_self_only', v_state = 'sandbox_ready',
    -- only a genuinely production-ready sender may carry bulk work
    'campaigns_blocked', v_state <> 'ready',
    'sequences_blocked', v_state <> 'ready',
    -- true once a real provider submission has been proven for this class
    'provider_submission_verified', v_state = 'ready',
    'authority_state', case when v_p.source_kind = 'resend'
                              and v_p.mailbox_address <> 'onboarding@resend.dev'
                            then coalesce(v_auth, 'none') else null end,
    'transport', case when v_p.source_kind = 'resend' then 'resend' else 'gmail' end);
end $function$;

CREATE OR REPLACE FUNCTION public.marketing_sender_authority_state(p_tenant uuid, p_transport text, p_address text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare v_addr text; v_state text;
begin
  if p_tenant is null or p_transport is null then return 'none'; end if;
  v_addr := public.marketing_normalise_email(p_address);
  if v_addr is null then return 'none'; end if;          -- untrustworthy input
  select a.state into v_state from public.marketing_sender_authorities a
   where a.tenant_id = p_tenant
     and a.transport = p_transport
     and a.sender_address = v_addr;                       -- EXACT equality only
  return coalesce(v_state, 'none');
end $function$;

set local role service_role;
set local search_path=pg_catalog;
do $test$ declare r jsonb;n int;begin
 r:=public.marketing_sender_readiness('ae430001-aaaa-4000-8000-000000000001','ae430001-aaaa-4000-8000-000000000031');
 assert r->>'state'='revoked' and r->'ready'='false' and r->'campaigns_blocked'='true';
 update public.google_workspace_mailboxes set status='removed' where tenant_id='ae430001-aaaa-4000-8000-000000000001' and connection_id='ae430001-aaaa-4000-8000-000000000011' and email_address='absent@discovery.example.invalid' and status<>'removed';
 get diagnostics n=row_count;assert n=1;
 assert (select not sync_enabled and status='removed' from public.google_workspace_mailboxes where id='ae430001-aaaa-4000-8000-000000000021');
 assert (select sync_enabled and status='active' from public.google_workspace_mailboxes where id='ae430001-aaaa-4000-8000-000000000022');
 assert not exists(select 1 from public.tenant_connector_capabilities where tenant_id='ae430001-aaaa-4000-8000-000000000001' and capability_key='email.send_marketing' and enabled);
 update public.google_workspace_mailboxes set status='removed' where id='ae430001-aaaa-4000-8000-000000000021' and status<>'removed';get diagnostics n=row_count;assert n=0;
 assert not has_function_privilege('authenticated','public.marketing_sender_readiness(uuid,uuid)','execute');
 assert not has_function_privilege('anon','public.marketing_sender_authority_state(uuid,text,text)','execute');
end $test$;
reset role;
set local search_path=public,pg_catalog;
