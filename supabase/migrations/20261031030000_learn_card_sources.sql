-- Bounded original-source excerpts/metadata for company card review. No source writes.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$ begin
 if not exists(select 1 from pg_roles where rolname='learn_card_communication_reader' and not rolcanlogin and not rolinherit and not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication)
 or not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='learn_card_communication_profile') then
  raise exception 'Restricted company communication reader prerequisite required';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','email_messages','phone_calls','phone_recordings') and c.relrowsecurity)<>4 then
  raise exception 'Existing caller-profile and source RLS required';end if;
end $$;
do $$ begin execute format('grant learn_card_communication_reader to %I with inherit false, set true',current_user);end $$;
grant create on schema public to learn_card_communication_reader;
grant select(id,tenant_id,subject,snippet,sent_at,received_at,direction) on public.email_messages to learn_card_communication_reader;
grant select(id,tenant_id,provider,direction,started_at,duration_seconds,outcome) on public.phone_calls to learn_card_communication_reader;
grant select(id,tenant_id,provider,started_at,duration_seconds) on public.phone_recordings to learn_card_communication_reader;
create policy learn_card_email_source_read on public.email_messages for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_card_call_source_read on public.phone_calls for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create policy learn_card_recording_source_read on public.phone_recordings for select to learn_card_communication_reader
 using(tenant_id in(select p.tenant_id from public.profiles p where p.role in ('owner','admin')));
create function public.learn_card_source_read(p_tenant uuid,p_table text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- Profile RLS exposes only the actual caller. The reader has no auth-schema access.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin source access required' using errcode='42501';end if;
 if p_tenant is null or p_id is null or p_table is null or p_table not in ('email_messages','phone_calls','phone_recordings') then
  raise exception 'One supported source reference required' using errcode='22023';end if;
 if p_table='email_messages' then
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(subject)>4000 then left(subject,4000)||'… [excerpt shortened]' else subject end as subject,
    case when length(snippet)>4000 then left(snippet,4000)||'… [excerpt shortened]' else snippet end as snippet,
    sent_at,received_at,case when length(direction)>4000 then left(direction,4000)||'… [excerpt shortened]' else direction end as direction
   from public.email_messages where tenant_id=p_tenant and id=p_id
  ) s;
 elsif p_table='phone_calls' then
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(provider)>4000 then left(provider,4000)||'… [excerpt shortened]' else provider end as provider,
    case when length(direction)>4000 then left(direction,4000)||'… [excerpt shortened]' else direction end as direction,
    started_at,duration_seconds,
    case when length(outcome)>4000 then left(outcome,4000)||'… [excerpt shortened]' else outcome end as outcome
   from public.phone_calls where tenant_id=p_tenant and id=p_id
  ) s;
 else
  select to_jsonb(s) into result from (
   select id,tenant_id,
    case when length(provider)>4000 then left(provider,4000)||'… [excerpt shortened]' else provider end as provider,
    started_at,duration_seconds
   from public.phone_recordings where tenant_id=p_tenant and id=p_id
  ) s;
 end if;
 return jsonb_build_object('version','learn-card-source/1','tenant_id',p_tenant,'table',p_table,'id',p_id,'record',result);
end $$;
revoke all on function public.learn_card_source_read(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_source_read(uuid,text,uuid) to authenticated;
alter function public.learn_card_source_read(uuid,text,uuid) owner to learn_card_communication_reader;
revoke create on schema public from learn_card_communication_reader;
do $$ begin execute format('revoke learn_card_communication_reader from %I',current_user);end $$;
commit;
