-- Operator-only aggregate readback. Never returns external IDs, names,
-- postcodes or raw provider records.
begin;
create function public.new_dawn_m2_identity_batch_summary(p_batch uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='10s' as $$
declare b public.new_dawn_m2_identity_batches%rowtype;
 totals jsonb;holds jsonb;
begin
 if p_batch is null then raise exception 'staged_batch_invalid' using errcode='22023';end if;
 select * into b from public.new_dawn_m2_identity_batches where id=p_batch;
 if not found then raise exception 'staged_batch_unavailable' using errcode='42501';end if;
 perform public.learn_operator_input_access(b.tenant_id,auth.uid(),false);
 select jsonb_build_object(
  'customers',count(*) filter(where kind='customer'),
  'sites',count(*) filter(where kind='site'),
  'jobs',count(*) filter(where kind='job'),
  'prepared',count(*) filter(where state='prepared'),
  'linked',count(*) filter(where state='linked'),
  'held',count(*) filter(where state='held'),
  'reversed',count(*) filter(where state='reversed')) into totals
 from public.new_dawn_m2_identity_items where batch_id=p_batch;
 select coalesce(jsonb_agg(jsonb_build_object('reason',hold_reason,
  'customers',customers,'sites',sites,'jobs_affected',jobs)
  order by hold_reason),'[]'::jsonb) into holds from (
   select hold_reason,count(*) filter(where kind='customer') customers,
    count(*) filter(where kind='site') sites,
    count(*) filter(where kind='job') jobs
   from public.new_dawn_m2_identity_items
   where batch_id=p_batch and state='held'
   group by hold_reason
 ) h;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('batch_id',p_batch,
  'manifest_sha256',b.manifest_sha256,
  'kind_evidence_sha256',b.kind_evidence_sha256,
  'item_count',b.item_count,'expires_at',b.expires_at,
  'totals',totals,'held_classes',holds);
end $$;
revoke all on function public.new_dawn_m2_identity_batch_summary(uuid)
 from public,anon,service_role;
grant execute on function public.new_dawn_m2_identity_batch_summary(uuid)
 to authenticated;
commit;
