-- Run against local stack. All fixtures and mutations roll back.
\set ON_ERROR_STOP on
begin;
insert into public.tenants (id,slug,display_name) values
('ac000000-0000-0000-0000-000000000001','portal-test-a','Portal A'),
('ac000000-0000-0000-0000-000000000002','portal-test-b','Portal B');
insert into auth.users (id,email) values
('ac100000-0000-0000-0000-000000000001','portal-member@example.test'),
('ac100000-0000-0000-0000-000000000002','portal-stranger@example.test'),
('ac100000-0000-0000-0000-000000000003','portal-operator@example.test');
-- A same-tenant user is deliberately NOT a portal member.
update public.profiles set tenant_id='ac000000-0000-0000-0000-000000000001',role='owner'
where id='ac100000-0000-0000-0000-000000000002';
insert into public.client_portal_access(tenant_id,profile_id) values
('ac000000-0000-0000-0000-000000000001','ac100000-0000-0000-0000-000000000001');
insert into public.platform_authority_grants(profile_id,permission,granted_by,reason) values
('ac100000-0000-0000-0000-000000000003','platform.controlplane.admin','local-test','Portal security test');
insert into public.client_programmes(tenant_id,content) values
('ac000000-0000-0000-0000-000000000001','{"company":"A"}'),
('ac000000-0000-0000-0000-000000000002','{"company":"B"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','ac100000-0000-0000-0000-000000000001',true);
do $$ declare n integer; begin
 select count(*) into n from public.client_programmes where tenant_id in ('ac000000-0000-0000-0000-000000000001','ac000000-0000-0000-0000-000000000002');
 assert n=1, 'Member must see only one programme';
 assert public.current_tenant_id() is null, 'Portal must work without operational tenant authority';
 assert not public.current_user_is_openfolk_operator(), 'Portal member has no operator authority';
 update public.client_programmes set content='{}' where tenant_id='ac000000-0000-0000-0000-000000000001';
 get diagnostics n=row_count; assert n=0, 'Member cannot alter quote or prices';
 begin
 insert into public.client_portal_access(tenant_id,profile_id) values ('ac000000-0000-0000-0000-000000000002',auth.uid());
 raise exception 'Member escalated membership';
 exception when insufficient_privilege then null; end;
 insert into public.client_programme_notes(tenant_id,body) values('ac000000-0000-0000-0000-000000000001','Member feedback');
 begin
 insert into public.client_programme_notes(tenant_id,body) values('ac000000-0000-0000-0000-000000000002','Cross tenant');
 raise exception 'Cross tenant note allowed';
 exception when insufficient_privilege then null; end;
 begin
 insert into public.client_programme_notes(tenant_id,body,author_id) values('ac000000-0000-0000-0000-000000000001','Spoof','ac100000-0000-0000-0000-000000000003');
 raise exception 'Author spoof allowed';
 exception when insufficient_privilege then null; end;
 assert (select count(*) from public.client_programme_revisions)=0, 'Member cannot see internal revisions';
 raise notice 'PASS: member read scope, no operational grant, write denial, membership denial, note boundary, author identity, hidden audit';
end $$;
select set_config('request.jwt.claim.sub','ac100000-0000-0000-0000-000000000002',true);
do $$ begin
 assert (select count(*) from public.client_programmes)=0, 'Same-tenant nonmember cannot read programmes';
 assert (select count(*) from public.client_programme_notes)=0, 'Same-tenant nonmember cannot read feedback';
 raise notice 'PASS: explicit portal membership required even for tenant owner';
end $$;
select set_config('request.jwt.claim.sub','ac100000-0000-0000-0000-000000000003',true);
do $$ declare n integer; begin
 update public.client_programmes set content='{"company":"A updated"}' where tenant_id='ac000000-0000-0000-0000-000000000001' and version=1;
 get diagnostics n=row_count; assert n=1,'Operator can edit';
 update public.client_programmes set content='{"company":"stale"}' where tenant_id='ac000000-0000-0000-0000-000000000001' and version=1;
 get diagnostics n=row_count; assert n=0,'Stale overwrite prevented';
 assert (select version from public.client_programmes where tenant_id='ac000000-0000-0000-0000-000000000001')=2,'Version increments';
 assert (select count(*) from public.client_programme_revisions where tenant_id='ac000000-0000-0000-0000-000000000001')=2,'Every revision recorded';
 assert (select updated_by from public.client_programmes where tenant_id='ac000000-0000-0000-0000-000000000001')=auth.uid(),'Actor stamped';
 raise notice 'PASS: operator edits, concurrency guard, revision history, actor recorded';
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin
 perform * from public.client_programmes;
 raise exception 'Anonymous programme access allowed';
 exception when insufficient_privilege then null; end;
 begin
 perform * from public.client_programme_notes;
 raise exception 'Anonymous notes access allowed';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS: anonymous access denied';
end $$;
rollback;
