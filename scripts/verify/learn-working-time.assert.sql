-- Independent, fixed-clock synthetic arithmetic and attribution fixtures.
create table working_time_fixture as
with ids as (select 'aaa40000-0000-0000-0000-000000000004'::uuid tenant,
 'ccc40000-0000-0000-0000-000000000041'::uuid member,
 '11110000-0000-4000-8000-000000000001'::uuid team_a,
 '11110000-0000-4000-8000-000000000002'::uuid team_b,
 'de1a0000-0000-4000-8000-000000000001'::uuid object_id),
 settings as (select *, '2026-10-05T08:00:00Z'::timestamptz starts,'2026-10-05T18:00:00Z'::timestamptz ends,
 '2026-10-06T00:00:00Z'::timestamptz observed from ids),
 state as (select *,jsonb_build_object('status','ready','version',1,'responsible_ref',jsonb_build_object('kind','member','ref',member),'accountable_ref',null,'waiting_on_ref',null,'attributes','{}'::jsonb) work,
 jsonb_build_object('profileId','bbb40000-0000-0000-0000-000000000004','teamId',team_a,'effectiveFrom','2026-01-01T00:00:00Z','effectiveTo',null,'confirmedAt','2026-01-01T00:00:00Z') membership from settings)
select *,
 jsonb_build_object('objectId',object_id,'coverageStart',starts,'sourceThrough',observed,'count',4,'events',jsonb_build_array(
 jsonb_build_object('id','11000000-0000-4000-8000-000000000001','sequence','1','kind','baseline','occurredAt',starts,'before',work,'after',work),
 jsonb_build_object('id','11000000-0000-4000-8000-000000000002','sequence','2','kind','update','occurredAt','2026-10-05T10:00:00Z','before',work,'after',work||'{"status":"waiting","version":2}'),
 jsonb_build_object('id','11000000-0000-4000-8000-000000000003','sequence','3','kind','update','occurredAt','2026-10-05T13:00:00Z','before',work||'{"status":"waiting","version":2}','after',work||'{"status":"closed","version":3}'),
 jsonb_build_object('id','11000000-0000-4000-8000-000000000004','sequence','4','kind','update','occurredAt','2026-10-05T14:00:00Z','before',work||'{"status":"closed","version":3}','after',work||'{"version":4}')
 )) history,
 jsonb_build_object('contract','member-capture@1','tenantId',tenant,'period',jsonb_build_object('start',starts,'end',ends),'observedAt',observed,'count',1,'members',jsonb_build_array(
 jsonb_build_object('memberId',member,'coverageStart',starts,'firstKind','baseline','sourceThrough',observed,'count',2,'events',jsonb_build_array(
 jsonb_build_object('id','12000000-0000-4000-8000-000000000001','sequence','1','kind','baseline','observedAt',starts,'before',membership,'after',membership),
 jsonb_build_object('id','12000000-0000-4000-8000-000000000002','sequence','2','kind','update','observedAt','2026-10-05T12:00:00Z','before',membership,'after',membership||jsonb_build_object('teamId',team_b))
 )))) roster,
 jsonb_build_array(jsonb_build_object('id',team_a,'createdAt','2026-01-01T00:00:00Z'),jsonb_build_object('id',team_b,'createdAt','2026-01-01T00:00:00Z')) teams,
 jsonb_build_object('contract','work-calendar-snapshot@1','tenantId',tenant,'period',jsonb_build_object('start',starts,'end',ends),'observedAt',observed,'complete',true,'missing','[]'::jsonb,
 'versions',jsonb_build_array(jsonb_build_object('publicationId','13000000-0000-4000-8000-000000000001','versionId','13000000-0000-4000-8000-000000000002','revision',1,
 'effectiveFrom','2026-10-01T00:00:00Z','start',starts,'end',ends,'definition',jsonb_build_object('name','Split office hours','timezone','UTC','weekly',jsonb_build_array(
 jsonb_build_object('day',1,'startMinute',540,'endMinute',720),jsonb_build_object('day',1,'startMinute',780,'endMinute',1020)),'exceptions','[]'::jsonb))),
 'windows','[{"start":"2026-10-05T09:00:00Z","end":"2026-10-05T12:00:00Z"},{"start":"2026-10-05T13:00:00Z","end":"2026-10-05T17:00:00Z"}]'::jsonb) calendar,
 jsonb_build_object('contract','work-delay-snapshot@1','tenantId',tenant,'objectId',object_id,'period',jsonb_build_object('start',starts,'end',ends),'observedAt',observed,'through',3,
 'approvals',(select jsonb_agg(jsonb_build_object('id','14000000-0000-4000-8000-'||lpad(n::text,12,'0'),'tenantId',tenant,'objectId',object_id,'revision',n,'decision','approve',
 'period',p,'recordedAt',observed)) from (values(1,'{"start":"2026-10-05T09:30:00Z","end":"2026-10-05T10:30:00Z"}'::jsonb),(2,'{"start":"2026-10-05T10:00:00Z","end":"2026-10-05T11:00:00Z"}'::jsonb),(3,'{"start":"2026-10-05T12:00:00Z","end":"2026-10-05T14:30:00Z"}'::jsonb)) x(n,p)),
 'windows','[{"start":"2026-10-05T09:30:00Z","end":"2026-10-05T11:00:00Z"},{"start":"2026-10-05T12:00:00Z","end":"2026-10-05T14:30:00Z"}]'::jsonb) delays
