-- A third zero-write fetch failure remains blocked for review even after its
-- rolling two-hour window expires. Compare the failure count at block time.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
  signature regprocedure := 'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure;
  body text;
  old_guard constant text := $old$and prior.metadata#>>'{email_ingestion_v2,evidence,gone_count}'='0'
                 and prior_transition.accepted_result->>'checkpoint_state'='blocked'$old$;
  new_guard constant text := $new$and prior.metadata#>>'{email_ingestion_v2,evidence,gone_count}'='0'
                 and (select count(*) from public.email_sync_runs at_block
                   where at_block.tenant_id=prior.tenant_id
                     and at_block.provider='gmail'
                     and at_block.sync_type='workspace_messages'
                     and at_block.status='failed'
                     and at_block.error_message='fetch_failed'
                     and at_block.metadata->>'email_account_id'=p_email_account_id::text
                     and at_block.completed_at>prior.completed_at-interval '2 hours'
                     and at_block.completed_at<=prior.completed_at)<3
                 and prior_transition.accepted_result->>'checkpoint_state'='blocked'$new$;
begin
  select pg_get_functiondef(p.oid) into strict body from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid=signature
      and p.prosecdef and pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
      and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}';
  if md5(body)<>'9828de434ae0713dfd544da6ce0a1345'
    or length(body)-length(replace(body,old_guard,''))<>length(old_guard)
  then raise exception 'email_safe_claim_window_definition_changed'; end if;
  execute replace(body,old_guard,new_guard);
  if (select pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
       and p.prosecdef
       and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}'
       from pg_proc p where p.oid=signature) is distinct from true
  then raise exception 'email_safe_claim_window_privileges_changed'; end if;
end $migration$;
commit;
