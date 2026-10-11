-- Validate retained work receipts at transaction completion. Numerical correction
-- RPCs append the measurement before their separate correction ledger in the same
-- transaction; deferred constraints verify the completed atomic write.
-- Existing observations, assessments and function definitions are unchanged.
create function public.learn_work_measurement_receipt_check(p_tenant uuid,p_id uuid)
returns void language plpgsql stable security definer set search_path=pg_catalog as $$
declare m public.measurements%rowtype; parent public.measurements%rowtype;
 c public.learn_performance_corrections%rowtype; original_observed timestamptz;
 visited uuid[]:='{}'; source_kind text; subject_kind text; metric text; unit_name text;
 receipt_table text; receipt jsonb; proof jsonb; request jsonb; expected_contract text;
begin
 select * into m from public.measurements where id=p_id and tenant_id=p_tenant;
 if not found then raise exception 'Measurement unavailable for receipt validation' using errcode='22023';end if;
 if coalesce(m.source,'') not in ('serviceos.work.handoffs@1','serviceos.work.residence@1','serviceos.work.team-residence@1',
   'serviceos.work.working-time@1','serviceos.work.team-working-time@1') and not exists(
   select 1 from jsonb_array_elements(case when jsonb_typeof(m.evidence)='array' then m.evidence else '[]' end) e where e->>'table' in
    ('learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')) then return;end if;
 while m.request_payload ? 'manualCorrectionId' loop
  if m.id=any(visited) or cardinality(visited)>=500 then
   raise exception 'Correction ancestry exceeds receipt validation bounds' using errcode='22023';end if;
  visited:=array_append(visited,m.id);
  select * into c from public.learn_performance_corrections where id=m.id and tenant_id=p_tenant;
  if not found or m.request_payload->>'manualCorrectionId' is distinct from m.id::text
   or c.predecessor_id is distinct from m.supersedes or c.corrected_value is distinct from m.value
   or c.created_at is distinct from m.measured_at or (original_observed is not null and original_observed<>c.source_observed_at) then
   raise exception 'Work correction has no matching retained provenance' using errcode='22023';end if;
  original_observed:=c.source_observed_at;
  select * into parent from public.measurements where id=c.predecessor_id and tenant_id=p_tenant;
  if not found or parent.value is distinct from c.previous_value or parent.measured_at>=m.measured_at
   or row(m.subject_kind,m.subject_id,m.policy_id,m.policy_revision,m.metric_key,m.unit,m.window_start,m.window_end,m.source,m.source_through,m.sample_count,m.covered_count,m.eligible_count,m.evidence,m.exclusions,m.group_ids)
     is distinct from row(parent.subject_kind,parent.subject_id,parent.policy_id,parent.policy_revision,parent.metric_key,parent.unit,parent.window_start,parent.window_end,parent.source,parent.source_through,parent.sample_count,parent.covered_count,parent.eligible_count,parent.evidence,parent.exclusions,parent.group_ids) then
   raise exception 'Work correction differs from its source scope' using errcode='22023';end if;
  m:=parent;
 end loop;
 if original_observed is not null and original_observed<>m.measured_at then
  raise exception 'Work correction changed original source time' using errcode='22023';end if;
 select v.kind,v.subject,v.metric,v.unit into source_kind,subject_kind,metric,unit_name from (values
 ('serviceos.work.handoffs@1','handoffs','member','work.recorded_handoffs','handoffs'),
 ('serviceos.work.residence@1','residence','member','work.owned_item_minutes','item_minutes'),
 ('serviceos.work.team-residence@1','teamResidence','team','work.team_owned_item_minutes','item_minutes'),
 ('serviceos.work.working-time@1','workingTime','member','work.working_item_minutes','working_item_minutes'),
 ('serviceos.work.team-working-time@1','teamWorkingTime','team','work.team_working_item_minutes','working_item_minutes')
 ) v(source,kind,subject,metric,unit) where v.source=m.source;
 if not found or m.subject_kind<>subject_kind or m.metric_key<>metric or m.unit<>unit_name
  or jsonb_typeof(m.evidence) is distinct from 'array' or jsonb_array_length(m.evidence)<>1
  or m.exclusions is distinct from '[]'::jsonb or m.eligible_count is null
  or m.sample_count is distinct from m.covered_count or m.covered_count<0 or m.covered_count>m.eligible_count
  or (m.value is not null and m.covered_count<>m.eligible_count) then
  raise exception 'Work measurement scope or coverage is unsupported' using errcode='22023';end if;
 receipt_table:=m.evidence#>>'{0,table}';
 if m.evidence#>>'{0,id}' is distinct from m.id::text or receipt_table is null or receipt_table not in
   ('learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')
  or (receipt_table<>'learn_work_collection_runs' and (source_kind in ('workingTime','teamWorkingTime')
   or receipt_table<>case when subject_kind='team' then 'learn_team_work_measurement_runs' else 'learn_work_measurement_runs' end)) then
  raise exception 'Work measurement has no original calculation reference' using errcode='22023';end if;
 -- The table identifier is selected exclusively from the allowlist above.
 execute format('select to_jsonb(r) from public.%I r where id=$1 and tenant_id=$2',receipt_table) into receipt using m.id,p_tenant;
 if receipt is null then raise exception 'Original work calculation is unavailable' using errcode='22023';end if;
 proof:=receipt->'proof';request:=receipt->'request';
 if receipt->>'source_system' is distinct from m.source or receipt->>'metric_key' is distinct from m.metric_key
  or (receipt->>'observed_at')::timestamptz is distinct from m.measured_at
  or proof->'value' is distinct from coalesce(to_jsonb(m.value),'null'::jsonb)
  or proof->'coveredItems' is distinct from to_jsonb(m.covered_count)
  or proof->'eligibleItems' is distinct from to_jsonb(m.eligible_count) then
  raise exception 'Work receipt summary differs from its measurement' using errcode='22023';end if;
 if receipt_table='learn_work_collection_runs' then
  if receipt->>'state' is distinct from 'completed' or receipt->>'kind' is distinct from source_kind
   or receipt->>'subject_kind' is distinct from m.subject_kind or (receipt->>'subject_id')::uuid is distinct from m.subject_id
   or (receipt->>'policy_id')::uuid is distinct from m.policy_id or (receipt->>'policy_revision')::integer is distinct from m.policy_revision
   or receipt->>'unit' is distinct from m.unit or (receipt->>'window_start')::timestamptz is distinct from m.window_start
   or (receipt->>'window_end')::timestamptz is distinct from m.window_end
   or proof->>'contract' is distinct from 'work-collection@1' or proof->>'kind' is distinct from source_kind
   or proof->>'runId' is distinct from m.id::text or receipt->'population' is distinct from receipt->'processed'
   or proof->'populationCount' is distinct from receipt->'population' or proof->'processed' is distinct from receipt->'population'
   or proof->'itemCount' is distinct from receipt->'population' or (receipt->>'population')::bigint<m.eligible_count
   or (case when m.value is null then m.source_through is not null else m.source_through is distinct from (receipt->>'snapshot_at')::timestamptz end) then
   raise exception 'Completed work receipt attribution differs' using errcode='22023';end if;
 else
  expected_contract:=case source_kind when 'handoffs' then 'work-handoffs@1' when 'residence' then 'work-residence@1' else 'team-work-residence@1' end;
  if proof->>'contract' is distinct from expected_contract
   or (receipt->>case when subject_kind='team' then 'team_id' else 'member_id' end)::uuid is distinct from m.subject_id
   or (request->>case when subject_kind='team' then 'teamId' else 'memberId' end)::uuid is distinct from m.subject_id
   or (request->>'policyId')::uuid is distinct from m.policy_id or (request->>'policyVersion')::integer is distinct from m.policy_revision
   or (request->>'start')::timestamptz is distinct from m.window_start or (request->>'end')::timestamptz is distinct from m.window_end
   or (m.value is null and m.source_through is not null) then
   raise exception 'Original work receipt attribution differs' using errcode='22023';end if;
 end if;