from state;
create table working_time_results(name text primary key,result jsonb,calendar jsonb,delays jsonb);
do $$declare f working_time_fixture%rowtype;r jsonb;a jsonb;b jsonb;h jsonb;c jsonb;d jsonb;m jsonb;s timestamptz;e timestamptz;bad jsonb;role_name text;fn record;begin
 select * into f from working_time_fixture;
 r:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 assert r->>'complete'='true' and (r->>'value')::numeric=240,'Member: 360 open-hours selected minutes less 120 approved minutes';
 assert (r->>'elapsedOwnedMicros')::numeric=600*60000000::numeric;
 assert (r->>'selectedOwnedMicros')::numeric=540*60000000::numeric;
 assert (r->>'calendarMicros')::numeric=360*60000000::numeric;
 assert (r->>'excludedMicros')::numeric=120*60000000::numeric,'Overlap excluded once, lunch and closed state excluded from delay subtotal';
 insert into working_time_results(name,result) values('member',r);
 a:=learn_working_time_calculate(f.tenant,'team',f.team_a,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["waiting","ready"]',f.calendar,f.delays);
 b:=learn_working_time_calculate(f.tenant,'team',f.team_b,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 assert (a->>'value')::numeric=90 and (b->>'value')::numeric=150,'Team move splits attribution at observed membership boundary';
 assert (a->>'value')::numeric+(b->>'value')::numeric=(r->>'value')::numeric;
 insert into working_time_results(name,result) values('team-a',a),('team-b',b);
 -- Later reversals yield a new snapshot. Replaying frozen inputs stays identical.
 d:=f.delays||'{"through":6,"approvals":[],"windows":[]}';
 a:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,d);
 assert (a->>'value')::numeric=360 and a->>'excludedMicros'='0';
 assert r=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 insert into working_time_results(name,result,calendar,delays) values('reversed-delays',a,f.calendar,d);
 c:=f.calendar||'{"windows":[]}';
 a:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',c,f.delays);
 assert a->>'complete'='true' and (a->>'value')::numeric=0,'Explicitly closed calendar is known zero';
 c:=f.calendar||jsonb_build_object('complete',false,'versions','[]'::jsonb,'windows','[]'::jsonb,'missing',jsonb_build_array(jsonb_build_object('start',f.starts,'end',f.ends)));
 a:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',c,f.delays);
 assert a->>'complete'='false' and a->'value'='null' and a->'reasons' ? 'calendar_history_incomplete','Absent calendar cannot become zero';
 insert into working_time_results(name,result,calendar,delays) values('missing-calendar',a,c,f.delays);
 h:=f.history||jsonb_build_object('coverageStart',null,'sourceThrough',null,'count',0,'events','[]'::jsonb);
 a:=learn_working_time_calculate(f.tenant,'member',f.member,h,f.roster,f.teams,f.starts,f.ends,f.observed,null,'["ready"]',f.calendar,f.delays);
 assert a->>'complete'='false' and a->'value'='null' and a->'reasons' ? 'ownership_history_incomplete';
 insert into working_time_results(name,result) values('missing-work',a);
 h:=f.history||jsonb_build_object('coverageStart',f.ends,'sourceThrough',f.observed,'count',0,'events','[]'::jsonb);
 a:=learn_working_time_calculate(f.tenant,'member',f.member,h,f.roster,f.teams,f.starts,f.ends,f.observed,'insert','["ready"]',c,f.delays);
 assert a->>'eligible'='false' and a->>'complete'='true' and (a->>'value')::numeric=0,'Newly inserted after period is not missing prior work';
 -- Partial histories keep known arithmetic but never publish it as complete.
 h:=f.history||jsonb_build_object('coverageStart','2026-10-05T09:00:00Z','events',
  jsonb_set(f.history->'events','{0,occurredAt}','"2026-10-05T09:00:00Z"'));
 a:=learn_working_time_calculate(f.tenant,'member',f.member,h,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 assert a->>'complete'='false' and a->'value'='null' and (a->>'knownValue')::numeric=240;
 insert into working_time_results(name,result) values('partial-work',a);
 c:=f.calendar||jsonb_build_object('complete',false,
  'missing','[{"start":"2026-10-05T08:00:00Z","end":"2026-10-05T10:00:00Z"}]'::jsonb,
  'versions',jsonb_build_array((f.calendar->'versions'->0)||'{"start":"2026-10-05T10:00:00Z","effectiveFrom":"2026-10-05T10:00:00Z"}'),
  'windows',jsonb_set(f.calendar->'windows','{0,start}','"2026-10-05T10:00:00Z"'));
 a:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',c,f.delays);
 assert a->>'complete'='false' and a->'value'='null' and (a->>'knownValue')::numeric=210;
 insert into working_time_results(name,result,calendar,delays) values('partial-calendar',a,c,f.delays);
 -- Ambiguous user/member identities withhold, and cannot inflate a team result.
 m:=jsonb_set(f.roster,'{members}',(f.roster->'members')||(f.roster->'members'));
 a:=learn_working_time_calculate(f.tenant,'member',f.member,f.history,m,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 assert a->>'complete'='false' and a->'value'='null';
 begin
  c:=f.calendar||jsonb_build_object('versions',(f.calendar->'versions')||jsonb_build_array((f.calendar->'versions'->0)||'{"publicationId":"13000000-0000-4000-8000-000000000009"}'));
  perform learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready"]',c,f.delays);
  raise exception 'Overlapping publications admitted';exception when invalid_parameter_value then null;
 end;
 begin
  d:=f.delays||jsonb_build_object('approvals',(f.delays->'approvals')||jsonb_build_array((f.delays->'approvals'->0)||'{"id":"14000000-0000-4000-8000-000000000009"}'));
  perform learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready"]',f.calendar,d);
  raise exception 'Repeated delay revision admitted';exception when invalid_parameter_value then null;
 end;
 -- Native team assignment counts each segment once without adding member scores.
 select f.history||jsonb_build_object('events',jsonb_agg(jsonb_set(jsonb_set(v,'{before,responsible_ref}',jsonb_build_object('kind','org_unit','ref',f.team_a)),'{after,responsible_ref}',jsonb_build_object('kind','org_unit','ref',f.team_a)))) into h from jsonb_array_elements(f.history->'events') v;
 a:=learn_working_time_calculate(f.tenant,'team',f.team_a,h,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready","waiting"]',f.calendar,f.delays);
 assert (a->>'value')::numeric=240;
 insert into working_time_results(name,result) values('direct-team',a);
 -- A five-microsecond assessed window must remain positive and exact.
 s:='2026-10-05T09:00:00.000001Z';e:='2026-10-05T09:00:00.000010Z';
 h:=f.history||jsonb_build_object('count',1,'events',jsonb_build_array(f.history->'events'->0));
 m:=f.roster||jsonb_build_object('period',jsonb_build_object('start',s,'end',e));
 c:=f.calendar||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'windows',jsonb_build_array(jsonb_build_object('start',s,'end',e)),
 'versions',jsonb_build_array((f.calendar->'versions'->0)||jsonb_build_object('start',s,'end',e)));
 d:=f.delays||jsonb_build_object('through',1,'period',jsonb_build_object('start',s,'end',e),'windows','[{"start":"2026-10-05T09:00:00.000003Z","end":"2026-10-05T09:00:00.000007Z"}]'::jsonb,
 'approvals',jsonb_build_array((f.delays->'approvals'->0)||'{"period":{"start":"2026-10-05T09:00:00.000003Z","end":"2026-10-05T09:00:00.000007Z"}}'));
 a:=learn_working_time_calculate(f.tenant,'member',f.member,h,m,f.teams,s,e,f.observed,'baseline','["ready"]',c,d);
 assert a->>'assessedMicros'='5' and a->>'excludedMicros'='4' and (a->>'value')::numeric=0.000000083333;
 insert into working_time_results(name,result,calendar,delays) values('microseconds',a,c,d);
 update working_time_results set calendar=coalesce(calendar,f.calendar),delays=coalesce(delays,f.delays);
 -- State selection is explicit, bounded, not inferred from a waiting status.
 foreach bad in array array['[]'::jsonb,'["ready","ready"]','[" ready"]','[true]','{}'] loop
  begin perform learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline',bad,f.calendar,f.delays);
   raise exception 'Invalid states admitted';exception when invalid_parameter_value then null;end;
 end loop;
 foreach bad in array array[f.calendar||'{"tenantId":"aaa40000-0000-0000-0000-000000000006"}',f.calendar||'{"complete":false}',
  f.calendar||'{"missing":[{"start":"2026-10-05T08:00:00Z","end":"2026-10-05T09:00:00Z"}]}',f.calendar||'{"observedAt":"2026-10-07T00:00:00Z"}',
  f.calendar||'{"windows":[{"start":"2026-10-05T07:00:00Z","end":"2026-10-05T09:00:00Z"}]}'] loop
  begin perform learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready"]',bad,f.delays);
   raise exception 'Invalid calendar admitted';exception when invalid_parameter_value then null;end;
 end loop;
 foreach bad in array array[f.delays||'{"objectId":"de1a0000-0000-4000-8000-000000000002"}',f.delays||'{"windows":[]}',
  f.delays||'{"through":0}',f.delays||jsonb_build_object('approvals',(f.delays->'approvals')||jsonb_build_array(f.delays->'approvals'->0))] loop
  begin perform learn_working_time_calculate(f.tenant,'member',f.member,f.history,f.roster,f.teams,f.starts,f.ends,f.observed,'baseline','["ready"]',f.calendar,bad);
   raise exception 'Invalid delays admitted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform learn_working_time_ranges('[{"start":"2026-10-05T08:00:00.0000001Z","end":"2026-10-05T09:00:00Z"}]',f.starts,f.ends);
  raise exception 'Sub-microsecond boundary admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_working_time_ranges((select jsonb_agg(jsonb_build_object('start',f.starts,'end',f.ends)) from generate_series(1,10001)),f.starts,f.ends);
  raise exception 'Oversize windows admitted';exception when program_limit_exceeded then null;end;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'learn_working_time_%' loop
   assert not has_function_privilege(role_name,fn.oid,'EXECUTE'),'Calculation helpers must stay private';
  end loop;
 end loop;
end $$;
-- Existing receipt/capture fingerprints remain unchanged by this private calculator.
do $$begin
 assert (select measurements=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from measurements x) from delay_before);
 assert (select runs=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_collection_runs x) from delay_before);
 assert (select calendars=(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from learn_work_calendar_versions x) from delay_before);
 assert (select history=(select md5(string_agg(to_jsonb(x)::text,'' order by capture_sequence)) from object_state_history x) from delay_source_before);
end $$;
-- Calendar compiler -> frozen working-time calculation across a repeated local hour.
do $$declare f working_time_fixture%rowtype;s timestamptz;e timestamptz;observed timestamptz;def jsonb;c jsonb;d jsonb;h jsonb;m jsonb;r jsonb;begin
 select * into f from working_time_fixture;
 s:='2026-11-01T00:00:00Z';e:='2026-11-01T12:00:00Z';observed:='2026-11-02T00:00:00Z';
 def:='{"name":"Sunday repeated hour","timezone":"America/New_York","weekly":[{"day":7,"startMinute":60,"endMinute":120}],"exceptions":[]}';
 h:=f.history||jsonb_build_object('count',1,'events',jsonb_build_array(f.history->'events'->3),'sourceThrough',observed);
 m:=f.roster||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed);
 c:=f.calendar||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed,'windows',learn_work_calendar_expand(def,s,e),
  'versions',jsonb_build_array((f.calendar->'versions'->0)||jsonb_build_object('start',s,'end',e,'definition',def)));
 d:=f.delays||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed,'through',0,'approvals','[]'::jsonb,'windows','[]'::jsonb);
 r:=learn_working_time_calculate(f.tenant,'member',f.member,h,m,f.teams,s,e,observed,'baseline','["ready"]',c,d);
 assert (r->>'value')::numeric=120,'Both occurrences of the eligible local hour count';
 insert into working_time_results values('dst-fold',r,c,d);
 s:='2027-03-28T00:00:00Z';e:='2027-03-28T12:00:00Z';observed:='2027-03-29T00:00:00Z';
 def:=def||'{"name":"Sunday skipped hour","timezone":"Europe/London"}';
 h:=h||jsonb_build_object('sourceThrough',observed);m:=m||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed);
 c:=c||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed,'windows',learn_work_calendar_expand(def,s,e),
  'versions',jsonb_build_array((c->'versions'->0)||jsonb_build_object('start',s,'end',e,'definition',def)));
 d:=d||jsonb_build_object('period',jsonb_build_object('start',s,'end',e),'observedAt',observed);
 r:=learn_working_time_calculate(f.tenant,'member',f.member,h,m,f.teams,s,e,observed,'baseline','["ready"]',c,d);
 assert r->>'complete'='true' and (r->>'value')::numeric=0,'Skipped local hour contains no real eligible minutes';
 insert into working_time_results values('dst-gap',r,c,d);
