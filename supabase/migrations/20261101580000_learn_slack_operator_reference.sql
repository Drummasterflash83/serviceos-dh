-- Scoped approval attribution for logged cross-client Slack operators.
-- Source/account/job references remain tenant-bound; no row or grant changes.
begin;
create function public.learn_slack_reference_guard() returns trigger
 language plpgsql security definer set search_path=pg_catalog as $$
declare j jsonb:=to_jsonb(new); tenant uuid; parent_tenant uuid; fk record; rows_found bigint;
begin
 if tg_table_schema<>'public' or tg_table_name not in ('slack_history_imports','slack_thread_imports') then raise exception 'Slack reference guard used outside its scope' using errcode='23514';end if;
 if tg_table_name='org_unit_members' then
  if tg_op='UPDATE' and (old.org_unit_id is distinct from new.org_unit_id or old.user_id is distinct from new.user_id) then
   raise exception 'Organisation membership identity is immutable' using errcode='23514';end if;
  select tenant_id into tenant from public.org_units where id=new.org_unit_id;
  if tenant is null then raise exception 'Organisation unit is missing' using errcode='23503';end if;
 else
  tenant:=(j->>'tenant_id')::uuid;
  if tg_op='UPDATE' and ((to_jsonb(old)->>'tenant_id') is distinct from (j->>'tenant_id')
    or (to_jsonb(old)->>'id') is distinct from (j->>'id')) then
   raise exception 'Foundation tenant and identity are immutable' using errcode='23514';end if;
  if tenant is not null and not exists(select 1 from public.tenants where id=tenant) then
   raise exception 'Tenant is missing' using errcode='23503';end if;
 end if;
 for fk in select sn.nspname as schema_name,pc.relname as table_name,sa.attname as child_column,pa.attname as parent_column
  from pg_constraint k join pg_class pc on pc.oid=k.confrelid join pg_namespace sn on sn.oid=pc.relnamespace
  join pg_attribute sa on sa.attrelid=k.conrelid and sa.attnum=k.conkey[1]
  join pg_attribute pa on pa.attrelid=k.confrelid and pa.attnum=k.confkey[1]
  where k.conrelid=tg_relid and k.contype='f' and cardinality(k.conkey)=1 and cardinality(k.confkey)=1
   and exists(select 1 from pg_attribute a where a.attrelid=k.confrelid and a.attname='tenant_id' and not a.attisdropped)
 loop
  if j->>fk.child_column is null then continue;end if;
  execute format('select tenant_id from %I.%I where %I=$1::uuid',fk.schema_name,fk.table_name,fk.parent_column)
   into parent_tenant using j->>fk.child_column;
  get diagnostics rows_found=row_count;
  if rows_found<>1 then raise exception 'Referenced foundation record is missing' using errcode='23503';end if;
  -- An approver records the acting person; it is not a client-owned source.
  -- Only an actual authenticated OpenFolk admin can insert foreign attribution.
  -- Workers may retain that exact attribution while updating a thread checkpoint.
  if fk.schema_name='public' and fk.table_name='profiles' and fk.child_column='approved_by'
    and parent_tenant is distinct from tenant then
   if tg_op='UPDATE' and (to_jsonb(old)->>'approved_by') is not distinct from (j->>'approved_by') then continue;end if;
   if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or (j->>'approved_by')::uuid is distinct from auth.uid() then
    raise exception 'Slack operator approval attribution required' using errcode='42501';end if;
   perform public.learn_operator_input_access(tenant,auth.uid(),true);
   continue;
  end if;
  if not (fk.schema_name='public' and fk.table_name in ('config_versions','import_profiles') and parent_tenant is null)
    and parent_tenant is distinct from tenant then
   raise exception 'Referenced foundation record belongs to another tenant' using errcode='23514';end if;
 end loop;
 return new;
end $$;
revoke all on function public.learn_slack_reference_guard() from public,anon,authenticated;
grant execute on function public.learn_slack_reference_guard() to service_role;
do $$declare tab text;trig text;begin
 foreach tab in array array['slack_history_imports','slack_thread_imports'] loop
  select tgname into strict trig from pg_trigger where tgrelid=('public.'||tab)::regclass
   and tgfoid='public.learn_foundation_reference_guard()'::regprocedure and not tgisinternal;
  execute format('drop trigger %I on public.%I',trig,tab);
  execute format('create trigger %I before insert or update on public.%I for each row execute function public.learn_slack_reference_guard()',trig,tab);
 end loop;
end$$;
commit;
