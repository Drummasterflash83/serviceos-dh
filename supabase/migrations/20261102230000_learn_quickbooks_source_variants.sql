-- Preserve immutable versions while recognising narrowly evidenced provider
-- variants. Unknown same-version changes remain held. Installs no repair/schedule.
begin;
create function public.learn_quickbooks_payload_variant(p_entity text,p_before jsonb,p_after jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare a timestamptz;b timestamptz;begin
 if jsonb_typeof(p_before) is distinct from 'object' or jsonb_typeof(p_after) is distinct from 'object' then return false;end if;
 if p_before=p_after then return true;end if;
 if p_entity='Invoice' and jsonb_typeof(p_before->'LinkedTxn')='array' and jsonb_typeof(p_after->'LinkedTxn')='array'
  and (p_before-'LinkedTxn')=(p_after-'LinkedTxn') then
  -- Preserve multiplicity and every member field. Invoice line order is untouched.
  return (select jsonb_agg(x order by x) from jsonb_array_elements(p_before->'LinkedTxn')x)
    is not distinct from (select jsonb_agg(x order by x) from jsonb_array_elements(p_after->'LinkedTxn')x);
 end if;
 if p_entity='Customer' and (p_before-array['Balance','BalanceWithJobs','MetaData'])=(p_after-array['Balance','BalanceWithJobs','MetaData'])
  and jsonb_typeof(p_before->'MetaData')='object' and jsonb_typeof(p_after->'MetaData')='object'
  and ((p_before->'MetaData')-'LastUpdatedTime')=((p_after->'MetaData')-'LastUpdatedTime')
  and jsonb_typeof(p_before#>'{MetaData,LastUpdatedTime}')='string' and jsonb_typeof(p_after#>'{MetaData,LastUpdatedTime}')='string'
  and coalesce(jsonb_typeof(p_before->'Balance'),'missing') in('number','missing')
  and coalesce(jsonb_typeof(p_after->'Balance'),'missing') in('number','missing')
  and coalesce(jsonb_typeof(p_before->'BalanceWithJobs'),'missing') in('number','missing')
  and coalesce(jsonb_typeof(p_after->'BalanceWithJobs'),'missing') in('number','missing') then
  if (p_before#>>'{MetaData,LastUpdatedTime}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' or (p_after#>>'{MetaData,LastUpdatedTime}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false;end if;
  a:=(p_before#>>'{MetaData,LastUpdatedTime}')::timestamptz;b:=(p_after#>>'{MetaData,LastUpdatedTime}')::timestamptz;
  return isfinite(a) and isfinite(b) and a<>b;
 end if;
 return false;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
create function public.learn_quickbooks_versions_compatible(p_before uuid,p_after uuid)
returns boolean language sql stable set search_path=pg_catalog as $$
 select coalesce((select public.learn_quickbooks_payload_variant(a.entity,a.payload,b.payload)
  from public.learn_quickbooks_source_versions a join public.learn_quickbooks_source_versions b
   on(a.tenant_id,a.environment,a.realm_id,a.entity,a.external_id,a.sync_token)=(b.tenant_id,b.environment,b.realm_id,b.entity,b.external_id,b.sync_token)
  where a.id=p_before and b.id=p_after),false);
$$;
revoke all on function public.learn_quickbooks_payload_variant(text,jsonb,jsonb),public.learn_quickbooks_versions_compatible(uuid,uuid) from public,anon,authenticated,service_role;
do $patch$
declare d text;needle text;replacement text;begin
 select pg_get_functiondef('public.learn_quickbooks_import_commit(uuid,uuid,text)'::regprocedure) into d;
 needle:='excluded.sync_token>learn_quickbooks_latest.sync_token then excluded';
 replacement:='(excluded.sync_token>learn_quickbooks_latest.sync_token or (excluded.sync_token=learn_quickbooks_latest.sync_token and excluded.source_updated_at>learn_quickbooks_latest.source_updated_at and public.learn_quickbooks_versions_compatible(learn_quickbooks_latest.version_id,excluded.version_id))) then excluded';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'quickbooks_variant_commit_source_changed';end if;
 d:=replace(d,needle,replacement);
 needle:='learn_quickbooks_latest.conflicted or excluded.version_id<>learn_quickbooks_latest.version_id';
 replacement:='learn_quickbooks_latest.conflicted or (excluded.version_id<>learn_quickbooks_latest.version_id and not public.learn_quickbooks_versions_compatible(learn_quickbooks_latest.version_id,excluded.version_id))';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'quickbooks_variant_conflict_source_changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
