-- Private deterministic calculation over frozen inputs. No public RPC, writes,
-- new authority or change to elapsed-residence semantics is introduced here.
create function public.learn_working_time_ranges(p_windows jsonb,p_start timestamptz,p_end timestamptz)
returns tstzmultirange language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare w jsonb;a timestamptz;b timestamptz;answer tstzmultirange;begin
 if jsonb_typeof(p_windows) is distinct from 'array' or p_start is null or p_end is null
  or not isfinite(p_start) or not isfinite(p_end) or p_start>=p_end then
  raise exception 'Invalid working-time windows' using errcode='22023';end if;
 if jsonb_array_length(p_windows)>10000 then raise exception 'Working-time windows exceed review bound' using errcode='54000';end if;
 for w in select value from jsonb_array_elements(p_windows) loop
  if jsonb_typeof(w) is distinct from 'object' or not(w ?& array['start','end'])
   or exists(select 1 from jsonb_object_keys(w) k where k not in ('start','end'))
   or jsonb_typeof(w->'start') is distinct from 'string' or jsonb_typeof(w->'end') is distinct from 'string'
   or (w->>'start')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
   or (w->>'end')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise exception 'Invalid working-time boundary' using errcode='22023';end if;
  a:=(w->>'start')::timestamptz;b:=(w->>'end')::timestamptz;
  if not isfinite(a) or not isfinite(b) or a>=b or a<p_start or b>p_end then
   raise exception 'Working-time window is outside its period' using errcode='22023';end if;
 end loop;
 select coalesce(range_agg(tstzrange((v->>'start')::timestamptz,(v->>'end')::timestamptz,'[)')),'{}'::tstzmultirange)
 into answer from jsonb_array_elements(p_windows) v;
 return answer;
end $$;
create function public.learn_working_time_windows(p_ranges tstzmultirange) returns jsonb
language sql immutable set search_path=public,pg_temp set timezone='UTC' as $$
 select coalesce(jsonb_agg(jsonb_build_object('start',lower(r),'end',upper(r)) order by lower(r)),'[]') from unnest(p_ranges) r;
$$;
create function public.learn_working_time_micros(p_ranges tstzmultirange) returns numeric
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(sum(extract(epoch from upper(r)-lower(r))*1000000),0) from unnest(p_ranges) r;
$$;

