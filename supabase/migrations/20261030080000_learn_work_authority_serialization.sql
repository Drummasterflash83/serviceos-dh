-- Every ordinary row mutation of an authority input participates in the same
-- tenant lock as work actions. Try-locks avoid row-lock/advisory-lock inversion:
-- a competing update is refused with a retryable HTTP conflict, never allowed
-- to commit an authority change halfway through a work action.
create function public.learn_work_authority_input_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
 old_row jsonb;new_row jsonb;tenant_ids uuid[]:='{}';actor_id uuid;actor_tenant uuid;t uuid;
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
 if tg_table_name='tenants' then
  tenant_ids:=array[(old_row->>'id')::uuid,(new_row->>'id')::uuid];
 else
  tenant_ids:=array[(old_row->>'tenant_id')::uuid,(new_row->>'tenant_id')::uuid];
 end if;
 if tg_table_name='view_as_context' then
  -- Preview checks follow the real actor, even in legacy cross-tenant contexts.
  for actor_id in select distinct x from unnest(array[(old_row->>'actor_user_id')::uuid,(new_row->>'actor_user_id')::uuid]) x where x is not null loop
   select tenant_id into actor_tenant from profiles where id=actor_id;
   if not found and actor_id=(new_row->>'actor_user_id')::uuid
       and new_row->>'ended_at' is null
       and (new_row->>'expires_at' is null or (new_row->>'expires_at')::timestamptz>clock_timestamp()) then
    raise exception 'An active preview requires an existing actor profile' using errcode='22023';
   end if;
   tenant_ids:=array_append(tenant_ids,actor_tenant);
  end loop;
 end if;
 for t in select distinct x from unnest(tenant_ids) x where x is not null order by x loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-roster:'||t::text,0)) then
   raise exception 'Work or authority is changing; refresh and retry this change' using errcode='PT409';
  end if;
 end loop;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.learn_work_authority_input_lock() from public,anon,authenticated,service_role;

-- Configured classifications/edges are global vocabulary. Work holds a shared
-- lock; only mutation needs an exclusive lock. Different tenants can still act
-- concurrently. Registry edits never silently invalidate an in-flight action.
create function public.learn_work_registry_input_lock()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not pg_try_advisory_xact_lock(hashtextextended('learn-work-registry',0)) then
  raise exception 'Work is using this registry; retry the configuration change' using errcode='PT409';
 end if;
 return null;
end $$;
revoke all on function public.learn_work_registry_input_lock() from public,anon,authenticated,service_role;

do $$ declare n text;begin
 foreach n in array array['tenants','profiles','team_members','org_units','responsibility_assignments','authority_grants','view_as_context'] loop
  execute format('create trigger learn_work_authority_input_lock before insert or update or delete on public.%I for each row execute function public.learn_work_authority_input_lock()',n);
  -- A privileged truncate has no row triggers. Serialize it globally as well;
  -- existing retention guards and table privileges continue to apply.
  execute format('create trigger learn_work_authority_truncate_lock before truncate on public.%I for each statement execute function public.learn_work_registry_input_lock()',n);
 end loop;
 foreach n in array array['object_classes','domain_object_types','state_definitions','state_transitions','authority_permissions'] loop
  execute format('create trigger learn_work_registry_input_lock before insert or update or delete or truncate on public.%I for each statement execute function public.learn_work_registry_input_lock()',n);
 end loop;
end $$;

-- Keep the reviewed authority and evidence implementations, adding the mutex
-- before their tenant lock. READ COMMITTED gives each post-lock SQL statement
-- a fresh snapshot; a pre-existing repeatable-read snapshot is not sufficient.
do $$ declare signature text;definition text;needle text;
begin
 needle:='  perform pg_advisory_xact_lock(hashtextextended(''learn-roster:''||p_tenant::text,0));';
 foreach signature in array array['public.learn_work_authority(uuid,uuid,uuid,uuid,boolean)',
   'public.work_transition_apply(uuid,uuid,int,text,jsonb,jsonb,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle) then
   raise exception 'Reviewed authority locking contract changed';
  end if;
  definition:=replace(definition,needle,$patch$  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'Work authority requires a fresh read-committed snapshot' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
$patch$||needle);
  execute definition;
 end loop;
end $$;
