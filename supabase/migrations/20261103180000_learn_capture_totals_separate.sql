-- Independent operator-only company totals. Slow scans never block account status.
-- This RPC reads retained data only; a failure must remain unverified in the client.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.learn_operator_capture_totals(uuid)') is not null
   or md5(pg_get_functiondef('public.learn_operator_capture_health(uuid,text)'::regprocedure))
     is distinct from '7c52320c0d9f19a36af3909f51de0ff8'
 then raise exception 'Exact bounded account reader required';end if;
end$$;
create function public.learn_operator_capture_totals(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare email_retention jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 with source as (
  select m.raw_payload,
   exists(select 1 from public.email_accounts a where a.tenant_id=p_tenant
    and a.id::text=m.raw_payload->>'provider_account_id' and a.provider=m.provider) as bound
  from public.email_messages m where m.tenant_id=p_tenant
 ), classified as (
  select bound,case when bound and jsonb_typeof(raw_payload->'provider_observed_history_id')='string'
   and case when raw_payload->>'provider_observed_history_id' ~ '^(0|[1-9][0-9]{0,19})$'
    then (raw_payload->>'provider_observed_history_id')::numeric<=18446744073709551615 else false end
   and raw_payload->>'provider_availability' in ('available','unavailable')
   then raw_payload->>'provider_availability' else 'unverified' end as availability
  from source
 ), counts as (
  select count(*) as total,
   count(*) filter(where availability='available') as available,
   count(*) filter(where availability='unavailable') as unavailable,
   count(*) filter(where availability='unverified') as unverified,
   count(*) filter(where not bound) as unbound from classified
 )
 select jsonb_build_object('version','learn-email-retention/1','tenant_id',p_tenant,'scope','company')
  ||to_jsonb(counts)||jsonb_build_object('archived_versions',
    (select count(*) from public.learn_email_source_versions where tenant_id=p_tenant))
 into email_retention from counts;
 return jsonb_build_object('version','learn-operator-capture-totals/1','tenant_id',p_tenant,
  'checked_at',clock_timestamp(),'email_retention',email_retention,
  'phone_processing',public.learn_phone_processing_evidence(p_tenant));
end $$;
revoke all on function public.learn_operator_capture_totals(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_capture_totals(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
