-- Candidate: versioned company calendars. No source capture or score changes.
-- Publication takes effect when recorded; it cannot supply rules for earlier time.
create table public.learn_work_calendar_versions (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 revision integer not null check(revision>0), definition jsonb not null,
 actor_id uuid not null references public.profiles(id), reason text not null check(length(btrim(reason)) between 1 and 1000),
 request jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,revision),unique(tenant_id,id)
);
create table public.learn_work_calendar_publications (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 version_id uuid not null,actor_id uuid not null references public.profiles(id),
 reason text not null check(length(btrim(reason)) between 1 and 1000), request jsonb not null,
 effective_from timestamptz not null,unique(tenant_id,effective_from),unique(tenant_id,version_id),
 foreign key(tenant_id,version_id) references public.learn_work_calendar_versions(tenant_id,id)
);
alter table public.learn_work_calendar_versions enable row level security;
alter table public.learn_work_calendar_publications enable row level security;
revoke all on public.learn_work_calendar_versions,public.learn_work_calendar_publications from public,anon,authenticated,service_role;
grant select on public.learn_work_calendar_versions,public.learn_work_calendar_publications to authenticated;
create policy learn_work_calendar_versions_read on public.learn_work_calendar_versions for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create policy learn_work_calendar_publications_read on public.learn_work_calendar_publications for select to authenticated
 using(tenant_id=public.current_tenant_id() and coalesce(public.current_user_role(),'') in ('owner','admin'));
create function public.learn_work_calendar_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$begin
 raise exception 'Recorded calendars are immutable' using errcode='55000';end $$;
revoke all on function public.learn_work_calendar_immutable() from public,anon,authenticated,service_role;
create trigger learn_work_calendar_versions_immutable before update or delete on public.learn_work_calendar_versions for each row execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_versions_no_truncate before truncate on public.learn_work_calendar_versions for each statement execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_publications_immutable before update or delete on public.learn_work_calendar_publications for each row execute function public.learn_work_calendar_immutable();
create trigger learn_work_calendar_publications_no_truncate before truncate on public.learn_work_calendar_publications for each statement execute function public.learn_work_calendar_immutable();

