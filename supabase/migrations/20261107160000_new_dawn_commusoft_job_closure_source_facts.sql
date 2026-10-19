-- Preserve source-native closure outcome, recorded closure time and FOC reason
-- from the exact job response. These are not invoice documents or paid values.
-- No flag is enabled, provider request started, or prior receipt changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.new_dawn_commusoft_job_detail_finish(p_request uuid,p_raw text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_job_detail_reads%rowtype;body jsonb;assigned jsonb;
 outcome jsonb;facets jsonb;quote_fact jsonb;closure jsonb;closed_source jsonb;
 updated_time text;onsite text;completion text;audit uuid:=gen_random_uuid();
 k text;kind text;v text;parent_state text;max_bytes integer;
begin
 if auth.role() is distinct from 'service_role' or p_raw is null or length(p_raw) not between 2 and 131072 then
  raise exception 'job_detail_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads where id=p_request for update;
 if not found or not public.new_dawn_commusoft_job_detail_current(p_request) then
  raise exception 'job_detail_scope_changed' using errcode='42501';end if;
 body:=p_raw::jsonb;
 if jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(body->'id') is distinct from 'number'
  or body->>'id' is distinct from r.external_id or body ? 'error' then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 if body ? 'usersCurrentlyAssignedToJob' and jsonb_typeof(body->'usersCurrentlyAssignedToJob') not in('array','null') then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 assigned:=coalesce(body->'usersCurrentlyAssignedToJob','[]'::jsonb);
 if assigned='null'::jsonb then assigned:='[]'::jsonb;end if;
 if jsonb_array_length(assigned)>20 or exists(select 1 from jsonb_array_elements(assigned) x
  where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'id') is distinct from 'number'
   or x->>'id'!~'^(0|[1-9][0-9]{0,15})$' or jsonb_typeof(x->'fullName') is distinct from 'string'
   or length(x->>'fullName')>200) then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('source_user_id',x->>'id','name',x->>'fullName')),'[]'::jsonb)
 into assigned from jsonb_array_elements(assigned)x;
 updated_time:=body->>'lastUpdatedOnDateTime';onsite:=body->>'expectedOnsiteDateTime';completion:=body->>'expectedCompletionDateTime';
 if (updated_time is not null and length(updated_time)>80) or (onsite is not null and length(onsite)>80)
  or (completion is not null and length(completion)>80) then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;

 -- Preserve absent, explicit JSON null and present as different source states.
 -- A source value does not create a visit, verified staff member, SLA promise
 -- or OpenFolk contract link.
 facets:='{}'::jsonb;
 foreach k in array array['isJobOnHold','onHoldReasonDescription','hasSLA','SLAStatus','contractID'] loop
  kind:=case when k in('isJobOnHold','hasSLA') then 'boolean'
   when k='contractID' then 'number' else 'string' end;
  if not body ? k then
   facets:=facets||jsonb_build_object(k,jsonb_build_object('state','not_supplied','value',null));
  elsif jsonb_typeof(body->k)='null' then
   facets:=facets||jsonb_build_object(k,jsonb_build_object('state','source_null','value',null));
  else
   if jsonb_typeof(body->k) is distinct from kind then
    facets:=facets||jsonb_build_object(k,jsonb_build_object('state','source_unrecognized','value',null));
   else
    v:=body->>k;
    if (kind='string' and length(v)>200) or
     (kind='number' and (v!~'^(0|[1-9][0-9]{0,15})$' or v::numeric>9007199254740991)) then
     facets:=facets||jsonb_build_object(k,jsonb_build_object('state','source_unrecognized','value',null));
    else
     facets:=facets||jsonb_build_object(k,jsonb_build_object('state','present',
      'value',case when kind='boolean' then body->k else to_jsonb(v) end));
    end if;
   end if;
  end if;
 end loop;
 -- quotedAmount is a source string, without a currency or estimate document.
 -- An unexpected type stays unverified; never parse it as money.
 if not body ? 'quotedAmount' then
  quote_fact:=jsonb_build_object('state','not_supplied','value',null);
 elsif jsonb_typeof(body->'quotedAmount')='null' then
  quote_fact:=jsonb_build_object('state','source_null','value',null);
 elsif jsonb_typeof(body->'quotedAmount')='string' and octet_length(body->>'quotedAmount')<=200 then
  quote_fact:=jsonb_build_object('state','present','value',body->>'quotedAmount');
 else
  quote_fact:=jsonb_build_object('state','source_unrecognized','value',null);
 end if;
 -- `closed` is a nested source object. If its shape is unexpected, hold only
 -- this facet. Missing, explicit null and malformed values remain distinct.
 closed_source:=body->'closed';
 parent_state:=case when not body ? 'closed' then 'not_supplied'
  when jsonb_typeof(closed_source)='null' then 'source_null'
  when jsonb_typeof(closed_source) is distinct from 'object' then 'source_unrecognized'
  else null end;
 closure:='{}'::jsonb;
 foreach k in array array['closedOutcome','closedOnDateTime','focReason'] loop
  max_bytes:=case when k='closedOnDateTime' then 80 else 200 end;
  if parent_state is not null then
   closure:=closure||jsonb_build_object(k,jsonb_build_object('state',parent_state,'value',null));
  elsif not closed_source ? k then
   closure:=closure||jsonb_build_object(k,jsonb_build_object('state','not_supplied','value',null));
  elsif jsonb_typeof(closed_source->k)='null' then
   closure:=closure||jsonb_build_object(k,jsonb_build_object('state','source_null','value',null));
  elsif jsonb_typeof(closed_source->k)='string' and octet_length(closed_source->>k)<=max_bytes then
   closure:=closure||jsonb_build_object(k,jsonb_build_object('state','present','value',closed_source->>k));
  else
   closure:=closure||jsonb_build_object(k,jsonb_build_object('state','source_unrecognized','value',null));
  end if;
 end loop;
 outcome:=jsonb_build_object('version','commusoft-exact-job-detail/5','tenant_id',r.tenant_id,
  'job_id',r.job_id,'connection_id',r.connection_id,'source_version_id',r.source_version_id,
  'external_id',r.external_id,'status',left(body->>'status',120),
  'stage',left(body->>'stageName',200),'pipeline',left(body->>'pipelineName',200),
  'expected_onsite',onsite,'expected_completion',completion,
  'source_assigned_users',assigned,'provider_updated_at',updated_time,
  'source_operational_facts',facets,'source_quoted_amount',quote_fact,
  'source_closure_facts',closure,'checked_at',clock_timestamp());
 update public.new_dawn_commusoft_job_detail_reads set state='complete',result=outcome,
  raw_sha256=encode(sha256(convert_to(p_raw,'UTF8')),'hex'),checked_at=clock_timestamp()
 where id=r.id;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,r.tenant_id,r.actor_id::text,'client_jobs.provider_detail_completed','jobs',r.job_id::text,
  jsonb_build_object('request_id',r.id,'source_version_id',r.source_version_id,
   'source_user_count',jsonb_array_length(assigned),'result_version','commusoft-exact-job-detail/5'),
  r.reason,r.id::text,false,'new-dawn-commusoft-job-detail');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return outcome||jsonb_build_object('audit_id',audit,'request_id',r.id);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'job_detail_response_invalid' using errcode='22023';
end $$;

revoke all on function public.new_dawn_commusoft_job_detail_finish(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_job_detail_finish(uuid,text) to service_role;
commit;