end $$;
revoke all on function public.learn_work_measurement_receipt_check(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_measurement_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.learn_work_measurement_receipt_check(new.tenant_id,new.id);
 return null;
end $$;
revoke all on function public.learn_measurement_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_measurement_receipt_guard after insert on public.measurements
 deferrable initially deferred for each row execute function public.learn_measurement_receipt_constraint();

create function public.learn_review_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 -- Disputing old evidence must remain possible even when its source is malformed.
 if new.decision='confirmed' then
  perform public.learn_work_measurement_receipt_check(new.tenant_id,new.measurement_id);
 end if;
 return null;
end $$;
revoke all on function public.learn_review_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_review_receipt_guard after insert on public.learn_performance_reviews
 deferrable initially deferred for each row execute function public.learn_review_receipt_constraint();

create function public.learn_assessment_receipt_constraint() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; stored jsonb; pair record;
begin
 for item in select value from jsonb_array_elements(new.snapshot->'measurements') loop
  select to_jsonb(m)||jsonb_build_object('correction_request_id',m.request_payload->>'manualCorrectionId') into stored
   from public.measurements m where id=(item->>'id')::uuid and tenant_id=new.tenant_id;
  if stored is null then raise exception 'Assessment measurement is unavailable' using errcode='22023';end if;
  for pair in select key,value from jsonb_each(item) loop
   if pair.value is distinct from stored->pair.key then
    raise exception 'Assessment snapshot differs from retained measurement' using errcode='22023';end if;
  end loop;
  perform public.learn_work_measurement_receipt_check(new.tenant_id,(item->>'id')::uuid);
 end loop;
 return null;
end $$;
revoke all on function public.learn_assessment_receipt_constraint() from public,anon,authenticated,service_role;
create constraint trigger learn_assessment_receipt_guard after insert on public.learn_assessments
 deferrable initially deferred for each row execute function public.learn_assessment_receipt_constraint();