-- Local clock intervals use minute precision, [start,end), 0..1440. Overnight
-- shifts are explicitly split between dates. An empty override is a closed day.
create function public.learn_work_calendar_validate(p_definition jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare v_window jsonb;v_exception jsonb;week jsonb;overrides jsonb;d date;begin
 if jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>262144 then
  raise exception 'Invalid company calendar' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p_definition) k where k not in ('name','timezone','weekly','exceptions'))
  or jsonb_typeof(p_definition->'name') is distinct from 'string' or length(btrim(p_definition->>'name')) not between 1 and 200
  or jsonb_typeof(p_definition->'timezone') is distinct from 'string'
  or not exists(select 1 from pg_timezone_names where name=p_definition->>'timezone' and (name='UTC' or name like '%/%') and name not like 'posix/%' and name not like 'right/%')
  or jsonb_typeof(p_definition->'weekly') is distinct from 'array'
  or jsonb_typeof(p_definition->'exceptions') is distinct from 'array' then
  raise exception 'Calendar name, named timezone, weekly hours and date overrides required' using errcode='22023';end if;
 if jsonb_array_length(p_definition->'weekly')>84 or jsonb_array_length(p_definition->'exceptions')>366 then
  raise exception 'Calendar exceeds supported limits' using errcode='54000';end if;
 for v_window in select value from jsonb_array_elements(p_definition->'weekly') loop
  if jsonb_typeof(v_window) is distinct from 'object' then raise exception 'Invalid weekly window' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(v_window) k where k not in ('day','startMinute','endMinute'))
   or jsonb_typeof(v_window->'day') is distinct from 'number' or (v_window->>'day')::numeric not between 1 and 7 or mod((v_window->>'day')::numeric,1)<>0
   or jsonb_typeof(v_window->'startMinute') is distinct from 'number' or jsonb_typeof(v_window->'endMinute') is distinct from 'number'
   or (v_window->>'startMinute')::numeric not between 0 and 1439 or mod((v_window->>'startMinute')::numeric,1)<>0
   or (v_window->>'endMinute')::numeric not between 1 and 1440 or mod((v_window->>'endMinute')::numeric,1)<>0
   or (v_window->>'startMinute')::numeric::int>=(v_window->>'endMinute')::numeric::int then raise exception 'Invalid weekly window' using errcode='22023';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_definition->'weekly') with ordinality a(w,n)
  join jsonb_array_elements(p_definition->'weekly') with ordinality b(w,n) on a.n<b.n
  where (a.w->>'day')::numeric::int=(b.w->>'day')::numeric::int and (a.w->>'startMinute')::numeric::int<(b.w->>'endMinute')::numeric::int and (b.w->>'startMinute')::numeric::int<(a.w->>'endMinute')::numeric::int) then
  raise exception 'Weekly windows overlap' using errcode='22023';end if;
 for v_exception in select value from jsonb_array_elements(p_definition->'exceptions') loop
  if jsonb_typeof(v_exception) is distinct from 'object' then raise exception 'Invalid date override' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(v_exception) k where k not in ('date','windows')) or jsonb_typeof(v_exception->'date') is distinct from 'string'
   or (v_exception->>'date')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(v_exception->'windows') is distinct from 'array' then raise exception 'Invalid date override' using errcode='22023';end if;
  begin d:=(v_exception->>'date')::date;exception when others then raise exception 'Invalid override date' using errcode='22023';end;
  if d<date '2000-01-01' or d>date '2200-12-31' or to_char(d,'YYYY-MM-DD')<>v_exception->>'date' or jsonb_array_length(v_exception->'windows')>12 then
   raise exception 'Invalid override date or window limit' using errcode='22023';end if;
  for v_window in select value from jsonb_array_elements(v_exception->'windows') loop
   if jsonb_typeof(v_window) is distinct from 'object' then raise exception 'Invalid date window' using errcode='22023';end if;
   if exists(select 1 from jsonb_object_keys(v_window) k where k not in ('startMinute','endMinute'))
    or jsonb_typeof(v_window->'startMinute') is distinct from 'number' or jsonb_typeof(v_window->'endMinute') is distinct from 'number'
    or (v_window->>'startMinute')::numeric not between 0 and 1439 or mod((v_window->>'startMinute')::numeric,1)<>0
    or (v_window->>'endMinute')::numeric not between 1 and 1440 or mod((v_window->>'endMinute')::numeric,1)<>0
    or (v_window->>'startMinute')::numeric::int>=(v_window->>'endMinute')::numeric::int then raise exception 'Invalid date window' using errcode='22023';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(v_exception->'windows') with ordinality a(w,n)
   join jsonb_array_elements(v_exception->'windows') with ordinality b(w,n) on a.n<b.n
   where (a.w->>'startMinute')::numeric::int<(b.w->>'endMinute')::numeric::int and (b.w->>'startMinute')::numeric::int<(a.w->>'endMinute')::numeric::int) then
   raise exception 'Date override windows overlap' using errcode='22023';end if;
 end loop;
 if (select count(*)<>count(distinct e->>'date') from jsonb_array_elements(p_definition->'exceptions') e) then
  raise exception 'Duplicate calendar override date' using errcode='22023';end if;
 select coalesce(jsonb_agg(w order by (w->>'day')::numeric::int,(w->>'startMinute')::numeric::int),'[]') into week from jsonb_array_elements(p_definition->'weekly') w;
 select coalesce(jsonb_agg(jsonb_build_object('date',e->>'date','windows',(select coalesce(jsonb_agg(w order by (w->>'startMinute')::numeric::int),'[]') from jsonb_array_elements(e->'windows') w)) order by e->>'date'),'[]') into overrides from jsonb_array_elements(p_definition->'exceptions') e;
 return jsonb_build_object('name',btrim(p_definition->>'name'),'timezone',p_definition->>'timezone','weekly',week,'exceptions',overrides);
end $$;
revoke all on function public.learn_work_calendar_validate(jsonb) from public,anon,authenticated,service_role;

