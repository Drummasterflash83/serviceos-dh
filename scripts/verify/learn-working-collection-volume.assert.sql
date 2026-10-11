-- Actual capture at a company-sized population; no customer/provider records.
update team_members set org_unit_id='ccc50000-0000-4000-8000-000000000001' where id='ddd50000-0000-4000-8000-000000000001';
create table working_volume_fixture(starts timestamptz,ends timestamptz,expected_micros numeric);
insert into working_volume_fixture(starts) values(clock_timestamp());
grant select on working_volume_fixture to authenticated;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref)
 select ('eee50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'aaa50000-0000-4000-8000-000000000001',
 'serviceos','Action','action','Synthetic company-volume work','waiting',
 '{"kind":"member","ref":"ddd50000-0000-4000-8000-000000000001"}'::jsonb from generate_series(207,14500) n;
update working_volume_fixture set ends=clock_timestamp();
-- Only 204 (unassigned/closed) and 206 (never assigned) have no ownership in
-- this new period. Existing approvals concern an earlier, nonoverlapping period.
update working_volume_fixture f set expected_micros=(select sum(extract(epoch from(f.ends-greatest(f.starts,h.occurred_at)))*1000000)
 from object_state_history h where h.tenant_id='aaa50000-0000-4000-8000-000000000001' and h.capture_kind='insert'
 and h.object_id not in ('eee50000-0000-4000-8000-000000000204','eee50000-0000-4000-8000-000000000206'));
set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
select learn_work_collection_begin('aaa50000-0000-4000-8000-000000000001','workingTime','ddd50000-0000-4000-8000-000000000001',
 (p.member_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000041','Synthetic company-volume member') from working_volume_fixture f cross join working_collection_fixture p;
select learn_work_collection_begin('aaa50000-0000-4000-8000-000000000001','teamWorkingTime','ccc50000-0000-4000-8000-000000000001',
 (p.team_policy->>'id')::uuid,1,f.starts,f.ends,'ff150000-0000-4000-8000-000000000042','Synthetic company-volume team') from working_volume_fixture f cross join working_collection_fixture p;
reset role;