create function public.learn_working_time_calculate(
 p_tenant uuid,p_kind text,p_subject uuid,p_history jsonb,p_roster jsonb,p_teams jsonb,
 p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_first_kind text,
 p_states jsonb,p_calendar jsonb,p_delay jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare object_id uuid;v jsonb;segment jsonb;segments jsonb:='[]';base jsonb;answer jsonb;states jsonb;
 whole tstzmultirange;calendar_ranges tstzmultirange;calendar_coverage tstzmultirange;missing_ranges tstzmultirange;
 delay_ranges tstzmultirange;approval_ranges tstzmultirange;owned tstzmultirange:='{}';selected_owned tstzmultirange:='{}';
 span tstzmultirange;business tstzmultirange;excluded tstzmultirange;assessed tstzmultirange;
 all_business tstzmultirange:='{}';all_excluded tstzmultirange:='{}';all_assessed tstzmultirange:='{}';
 is_selected boolean;ownership_complete boolean;calendar_complete boolean;complete boolean;eligible boolean;
 raw_micros numeric:=0;owned_micros numeric;selected_micros numeric;business_micros numeric;excluded_micros numeric;assessed_micros numeric;
 reasons jsonb:='[]';period jsonb;
begin
 if p_tenant is null or p_subject is null or p_kind is null or p_kind not in ('member','team')
  or p_start is null or p_end is null or p_observed is null or not isfinite(p_start) or not isfinite(p_end) or not isfinite(p_observed)
  or p_start>=p_end or p_end>p_observed or p_end-p_start>interval '366 days'
  or (p_first_kind is not null and p_first_kind not in ('insert','baseline')) then
  raise exception 'Invalid working-time calculation scope' using errcode='22023';end if;
 if jsonb_typeof(p_states) is distinct from 'array' then raise exception 'Explicit work states required' using errcode='22023';end if;
 if jsonb_array_length(p_states) not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_states) s
  where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 200 or btrim(s#>>'{}') is distinct from s#>>'{}')
  or (select count(distinct value)<>count(*) from jsonb_array_elements(p_states)) then
  raise exception 'Choose unique explicit work states' using errcode='22023';end if;
 select jsonb_agg(value order by value) into states from jsonb_array_elements(p_states);
 object_id:=(p_history->>'objectId')::uuid;
 if object_id is null or jsonb_typeof(p_history->'events') is distinct from 'array'
  or jsonb_array_length(p_history->'events') is distinct from (p_history->>'count')::int
  or jsonb_typeof(p_roster->'members') is distinct from 'array' or p_roster->>'contract' is distinct from 'member-capture@1'
  or p_roster->>'tenantId' is distinct from p_tenant::text
  or (p_roster#>>'{period,start}')::timestamptz is distinct from p_start or (p_roster#>>'{period,end}')::timestamptz is distinct from p_end
  or (p_roster->>'observedAt')::timestamptz is distinct from p_observed or jsonb_typeof(p_teams) is distinct from 'array' then
  raise exception 'Frozen ownership scope differs from calculation' using errcode='22023';end if;
 if jsonb_array_length(p_history->'events')>1000 or octet_length(p_roster::text)>2097152 or octet_length(p_teams::text)>2097152 then
  raise exception 'Frozen ownership exceeds calculation bound' using errcode='54000';end if;
 if p_history->>'sourceThrough' is not null and ((p_history->>'sourceThrough')::timestamptz<p_end or (p_history->>'sourceThrough')::timestamptz>p_observed) then
  raise exception 'Ownership capture does not cover the calculation observation' using errcode='22023';end if;
 period:=jsonb_build_object('start',p_start,'end',p_end);whole:=tstzmultirange(tstzrange(p_start,p_end,'[)'));
 for v in select x from (values(p_calendar),(p_delay)) as snapshots(x) loop
  if v->>'tenantId' is distinct from p_tenant::text or (v->>'observedAt')::timestamptz is distinct from p_observed
   or (v#>>'{period,start}')::timestamptz is distinct from p_start or (v#>>'{period,end}')::timestamptz is distinct from p_end then
   raise exception 'Working-time snapshot scope differs from calculation' using errcode='22023';end if;
 end loop;
 if p_calendar->>'contract' is distinct from 'work-calendar-snapshot@1'
  or jsonb_typeof(p_calendar->'complete') is distinct from 'boolean' or jsonb_typeof(p_calendar->'versions') is distinct from 'array'
  or p_delay->>'contract' is distinct from 'work-delay-snapshot@1' or p_delay->>'objectId' is distinct from object_id::text
  or jsonb_typeof(p_delay->'approvals') is distinct from 'array' or (p_delay->>'through')!~'^\d+$' or p_delay->>'through' is null then
  raise exception 'Invalid calendar or delay snapshot' using errcode='22023';end if;
 if jsonb_array_length(p_calendar->'versions')>100 or jsonb_array_length(p_delay->'approvals')>1000 then
  raise exception 'Working-time snapshot exceeds review bound' using errcode='54000';end if;
 calendar_ranges:=learn_working_time_ranges(p_calendar->'windows',p_start,p_end);
 calendar_coverage:=learn_working_time_ranges((select coalesce(jsonb_agg(jsonb_build_object('start',x->'start','end',x->'end')),'[]') from jsonb_array_elements(p_calendar->'versions') x),p_start,p_end);
 missing_ranges:=learn_working_time_ranges(p_calendar->'missing',p_start,p_end);
 calendar_complete:=(p_calendar->>'complete')::boolean;
 if missing_ranges is distinct from whole-calendar_coverage or calendar_complete is distinct from (missing_ranges='{}'::tstzmultirange)
  or calendar_ranges-calendar_coverage<>'{}'::tstzmultirange
  or (select coalesce(sum(extract(epoch from (x->>'end')::timestamptz-(x->>'start')::timestamptz)*1000000),0) from jsonb_array_elements(p_calendar->'versions') x)
   <>learn_working_time_micros(calendar_coverage)
  or (select count(distinct value->>'publicationId')<>count(*) from jsonb_array_elements(p_calendar->'versions')) then
  raise exception 'Calendar coverage is inconsistent' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_calendar->'versions') loop
  if not(v ?& array['publicationId','versionId','revision','effectiveFrom','start','end','definition'])
   or v->>'revision' is null or v->>'effectiveFrom' is null or (v->>'publicationId')::uuid is null or (v->>'versionId')::uuid is null or (v->>'revision')::int<1
   or (v->>'effectiveFrom')::timestamptz>(v->>'start')::timestamptz or jsonb_typeof(v->'definition') is distinct from 'object' then
   raise exception 'Invalid retained calendar version' using errcode='22023';end if;
 end loop;
 delay_ranges:=learn_working_time_ranges(p_delay->'windows',p_start,p_end);
 if (select count(distinct value->>'id')<>count(*) or count(distinct value->>'revision')<>count(*) from jsonb_array_elements(p_delay->'approvals')) then
  raise exception 'Repeated delay approval' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_delay->'approvals') loop
  if not(v ?& array['tenantId','objectId','decision','id','revision','recordedAt','period'])
   or v->>'revision' is null or v->>'recordedAt' is null or v#>>'{period,start}' is null or v#>>'{period,end}' is null
   or v->>'tenantId' is distinct from p_tenant::text or v->>'objectId' is distinct from object_id::text or v->>'decision' is distinct from 'approve'
   or (v->>'id')::uuid is null or (v->>'revision')::int not between 1 and (p_delay->>'through')::int
   or (v->>'recordedAt')::timestamptz>p_observed or (v#>>'{period,start}')::timestamptz>=(v#>>'{period,end}')::timestamptz
   or (v#>>'{period,end}')::timestamptz>(v->>'recordedAt')::timestamptz
   or (v#>>'{period,start}')::timestamptz>=p_end or (v#>>'{period,end}')::timestamptz<=p_start then
   raise exception 'Unrelated or invalid delay approval' using errcode='22023';end if;
 end loop;
 approval_ranges:=learn_working_time_ranges((select coalesce(jsonb_agg(jsonb_build_object('start',greatest(p_start,(x#>>'{period,start}')::timestamptz),
  'end',least(p_end,(x#>>'{period,end}')::timestamptz))),'[]') from jsonb_array_elements(p_delay->'approvals') x),p_start,p_end);
 if delay_ranges is distinct from approval_ranges then raise exception 'Delay windows differ from retained approvals' using errcode='22023';end if;
 base:=learn_work_collection_calculate(case p_kind when 'member' then 'residence' else 'teamResidence' end,
  p_subject,p_history,p_roster,p_teams,p_start,p_end,p_first_kind);
 eligible:=(base->>'eligible')::boolean;
 ownership_complete:=coalesce((base->>'complete')::boolean,false) and (not eligible or p_history->>'sourceThrough' is not null);
 for segment in select value from jsonb_array_elements(base->'credited') loop
  span:=learn_working_time_ranges(jsonb_build_array(jsonb_build_object('start',segment->'start','end',segment->'end')),p_start,p_end);
  raw_micros:=raw_micros+learn_working_time_micros(span);owned:=owned+span;
  is_selected:=states ? (segment->>'status');
  business:='{}';excluded:='{}';assessed:='{}';
  if is_selected then
   selected_owned:=selected_owned+span;business:=span*calendar_ranges;excluded:=business*delay_ranges;assessed:=business-delay_ranges;
   all_business:=all_business+business;all_excluded:=all_excluded+excluded;all_assessed:=all_assessed+assessed;
  end if;
  segments:=segments||jsonb_build_array(jsonb_build_object('ownership',segment,'selectedState',is_selected,
   'calendarWindows',learn_working_time_windows(business),'excludedWindows',learn_working_time_windows(excluded),'assessedWindows',learn_working_time_windows(assessed)));
 end loop;
 owned_micros:=learn_working_time_micros(owned);selected_micros:=learn_working_time_micros(selected_owned);
 business_micros:=learn_working_time_micros(all_business);excluded_micros:=learn_working_time_micros(all_excluded);assessed_micros:=learn_working_time_micros(all_assessed);
 if owned_micros<>raw_micros or business_micros<>excluded_micros+assessed_micros then
  raise exception 'Working-time segments overlap or do not reconcile' using errcode='55000';end if;
 complete:=ownership_complete and (calendar_complete or not eligible);
 if not ownership_complete then reasons:=reasons||'"ownership_history_incomplete"'::jsonb;end if;
 if not calendar_complete and eligible then reasons:=reasons||'"calendar_history_incomplete"'::jsonb;end if;
 answer:=jsonb_build_object('contract','work-working-time-item@1','tenantId',p_tenant,'objectId',object_id,'subject',jsonb_build_object('kind',p_kind,'id',p_subject),
  'period',period,'observedAt',p_observed,'states',states,'eligible',eligible,'complete',complete,'reasons',reasons,
  'ownershipComplete',ownership_complete,'calendarComplete',calendar_complete,'unit','working_item_minutes',
  'elapsedOwnedMicros',trunc(owned_micros)::text,'selectedOwnedMicros',trunc(selected_micros)::text,
  'calendarMicros',trunc(business_micros)::text,'excludedMicros',trunc(excluded_micros)::text,'assessedMicros',trunc(assessed_micros)::text,
  'knownValue',round(assessed_micros/60000000,12),'value',case when complete then round(assessed_micros/60000000,12) end,
  'delayThrough',(p_delay->>'through')::int,'delayApprovalIds',(select coalesce(jsonb_agg(x->'id' order by (x->>'revision')::int),'[]') from jsonb_array_elements(p_delay->'approvals') x),
  'calendarPublicationIds',(select coalesce(jsonb_agg(x->'publicationId' order by (x->>'start')::timestamptz),'[]') from jsonb_array_elements(p_calendar->'versions') x),
  'eventIds',base->'eventIds','segments',segments);
 if octet_length(answer::text)>2097152 then raise exception 'Working-time item proof exceeds review bound' using errcode='54000';end if;
 return answer;
end $$;
revoke all on function public.learn_working_time_ranges(jsonb,timestamptz,timestamptz),
 public.learn_working_time_windows(tstzmultirange),public.learn_working_time_micros(tstzmultirange),
 public.learn_working_time_calculate(uuid,text,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz,text,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
