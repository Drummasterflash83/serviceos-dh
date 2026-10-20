-- A retained projection can be removed from current LEARN links without
-- deleting its canonical records or source evidence. Reversal is dependency
-- ordered and atomic for one registered customer group.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';

-- Existing single-customer reversal must also respect a direct-property site,
-- which lives outside learn_business_input_current_links by design.
create function public.new_dawn_m2_guard_customer_reverse()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.action='reversed' and exists (
  select 1 from public.new_dawn_m2_current_direct_sites d
  where d.tenant_id=new.tenant_id and d.customer_link_id=new.link_id
 ) then
  raise exception 'direct_site_depends_on_customer' using errcode='PT409';
 end if;
 return new;
end $$;
revoke all on function public.new_dawn_m2_guard_customer_reverse()
 from public,anon,authenticated,service_role;
create trigger guard_direct_site_before_customer_reverse
 before insert on public.new_dawn_commusoft_customer_link_events
 for each row execute function public.new_dawn_m2_guard_customer_reverse();

create function public.new_dawn_m2_identity_reverse_group(
 p_batch uuid,p_customer_external text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='60s' as $$
declare b public.new_dawn_m2_identity_batches%rowtype;
 i public.new_dawn_m2_identity_items%rowtype;
 l public.learn_business_input_links%rowtype;
 d public.new_dawn_m2_direct_sites%rowtype;
 latest text;total integer;linked integer;reversed integer;
 audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed'
  or p_batch is null or p_customer_external is null
  or p_customer_external!~'^[1-9][0-9]{0,15}$'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'staged_reversal_forbidden' using errcode='42501';end if;
 select * into b from public.new_dawn_m2_identity_batches where id=p_batch for update;
 if not found then raise exception 'staged_batch_unavailable' using errcode='42501';end if;
 perform public.learn_import_batch_authority(b.tenant_id,b.actor_id);
 perform 1 from public.provider_connections where id=b.connection_id
  and tenant_id=b.tenant_id and provider='commusoft' for update;
 if not found then raise exception 'staged_connection_unavailable' using errcode='42501';end if;
 select count(*),count(*) filter(where state='linked'),
  count(*) filter(where state='reversed') into total,linked,reversed
 from public.new_dawn_m2_identity_items ix where ix.batch_id=p_batch and
  ((ix.kind='customer' and ix.external_id=p_customer_external)
   or (ix.kind in ('site','job') and ix.customer_external_id=p_customer_external));
 if total<2 or total>500 then raise exception 'staged_group_missing' using errcode='PT409';end if;
 if reversed=total then return jsonb_build_object('state','already_reversed',
  'batch_id',p_batch,'item_count',total);end if;
 if linked<>total then raise exception 'staged_group_not_fully_linked' using errcode='PT409';end if;
 lock table public.people,public.companies,public.customer_cards,
  public.sites,public.jobs in share row exclusive mode;
 perform pg_advisory_xact_lock(hashtextextended(
  'new_dawn_m2_identity:'||b.tenant_id::text,0));
 for i in select * from public.new_dawn_m2_identity_items
  where batch_id=p_batch and
   ((kind='customer' and external_id=p_customer_external)
    or (kind in ('site','job') and customer_external_id=p_customer_external))
  order by case kind when 'job' then 1 when 'site' then 2 else 3 end,ordinal desc
 loop
  select * into l from public.learn_business_input_links
   where id=i.link_id and tenant_id=b.tenant_id and connection_id=b.connection_id;
  if i.kind='site' and i.shape='direct' then
   select * into d from public.new_dawn_m2_current_direct_sites
    where id=i.link_id and tenant_id=b.tenant_id and connection_id=b.connection_id;
   if not found or d.site_id is distinct from i.entity_id
    or d.source_version_id is distinct from i.source_version_id then
    raise exception 'staged_direct_site_changed' using errcode='PT409';end if;
   -- A site may not be withdrawn while any other current link uses it.
   if exists(select 1 from public.learn_business_input_current_links x
    join public.jobs j on j.id=x.entity_id and j.tenant_id=x.tenant_id
    where x.tenant_id=b.tenant_id and x.entity_kind='job'
     and j.site_id=d.site_id) then
    raise exception 'staged_site_in_use' using errcode='PT409';end if;
   insert into public.new_dawn_m2_direct_site_events
    (tenant_id,mapping_id,action,actor_id,source_version_id,batch_id,reason)
   values(b.tenant_id,d.id,'reversed',b.actor_id,d.source_version_id,p_batch,btrim(p_reason));
  else
   if not found or l.entity_id is distinct from i.entity_id
    or l.source_version_id is distinct from i.source_version_id
    or l.external_id is distinct from i.external_id then
    raise exception 'staged_link_changed' using errcode='PT409';end if;
   if not exists(select 1 from public.learn_business_input_current_links x
    where x.id=l.id and x.tenant_id=b.tenant_id) then
    raise exception 'staged_link_not_current' using errcode='PT409';end if;
   if i.kind='job' and i.shape='direct' then
    insert into public.new_dawn_m2_direct_job_events
     (tenant_id,link_id,action,actor_id,source_version_id,batch_id,reason)
    values(b.tenant_id,l.id,'reversed',b.actor_id,l.source_version_id,p_batch,btrim(p_reason));
   elsif i.kind='job' then
    insert into public.new_dawn_commusoft_exact_link_events
     (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
    values(b.tenant_id,l.id,'reversed',b.actor_id,l.source_version_id,
     'commusoft_exact_dual_id_v1',btrim(p_reason));
   elsif i.kind='site' then
    if exists(select 1 from public.learn_business_input_current_links x
     join public.jobs j on j.id=x.entity_id and j.tenant_id=x.tenant_id
     where x.tenant_id=b.tenant_id and x.entity_kind='job'
      and j.site_id=i.entity_id) then
     raise exception 'staged_site_in_use' using errcode='PT409';end if;
    insert into public.new_dawn_commusoft_exact_site_events
     (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
    values(b.tenant_id,l.id,'reversed',b.actor_id,l.source_version_id,
     'commusoft_workaddress_parent_id_v1',btrim(p_reason));
   else
    if exists(select 1 from public.learn_business_input_current_links x
     where x.tenant_id=b.tenant_id and x.connection_id=b.connection_id
      and x.entity_kind in ('site','job') and x.card_id=l.card_id)
     or exists(select 1 from public.new_dawn_m2_current_direct_sites x
      where x.tenant_id=b.tenant_id and x.customer_link_id=l.id) then
     raise exception 'staged_customer_in_use' using errcode='PT409';end if;
    insert into public.new_dawn_commusoft_customer_link_events
     (tenant_id,link_id,action,actor_id,source_version_id,reason)
    values(b.tenant_id,l.id,'reversed',b.actor_id,l.source_version_id,btrim(p_reason));
   end if;
  end if;
  update public.new_dawn_m2_identity_items set state='reversed'
   where batch_id=p_batch and ordinal=i.ordinal and state='linked';
  if not found then raise exception 'staged_item_state_changed' using errcode='PT409';end if;
  insert into public.controlplane_change_log
   (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
    correlation_id,view_as_active,source)
  values(gen_random_uuid(),b.tenant_id,b.actor_id::text,
   'client_identity.staged_'||i.kind||'_reversed',i.kind,i.entity_id::text,
   jsonb_build_object('batch_id',p_batch,'ordinal',i.ordinal,
    'source_version_id',i.source_version_id,'link_id',i.link_id,
    'manifest_sha256',b.manifest_sha256,'executed_by','service_role_release'),
   btrim(p_reason),p_batch::text,false,'new-dawn-staged-identity');
 end loop;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,b.tenant_id,b.actor_id::text,'client_identity.staged_group_reversed',
  'commusoft_identity_batch',p_batch::text,
  jsonb_build_object('manifest_sha256',b.manifest_sha256,'item_count',total),
  btrim(p_reason),p_batch::text,false,'new-dawn-staged-identity');
 return jsonb_build_object('state','reversed','batch_id',p_batch,
  'item_count',total,'audit_id',audit);
end $$;
revoke all on function public.new_dawn_m2_identity_reverse_group(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.new_dawn_m2_identity_reverse_group(uuid,text,text)
 to service_role;
commit;
