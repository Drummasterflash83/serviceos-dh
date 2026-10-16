-- A fixed account-level boundary applies only to full Gmail inventory pages.
-- Incremental history remains unfiltered, and retained messages are untouched.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.email_accounts
  add column full_import_after_at timestamptz;
alter table public.email_accounts
  add constraint email_accounts_full_import_after_range
  check (full_import_after_at is null or
    (full_import_after_at >= '2000-01-01'::timestamptz and
     full_import_after_at < '2100-01-01'::timestamptz));
grant select(full_import_after_at) on public.email_accounts
  to email_ingestion_protocol_owner;

do $migration$
declare
  signature regprocedure := 'public.email_ingestion_payload_v2(text,text,jsonb)'::regprocedure;
  body text;
  old_check constant text := 'or v->''query''<>''null''::jsonb or';
  new_check constant text := $new$or (v->'query'<>'null'::jsonb and
      (jsonb_typeof(v->'query')<>'string' or
       not coalesce(v->>'query'~'^after:[1-9][0-9]{9}$',false))) or$new$;
begin
  select pg_get_functiondef(signature) into body;
  if body is null or
    length(body)-length(replace(body,old_check,''))<>length(old_check)
  then raise exception 'email_horizon_payload_definition_changed'; end if;
  execute replace(body,old_check,new_check);
end $migration$;

do $migration$
declare
  signature regprocedure := 'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure;
  body text;
  old_select constant text := 'backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error';
  new_select constant text := 'backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error,full_import_after_at';
  old_mode constant text := $old$mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;$old$;
  new_mode constant text := $new$mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;
       if mode='reconcile' then
         if a.full_import_after_at is null and p_payload->'query'<>'null'::jsonb then
           raise exception using errcode='P0001',message='checkpoint_conflict';
         end if;
         if a.full_import_after_at is not null and p_payload->>'query' is distinct from
           ('after:'||floor(extract(epoch from a.full_import_after_at))::bigint::text) then
           raise exception using errcode='P0001',message='checkpoint_conflict';
         end if;
       end if;$new$;
  old_query constant text := '''page_size'',p_payload->''page_size'',''query'',null,';
  new_query constant text := '''page_size'',p_payload->''page_size'',''query'',case when mode=''history'' then null else p_payload->''query'' end,';
begin
  select pg_get_functiondef(p.oid) into strict body from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid=signature and p.prosecdef
      and pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
      and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}';
  if length(body)-length(replace(body,old_select,''))<>length(old_select)
    or length(body)-length(replace(body,old_mode,''))<>length(old_mode)
    or length(body)-length(replace(body,old_query,''))<>length(old_query)
  then raise exception 'email_horizon_transition_definition_changed'; end if;
  body:=replace(replace(replace(body,old_select,new_select),old_mode,new_mode),old_query,new_query);
  execute body;
  if (select pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
       and p.prosecdef and
       p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}'
       from pg_proc p where p.oid=signature) is distinct from true
  then raise exception 'email_horizon_transition_privileges_changed'; end if;
end $migration$;
commit;
