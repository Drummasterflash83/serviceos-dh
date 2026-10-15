-- An ordinary scheduled claim may retry only the exact held Workspace mailbox
-- whose current revision has a recent, audited, successful read-only profile.
-- A changed hold, source binding, later failed probe or absent audit stays held.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if to_regprocedure('public.learn_email_recent_profile_proof(uuid,uuid,uuid,bigint)') is not null
 then raise exception 'mailbox_profile_proof_already_exists'; end if;
end $preflight$;

create function public.learn_email_recent_profile_proof(
  p_tenant uuid,p_account uuid,p_generation uuid,p_revision bigint)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 with latest as (
   select r.id,r.tenant_id,r.resource_id,r.status,r.detail,r.created_at
   from public.audit_logs r
   where r.tenant_id=p_tenant and r.resource_type='email_account'
     and r.resource_id=p_account::text
     and r.action='learn.email.mailbox_source_probe_result'
   order by r.created_at desc,r.id desc limit 1
 )
 select exists(
   select 1 from latest r
   join public.audit_logs q on q.id::text=r.detail->>'request_audit_id'
   join public.email_accounts a on a.tenant_id=p_tenant and a.id=p_account
   join public.google_workspace_mailboxes m on m.tenant_id=p_tenant
     and lower(m.email_address)=lower(a.email_address)
   join public.google_workspace_connections c on c.tenant_id=p_tenant
     and c.id=m.connection_id
   where r.status='success' and r.detail->>'code'='provider_verified'
     and r.detail->>'checkpoint_generation'=p_generation::text
     and r.detail->>'checkpoint_revision'=p_revision::text
     and r.detail->>'mailbox_content_read'='false'
     and r.created_at>=clock_timestamp()-interval '1 hour'
     and r.created_at<=clock_timestamp()+interval '5 seconds'
     and q.tenant_id=p_tenant and q.resource_type='email_account'
     and q.resource_id=p_account::text
     and q.action='learn.email.mailbox_source_probe' and q.status='requested'
     and q.detail->>'checkpoint_generation'=p_generation::text
     and q.detail->>'checkpoint_revision'=p_revision::text
     and q.detail->>'provider_scope'='gmail.readonly'
     and q.detail->>'mailbox_content_read'='false'
     and q.created_at<=r.created_at
     and q.created_at>=clock_timestamp()-interval '1 hour'
     and a.provider='gmail' and a.status='active_dwd'
     and m.status='active' and m.sync_enabled=true
     and m.mailbox_type<>'suspended'
     and m.directory_identity_conflict=false
     and c.status='active'
     and lower(c.domain)=split_part(lower(a.email_address),'@',2)
 );
$$;
revoke all on function public.learn_email_recent_profile_proof(uuid,uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.learn_email_recent_profile_proof(uuid,uuid,uuid,bigint)
  to email_ingestion_protocol_owner;

do $migration$
declare
 signature regprocedure := 'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure;
 body text;
 old_vars constant text := 'v_fetch_policy text; v_force boolean; v_auto_resume boolean:=false;';
 old_guard constant text := $old$then raise exception using errcode='P0001',message='explicit_recovery_required'; end if;
           v_auto_resume:=true;$old$;
 new_guard constant text := $new$then
             if not (p_stream='recent' and attempt.sync_type='workspace_messages'
               and c.block_code='admin_delegation_missing'
               and c.owner_attempt_id is null and a.status='active_dwd'
               and public.learn_email_recent_profile_proof(
                 p_tenant_id,p_email_account_id,c.generation,c.revision))
             then raise exception using errcode='P0001',message='explicit_recovery_required'; end if;
             v_profile_resume:=true;
           end if;
           v_auto_resume:=true;$new$;
 old_marker constant text := '''automatic_recovery'',case when v_auto_resume then ''confirmed_zero_write_fetch_retry'' else null end);';
 new_marker constant text := '''automatic_recovery'',case when v_profile_resume then ''confirmed_mailbox_profile_recovery'' when v_auto_resume then ''confirmed_zero_write_fetch_retry'' else null end);';
begin
 select pg_get_functiondef(p.oid) into strict body from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.oid=signature and p.prosecdef
     and pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
     and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}';
 if md5(body)<>'1b978429b0f1ee916b545f5c56953739'
   or length(body)-length(replace(body,old_vars,''))<>length(old_vars)
   or length(body)-length(replace(body,old_guard,''))<>length(old_guard)
   or length(body)-length(replace(body,old_marker,''))<>length(old_marker)
 then raise exception 'email_profile_claim_definition_changed'; end if;
 body:=replace(body,old_vars,
   'v_fetch_policy text; v_force boolean; v_auto_resume boolean:=false; v_profile_resume boolean:=false;');
 body:=replace(body,old_guard,new_guard);
 body:=replace(body,old_marker,new_marker);
 execute body;
 if (select pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
       and p.prosecdef and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}'
       from pg_proc p where p.oid=signature) is distinct from true
 then raise exception 'email_profile_claim_privileges_changed'; end if;
end $migration$;
commit;
