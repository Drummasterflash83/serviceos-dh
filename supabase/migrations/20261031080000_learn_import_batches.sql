-- Bounded database calls reuse the governed per-row match/apply functions.
-- No installation backfill, queue, provider traffic, new identities or rule changes.
begin;
set local search_path=public,pg_temp;

create function learn_import_batch_authority(p_tenant uuid,p_actor uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Import batch requires a fresh snapshot' using errcode='22023';
 end if;
 if p_tenant is null or p_actor is null then
  raise exception 'Company and actor required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 if not exists(select 1 from profiles where id=p_actor and tenant_id=p_tenant and role in ('owner','admin'))
  or not exists(select 1 from tenants where id=p_tenant and status='active')
  or exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Current company import authority required' using errcode='42501';
 end if;
end $$;

create function learn_import_match_batch(p_tenant uuid,p_actor uuid,p_source text,p_entity text,p_rows jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;result jsonb;results jsonb:='[]';seen integer[]:='{}';n integer;
begin
 perform learn_import_batch_authority(p_tenant,p_actor);
 if p_entity is null or p_entity not in ('customers','sites','jobs') or nullif(btrim(p_source),'') is null
  or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Governed entity, source and rows required' using errcode='22023';
 end if;
 if jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Batch must contain 1..100 rows' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'record') is distinct from 'object'
   or jsonb_typeof(item->'row_number') is distinct from 'number' or (item->>'row_number')!~'^[0-9]{1,4}$' then
   raise exception 'Invalid batch row' using errcode='22023';
  end if;
  n:=(item->>'row_number')::integer;
  if n not between 2 and 5001 or n=any(seen) then raise exception 'Duplicate or out-of-range row' using errcode='22023';end if;
  seen:=array_append(seen,n);
  case p_entity
   when 'customers' then result:=import_match_customer(p_tenant,p_source,item->'record');
   when 'sites' then result:=import_match_site(p_tenant,p_source,item->'record');
   when 'jobs' then result:=import_match_job(p_tenant,p_source,item->'record');
  end case;
  results:=results||jsonb_build_array(jsonb_build_object('row_number',n,'result',result));
 end loop;
 return results;
end $$;

create function learn_import_apply_batch(p_tenant uuid,p_import uuid,p_actor uuid,p_entity text,p_options jsonb,p_rows jsonb)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;result jsonb;results jsonb:='[]';seen integer[]:='{}';n integer;fields text[];code text;
begin
 perform learn_import_batch_authority(p_tenant,p_actor);
 if p_entity is null or p_entity not in ('customers','sites','jobs') or jsonb_typeof(p_rows) is distinct from 'array' then
  raise exception 'Governed entity and rows required' using errcode='22023';
 end if;
 if jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Batch must contain 1..100 rows' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'record') is distinct from 'object'
   or jsonb_typeof(item->'row_number') is distinct from 'number' or (item->>'row_number')!~'^[0-9]{1,4}$' then
   raise exception 'Invalid batch row' using errcode='22023';
  end if;
  n:=(item->>'row_number')::integer;
  if n not between 2 and 5001 or n=any(seen) then raise exception 'Duplicate or out-of-range row' using errcode='22023';end if;
  seen:=array_append(seen,n);
  -- Also validates sealed options, entity, row bounds, current role/company/View As.
  -- A contract or authority error aborts the batch, rather than becoming a row failure.
  perform import_row_preamble(p_tenant,p_import,p_actor,n,item->'record',p_options,p_entity);
  if item ? 'invalid_fields' then
   if jsonb_typeof(item->'invalid_fields') is distinct from 'array' then raise exception 'Invalid field list' using errcode='22023';end if;
   if jsonb_array_length(item->'invalid_fields') not between 1 and 20 or exists(select 1 from jsonb_array_elements(item->'invalid_fields') f where jsonb_typeof(f) is distinct from 'string' or length(f#>>'{}') not between 1 and 80) then raise exception 'Invalid field list' using errcode='22023';end if;
   select array_agg(value) into fields from jsonb_array_elements_text(item->'invalid_fields');
   result:=import_row_outcome(p_tenant,p_import,n,'invalid','row failed column validation',fields);
   result:=jsonb_build_object('action',case when (result->>'already')::boolean then 'already_applied' else 'invalid' end);
  else
   -- Isolate row failures in subtransactions; successful rows commit together
   -- at this bounded batch's transaction boundary.
   -- Return SQLSTATE only, never customer values from a database error message.
   -- Edge retains classified failures using the existing outcome recorder. A
   -- lost response requires inspection: a committed batch retains successes,
   -- while a rolled-back batch retains none. Row errors remain unprocessed.
   begin
    case p_entity
     when 'customers' then result:=import_customer_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
     when 'sites' then result:=import_site_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
     when 'jobs' then result:=import_job_row(p_tenant,p_import,p_actor,n,item->'record',p_options);
    end case;
   exception when insufficient_privilege then raise;
    when others then get stacked diagnostics code=returned_sqlstate;result:=jsonb_build_object('error_code',code);
   end;
  end if;
  results:=results||jsonb_build_array(jsonb_build_object('row_number',n,'result',result));
 end loop;
 return results;
end $$;
revoke all on function learn_import_batch_authority(uuid,uuid),learn_import_match_batch(uuid,uuid,text,text,jsonb),learn_import_apply_batch(uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function learn_import_batch_authority(uuid,uuid),learn_import_match_batch(uuid,uuid,text,text,jsonb),learn_import_apply_batch(uuid,uuid,uuid,text,jsonb,jsonb) to service_role;
commit;