-- Evaluate real UTC minutes in the named local clock. Repeated DST minutes count
-- twice if both are inside the schedule; nonexistent minutes never exist. This
-- avoids guessing which UTC instant an ambiguous local boundary meant.
create function public.learn_work_calendar_expand(p_definition jsonb,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql stable set search_path=public,pg_temp set timezone='UTC' as $$
declare def jsonb:=learn_work_calendar_validate(p_definition);answer jsonb;begin
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start
  or p_end-p_start>interval '366 days' or p_start<timestamptz '2000-01-01 00:00:00+00' or p_end>timestamptz '2201-01-01 00:00:00+00' then
  raise exception 'Calendar period must be finite and at most 366 days' using errcode='22023';end if;
 with weekly as materialized(select (w->>'day')::numeric::int as weekday,(w->>'startMinute')::numeric::int a,(w->>'endMinute')::numeric::int b from jsonb_array_elements(def->'weekly') w),
 overrides as materialized(select (e->>'date')::date as calendar_date,e->'windows' windows from jsonb_array_elements(def->'exceptions') e),
 minutes as materialized(select t,t at time zone (def->>'timezone') local_time from generate_series(date_trunc('minute',p_start),p_end,interval '1 minute') t where t<p_end),
 selected as (select m.t from minutes m left join overrides o on o.calendar_date=m.local_time::date
  where case when o.calendar_date is not null then exists(select 1 from jsonb_array_elements(o.windows) w where extract(hour from m.local_time)*60+extract(minute from m.local_time)>=(w->>'startMinute')::numeric::int and extract(hour from m.local_time)*60+extract(minute from m.local_time)<(w->>'endMinute')::numeric::int)
   else exists(select 1 from weekly w where w.weekday=extract(isodow from m.local_time) and extract(hour from m.local_time)*60+extract(minute from m.local_time)>=w.a and extract(hour from m.local_time)*60+extract(minute from m.local_time)<w.b) end),
 islands as (select t,t-row_number() over(order by t)*interval '1 minute' island from selected),
 windows as (select greatest(min(t),p_start) a,least(max(t)+interval '1 minute',p_end) b from islands group by island)
 select coalesce(jsonb_agg(jsonb_build_object('start',a,'end',b) order by a),'[]') into answer from windows;
 return answer;
end $$;
revoke all on function public.learn_work_calendar_expand(jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.learn_work_calendar_version_result(v public.learn_work_calendar_versions) returns jsonb
language sql stable set search_path=public,pg_temp as $$select jsonb_build_object('id',v.id,'tenantId',v.tenant_id,'revision',v.revision,'definition',v.definition,'recordedAt',v.recorded_at,'recordedBy',v.actor_id,'reason',v.reason)$$;
revoke all on function public.learn_work_calendar_version_result(public.learn_work_calendar_versions) from public,anon,authenticated,service_role;

create function public.learn_work_calendar_save(p_tenant uuid,p_expected_revision integer,p_definition jsonb,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);def jsonb:=learn_work_calendar_validate(p_definition);r learn_work_calendar_versions%rowtype;descriptor jsonb;n integer;begin
 if p_request is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Calendar revision, request and reason required' using errcode='22023';end if;
 descriptor:=jsonb_build_object('tenantId',p_tenant,'actorId',actor,'expectedRevision',p_expected_revision,'definition',def,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-request:'||p_request::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-tenant:'||p_tenant::text,0));
 select * into r from learn_work_calendar_versions where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Calendar request changed' using errcode='PT409';end if;
 else
  if exists(select 1 from learn_work_calendar_publications where id=p_request) then raise exception 'Calendar request already used' using errcode='PT409';end if;
  select coalesce(max(revision),0) into n from learn_work_calendar_versions where tenant_id=p_tenant;
  if n<>p_expected_revision then raise exception 'Calendar revision changed' using errcode='PT409';end if;
  insert into learn_work_calendar_versions(id,tenant_id,revision,definition,actor_id,reason,request)
   values(p_request,p_tenant,n+1,def,actor,btrim(p_reason),descriptor) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-calendar@1','version',learn_work_calendar_version_result(r));
end $$;
revoke all on function public.learn_work_calendar_save(uuid,integer,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_save(uuid,integer,jsonb,uuid,text) to authenticated;

create function public.learn_work_calendar_publish(p_tenant uuid,p_version uuid,p_expected_publication uuid,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;r learn_work_calendar_publications%rowtype;previous learn_work_calendar_publications%rowtype;descriptor jsonb;at_time timestamptz;begin
 if p_version is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Calendar version, request and reason required' using errcode='22023';end if;
 descriptor:=jsonb_build_object('tenantId',p_tenant,'actorId',actor,'versionId',p_version,'expectedPublication',p_expected_publication,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-request:'||p_request::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-calendar-tenant:'||p_tenant::text,0));
 select * into r from learn_work_calendar_publications where id=p_request;
 if found then
  if r.request is distinct from descriptor then raise exception 'Publication request changed' using errcode='PT409';end if;
 else
  if exists(select 1 from learn_work_calendar_versions where id=p_request) then raise exception 'Calendar request already used' using errcode='PT409';end if;
  select * into v from learn_work_calendar_versions where tenant_id=p_tenant order by revision desc limit 1;
  if v.id is distinct from p_version then raise exception 'Only the latest saved calendar may be published' using errcode='PT409';end if;
  select * into previous from learn_work_calendar_publications where tenant_id=p_tenant order by effective_from desc limit 1;
  if previous.id is distinct from p_expected_publication or exists(select 1 from learn_work_calendar_publications where tenant_id=p_tenant and version_id=p_version) then raise exception 'Published calendar changed or already active' using errcode='PT409';end if;
  at_time:=clock_timestamp();
  if previous.effective_from>=at_time then raise exception 'Calendar publication clock must advance' using errcode='55000';end if;
  insert into learn_work_calendar_publications(id,tenant_id,version_id,actor_id,reason,request,effective_from)
   values(p_request,p_tenant,p_version,actor,btrim(p_reason),descriptor,at_time) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return jsonb_build_object('contract','work-calendar-publication@1','id',r.id,'tenantId',r.tenant_id,'versionId',r.version_id,'effectiveFrom',r.effective_from,'recordedBy',r.actor_id,'reason',r.reason);
end $$;
revoke all on function public.learn_work_calendar_publish(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_publish(uuid,uuid,uuid,uuid,text) to authenticated;

create function public.learn_work_calendar_read(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;p learn_work_calendar_publications%rowtype;active_version learn_work_calendar_versions%rowtype;begin
 select * into v from learn_work_calendar_versions where tenant_id=p_tenant order by revision desc limit 1;
 select * into p from learn_work_calendar_publications where tenant_id=p_tenant order by effective_from desc limit 1;
 if p.id is not null then select * into active_version from learn_work_calendar_versions where tenant_id=p_tenant and id=p.version_id;end if;
 return jsonb_build_object('contract','work-calendar-read@1','tenantId',p_tenant,'draft',case when v.id is not null then learn_work_calendar_version_result(v) end,
  'publication',case when p.id is not null then jsonb_build_object('id',p.id,'effectiveFrom',p.effective_from,'recordedBy',p.actor_id,'reason',p.reason,'version',learn_work_calendar_version_result(active_version)) end);
end $$;
revoke all on function public.learn_work_calendar_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_read(uuid) to authenticated;

create function public.learn_work_calendar_preview(p_tenant uuid,p_version uuid,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);v learn_work_calendar_versions%rowtype;windows jsonb;begin
 select * into v from learn_work_calendar_versions where tenant_id=p_tenant and id=p_version;
 if not found then raise exception 'Saved calendar unavailable' using errcode='42501';end if;
 windows:=learn_work_calendar_expand(v.definition,p_start,p_end);
 return jsonb_build_object('contract','work-calendar-preview@1','tenantId',p_tenant,'version',learn_work_calendar_version_result(v),'simulation',true,
  'period',jsonb_build_object('start',p_start,'end',p_end),'windows',windows,
  'minutes',(select coalesce(sum(extract(epoch from (w->>'end')::timestamptz-(w->>'start')::timestamptz)/60),0) from jsonb_array_elements(windows) w));
end $$;
revoke all on function public.learn_work_calendar_preview(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_calendar_preview(uuid,uuid,timestamptz,timestamptz) to authenticated;

-- Private source for future collection integration; no saved draft or later
-- publication can silently fill historical gaps in a frozen run.
create function public.learn_work_calendar_snapshot(p_tenant uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);first_at timestamptz;r record;versions jsonb:='[]';windows jsonb:='[]';part jsonb;n integer:=0;begin
 if p_observed is null or not isfinite(p_observed) or p_observed>clock_timestamp() or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_end<=p_start or p_end>p_observed or p_end-p_start>interval '366 days' then raise exception 'Invalid calendar snapshot period' using errcode='22023';end if;
 select min(effective_from) into first_at from learn_work_calendar_publications where tenant_id=p_tenant and effective_from<=p_observed;
 for r in with history as (select p.*,lead(effective_from) over(order by effective_from) next_at from learn_work_calendar_publications p where tenant_id=p_tenant and effective_from<=p_observed)
  select h.*,v.definition,v.revision,greatest(h.effective_from,p_start) start_at,least(coalesce(h.next_at,p_end),p_end) end_at
   from history h join learn_work_calendar_versions v on v.tenant_id=p_tenant and v.id=h.version_id
   where h.effective_from<p_end and coalesce(h.next_at,p_end)>p_start order by h.effective_from loop
  n:=n+1;if n>100 then raise exception 'Calendar publication history exceeds supported limit' using errcode='54000';end if;
  part:=learn_work_calendar_expand(r.definition,r.start_at,r.end_at);
  versions:=versions||jsonb_build_array(jsonb_build_object('publicationId',r.id,'versionId',r.version_id,'revision',r.revision,'definition',r.definition,
   'effectiveFrom',r.effective_from,'start',r.start_at,'end',r.end_at,'recordedBy',r.actor_id,'reason',r.reason));
  windows:=windows||part;
 end loop;
 return jsonb_build_object('contract','work-calendar-snapshot@1','tenantId',p_tenant,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'complete',coalesce(first_at<=p_start,false),
  'missing',case when first_at is null or first_at>p_start then jsonb_build_array(jsonb_build_object('start',p_start,'end',least(coalesce(first_at,p_end),p_end))) else '[]'::jsonb end,
  'versions',versions,'windows',windows);
end $$;
revoke all on function public.learn_work_calendar_snapshot(uuid,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
