-- Read retained job facts without publishing uncertain timestamps or source data.
begin;
create function public.learn_business_input_time_detail(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare raw text;local_time timestamp;instant timestamptz;
begin
 if p_value is null or p_value='null'::jsonb or p_value='""'::jsonb then
  return jsonb_build_object('state','absent','source',null,'instant',null);end if;
 if jsonb_typeof(p_value)<>'string' then return jsonb_build_object('state','invalid','source',null,'instant',null);end if;
 raw:=p_value#>>'{}';
 if length(raw)>100 then return jsonb_build_object('state','invalid','source',null,'instant',null);end if;
 if raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[ T]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?$' then
  begin local_time:=raw::timestamp;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('state','invalid','source',raw,'instant',null);end;
  return jsonb_build_object('state','timezone_required','source',raw,'instant',null);
 end if;
 if raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then
  begin instant:=raw::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('state','invalid','source',raw,'instant',null);end;
  return jsonb_build_object('state','zoned','source',raw,'instant',to_char(instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 end if;
 return jsonb_build_object('state','invalid','source',raw,'instant',null);
end $$;
revoke all on function public.learn_business_input_time_detail(jsonb) from public,anon,authenticated,service_role;

create function public.learn_commusoft_job_details(p_tenant uuid,p_connection uuid,p_version uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 fields jsonb:='{}';dates jsonb;field text;value text;observed timestamptz;
begin
 if p_tenant is null or p_connection is null or p_version is null then raise exception 'business_input_job_scope_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 select * into v from public.learn_business_input_versions where tenant_id=p_tenant and connection_id=p_connection
  and id=p_version and provider='commusoft' and collection='jobs';
 if not found then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 select max(p.committed_at) into observed from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  where o.version_id=v.id and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection;
 if observed is null then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 latest:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','jobs',v.external_id);
 foreach field in array array['description','status','priority','customerReference','businessUnit','userGroup'] loop
  value:=case when jsonb_typeof(v.payload->field)='string' then v.payload->>field end;
  fields:=fields||jsonb_build_object(field,jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 end loop;
 value:=case when jsonb_typeof(v.payload->'closed'->'closedOutcome')='string' then v.payload->'closed'->>'closedOutcome' end;
 fields:=fields||jsonb_build_object('closedOutcome',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 dates:=jsonb_build_object('created',public.learn_business_input_time_detail(v.payload->'createdOnDateTime'),
  'reported',public.learn_business_input_time_detail(v.payload->'jobReportedDateTime'),
  'completed',public.learn_business_input_time_detail(case when v.payload->'completed' is null or v.payload->'completed'='null'::jsonb or jsonb_typeof(v.payload->'completed')='object' then v.payload->'completed'->'completedOnDateTime' else '{}'::jsonb end),
  'closed',public.learn_business_input_time_detail(case when v.payload->'closed' is null or v.payload->'closed'='null'::jsonb or jsonb_typeof(v.payload->'closed')='object' then v.payload->'closed'->'closedOnDateTime' else '{}'::jsonb end));
 return jsonb_build_object('version','commusoft-job-detail/1','tenant_id',p_tenant,'connection_id',p_connection,'version_id',v.id,
  'external_id',v.external_id,'observed_at',observed,'current',latest.id is not distinct from v.id,
  'property_reference',case when jsonb_typeof(v.payload->'propertyID')='number' and v.payload->>'propertyID'~'^[1-9][0-9]{0,15}$' and (v.payload->>'propertyID')::numeric<=9007199254740991 then v.payload->>'propertyID' end,
  'fields',fields,'dates',dates);
end $$;
revoke all on function public.learn_commusoft_job_details(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_job_details(uuid,uuid,uuid) to authenticated;
commit;