end $$;
-- Actual retained capture and snapshot readers also feed the private calculation.
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';
do $$declare f delay_fixture%rowtype;i learn_work_collection_items%rowtype;m jsonb;c jsonb;d jsonb;teams jsonb;h jsonb;r jsonb;begin
 select * into f from delay_fixture;
 i.tenant_id:='aaa40000-0000-0000-0000-000000000004';i.object_id:='de1a0000-0000-4000-8000-000000000001';i.head_reconciled:=true;
 select capture_sequence into i.head_sequence from object_state_history where tenant_id=i.tenant_id and object_id=i.object_id and capture_kind is not null order by capture_sequence desc limit 1;
 select capture_kind,occurred_at into i.first_kind,i.first_at from object_state_history where tenant_id=i.tenant_id and object_id=i.object_id and capture_kind is not null order by capture_sequence limit 1;
 h:=learn_work_collection_history(i,f.starts,f.ends,statement_timestamp());
 m:=learn_member_history_read(i.tenant_id,f.starts,f.ends);
 c:=learn_work_calendar_snapshot(i.tenant_id,f.starts,f.ends,statement_timestamp());
 d:=learn_work_delay_snapshot(i.tenant_id,i.object_id,f.starts,f.ends,statement_timestamp());
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at)),'[]') into teams from org_units where tenant_id=i.tenant_id;
 r:=learn_working_time_calculate(i.tenant_id,'member','ccc40000-0000-0000-0000-000000000041',h,m,teams,f.starts,f.ends,statement_timestamp(),i.first_kind,'["waiting","ready"]',c,d);
 assert r->>'contract'='work-working-time-item@1' and r->>'excludedMicros'='0','Reversed actual approvals must not exclude time';
 assert (r->>'assessedMicros')::numeric+(r->>'excludedMicros')::numeric=(r->>'calendarMicros')::numeric;
end $$;
