-- Repair the operator-approved staged batch authority boundary. The registered
-- OpenFolk actor is a platform operator, not a Drummonds owner/admin. A local,
-- service-role-only batch context permits the existing canonical writers only
-- while the exact registered batch, grant, tenant and apply flag remain valid.
-- No batch is applied by this migration.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';
do $gate$ begin
 if to_regprocedure('public.new_dawn_m2_identity_apply_group(uuid,text)') is null
  or encode(sha256(convert_to(pg_get_functiondef('public.learn_import_batch_authority(uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'c6acf5897fd13813df5238fac672db336fff4da47b038c167047f72dd70405ac'
  or encode(sha256(convert_to(pg_get_functiondef('public.new_dawn_m2_identity_apply_group(uuid,text)'::regprocedure),'UTF8')),'hex')<>'55124aabbb268a2db6bcd254c703d171519dbc67e21c638699aac8ebfe809f83'
 then raise exception 'm2_authority_repair_source_changed';end if;
end $gate$;

create or replace function public.learn_import_batch_authority(p_tenant uuid,p_actor uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
declare batch_id_text text:=current_setting('new_dawn.m2_staged_batch_id',true);
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Import batch requires a fresh snapshot' using errcode='22023';
 end if;
 if p_tenant is null or p_actor is null then
  raise exception 'Company and actor required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if exists(select 1 from public.profiles where id=p_actor and tenant_id=p_tenant and role in ('owner','admin'))
  and exists(select 1 from public.tenants where id=p_tenant and status='active')
  and not exists(select 1 from public.view_as_context where actor_user_id=p_actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
  return;
 end if;
 if auth.role()='service_role'
  and batch_id_text~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and exists(select 1 from public.new_dawn_m2_identity_batches b
    join public.tenants t on t.id=b.tenant_id and t.status='active'
    join public.profiles p on p.id=b.actor_id
    join public.platform_authority_grants g on g.profile_id=b.actor_id
      and g.permission='platform.controlplane.admin'
      and coalesce(g.effective_from,'-infinity'::timestamptz)<=clock_timestamp()
      and coalesce(g.effective_to,'infinity'::timestamptz)>clock_timestamp()
    join public.feature_flags f on f.tenant_id=b.tenant_id
      and f.flag='new_dawn.m2_staged_batch_apply' and f.value='true'::jsonb
    where b.id='64af841f-a84b-400b-8fed-669f8ec32747'::uuid
      and b.id=batch_id_text::uuid and b.tenant_id=p_tenant and b.actor_id=p_actor
      and b.expires_at>clock_timestamp()
      and not exists(select 1 from public.view_as_context v where v.actor_user_id=p_actor
       and v.ended_at is null and (v.expires_at is null or v.expires_at>clock_timestamp()))
    for share of g) then
  return;
 end if;
 raise exception 'Current company import authority required' using errcode='42501';
end $$;

create or replace function public.new_dawn_m2_identity_apply_group(
 p_batch uuid,p_customer_external text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='60s' as $$
declare b public.new_dawn_m2_identity_batches%rowtype;
 c public.provider_connections%rowtype;r record;
 total integer;linked integer;held integer;customer_count integer;
 hold_code text;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed'
  or p_batch is null or p_customer_external is null
  or p_customer_external!~'^[1-9][0-9]{0,15}$' then
  raise exception 'staged_group_forbidden' using errcode='42501';end if;
 select * into b from public.new_dawn_m2_identity_batches where id=p_batch for update;
 if not found or b.expires_at<=clock_timestamp() then
  raise exception 'staged_batch_unavailable' using errcode='42501';end if;
 perform set_config('new_dawn.m2_staged_batch_id',p_batch::text,true);
 perform public.learn_import_batch_authority(b.tenant_id,b.actor_id);
 perform 1 from public.tenants where id=b.tenant_id and status='active' for share;
 if not found then raise exception 'staged_tenant_unavailable' using errcode='42501';end if;
 foreach hold_code in array array['learn.enabled','learn.inputs.commusoft.enabled',
  'new_dawn.m2_staged_batch_apply'] loop
  perform 1 from public.feature_flags where tenant_id=b.tenant_id
   and flag=hold_code and value='true'::jsonb for share;
  if not found then raise exception 'staged_apply_disabled' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=b.tenant_id
  and provider='commusoft' and connector_id='commusoft'
  and enabled and status='active' for share;
 if not found then raise exception 'staged_connector_unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where tenant_id=b.tenant_id
  and id=b.connection_id and provider='commusoft' and status='configured'
  and revoked_at is null and verified_at<=clock_timestamp() for update;
 if not found then raise exception 'staged_connection_unavailable' using errcode='42501';end if;
 select count(*),count(*) filter(where kind='customer'),
  count(*) filter(where state='linked'),count(*) filter(where state='held')
 into total,customer_count,linked,held from public.new_dawn_m2_identity_items i
 where i.batch_id=p_batch and ((i.kind='customer' and i.external_id=p_customer_external)
  or (i.kind in ('site','job') and i.customer_external_id=p_customer_external));
 if total<2 or total>500 or customer_count<>1 or held>0 then
  raise exception 'staged_group_incomplete_or_held' using errcode='PT409';end if;
 if linked=total then
  return jsonb_build_object('state','already_linked','batch_id',p_batch,
   'customer_external_id',p_customer_external,'item_count',total);end if;
 if linked<>0 or exists(select 1 from public.new_dawn_m2_identity_items i
  where i.batch_id=p_batch and ((i.kind='customer' and i.external_id=p_customer_external)
   or (i.kind in ('site','job') and i.customer_external_id=p_customer_external))
   and i.state<>'prepared') then
  raise exception 'staged_group_partial_state' using errcode='PT409';end if;
 -- All jobs must have the exact site identity in this same registered group.
 if exists(select 1 from public.new_dawn_m2_identity_items j
  where j.batch_id=p_batch and j.kind='job'
   and j.customer_external_id=p_customer_external
   and not exists(select 1 from public.new_dawn_m2_identity_items s
    where s.batch_id=p_batch and s.kind='site'
     and s.external_id=j.property_external_id and s.shape=j.shape
     and s.customer_external_id=p_customer_external)) then
  raise exception 'staged_group_site_missing' using errcode='PT409';end if;
 -- All canonical writers acquire RowExclusive locks. The short-lived table
 -- locks fence concurrent manual/import inserts while the final collision
 -- checks and one customer's inserts run, including postcode collisions.
 lock table public.people,public.companies,public.customer_cards,
  public.sites,public.jobs in share row exclusive mode;
 perform pg_advisory_xact_lock(
  hashtextextended('new_dawn_m2_identity:'||b.tenant_id::text,0));
 begin
  for r in select i.ordinal from public.new_dawn_m2_identity_items i
   where i.batch_id=p_batch and
    ((i.kind='customer' and i.external_id=p_customer_external)
     or (i.kind in ('site','job') and i.customer_external_id=p_customer_external))
   order by case i.kind when 'customer' then 1 when 'site' then 2 else 3 end,
    i.ordinal
  loop
   perform public.new_dawn_m2_identity_apply_one(p_batch,r.ordinal);
  end loop;
 exception when sqlstate 'PT409' then
  if SQLERRM not like 'staged_hold:%' then raise;end if;
  hold_code:=split_part(SQLERRM,':',2);
  update public.new_dawn_m2_identity_items set state='held',hold_reason=hold_code
   where batch_id=p_batch and state='prepared' and
    ((kind='customer' and external_id=p_customer_external)
     or (kind in ('site','job') and customer_external_id=p_customer_external));
  insert into public.controlplane_change_log
   (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
    correlation_id,view_as_active,source)
  values(audit,b.tenant_id,b.actor_id::text,'client_identity.staged_group_held',
   'commusoft_identity_batch',p_batch::text,
   jsonb_build_object('manifest_sha256',b.manifest_sha256,
    'customer_external_id',p_customer_external,'hold_code',hold_code,
    'item_count',total,'executed_by','service_role_release'),
   b.reason,p_batch::text,false,'new-dawn-staged-identity');
  return jsonb_build_object('state','held','hold_code',hold_code,
   'batch_id',p_batch,'item_count',total,'audit_id',audit);
 end;
 return jsonb_build_object('state','linked','batch_id',p_batch,
  'customer_external_id',p_customer_external,'item_count',total,
  'manifest_sha256',b.manifest_sha256);
end $$;

comment on function public.learn_import_batch_authority(uuid,uuid) is
 'Tenant owner/admin as before, or the active platform admin for the exact reviewed M2 batch only inside its service-role transaction, with the tenant apply flag on.';
comment on function public.new_dawn_m2_identity_apply_group(uuid,text) is
 'Atomic exact-source group apply; sets a transaction-local registered batch context for canonical writer authority.';
commit;
