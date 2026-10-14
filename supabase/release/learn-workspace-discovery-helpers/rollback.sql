-- Exact prior functions. Reintroduces the known discovery failure; emergency rollback only.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $guard$ begin
 if md5(pg_get_functiondef('public.marketing_sender_readiness(uuid,uuid)'::regprocedure)) not in ('a035325bc8634f1e886999918c0180f5','9db6f5a8603e00f61bb090ec27523098') then raise exception 'Workspace discovery helper baseline differs';end if;
 if exists(select 1 from pg_proc where oid='public.marketing_sender_readiness(uuid,uuid)'::regprocedure and (pg_get_userbyid(proowner) is distinct from 'postgres' or prosecdef or proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}')) then raise exception 'Workspace discovery helper authority differs';end if;
 if md5(pg_get_functiondef('public.marketing_sender_authority_state(uuid,text,text)'::regprocedure)) not in ('b2cf1cebab17860e73fd6d9e760fc7c9','23fc3f0c0b1f5573c4cc8ef8f449fb27') then raise exception 'Workspace discovery helper baseline differs';end if;
 if exists(select 1 from pg_proc where oid='public.marketing_sender_authority_state(uuid,text,text)'::regprocedure and (pg_get_userbyid(proowner) is distinct from 'postgres' or prosecdef or proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}')) then raise exception 'Workspace discovery helper authority differs';end if;
end $guard$;
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
commit;
