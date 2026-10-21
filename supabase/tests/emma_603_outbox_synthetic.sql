-- Run only against an isolated disposable PostgreSQL 17 database. No LIVE
-- Supabase objects or credentials are used. The fixture tables model the
-- published private voicemail source used by the 603 admission RPC.
\set ON_ERROR_STOP on
create schema extensions;
create extension pgcrypto with schema extensions;
do $$begin
 if not exists(select 1 from pg_roles where rolname='service_role') then execute 'create role service_role';end if;
 if not exists(select 1 from pg_roles where rolname='anon') then execute 'create role anon';end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then execute 'create role authenticated';end if;
end $$;
alter role service_role bypassrls;
create table public.tenants(id uuid primary key);
create table public.receptionist_mailboxes(id uuid primary key,tenant_id uuid not null,provider text not null,extension text not null,unique(tenant_id,id));
create table public.receptionist_voicemail_email_routes(id uuid primary key,tenant_id uuid not null,mailbox_id uuid not null);
create table public.receptionist_voicemail_intakes(id uuid primary key,tenant_id uuid not null,mailbox_id uuid not null,route_id uuid not null,provider_reference uuid not null,state text not null,audio_bytes integer not null,audio_sha256 text not null,content_sha256 text not null);
create table public.receptionist_voicemail_sources(id uuid primary key,tenant_id uuid not null,intake_id uuid not null,route_id uuid not null,raw_sha256 text not null,unique(tenant_id,id));
grant usage on schema public,extensions to service_role;
grant select on public.tenants,public.receptionist_mailboxes,public.receptionist_voicemail_email_routes,public.receptionist_voicemail_intakes,public.receptionist_voicemail_sources to service_role;
insert into public.tenants values('00000000-0000-0000-0000-000000000001');
insert into public.receptionist_mailboxes values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','birchills','603');
insert into public.receptionist_voicemail_email_routes values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
insert into public.receptionist_voicemail_intakes values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000006','published',101,repeat('b',64),repeat('c',64));
insert into public.receptionist_voicemail_sources values('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003',repeat('a',64));
\i /tmp/emma_603_migration.sql

create schema synthetic;
create function synthetic.core() returns jsonb language sql immutable as $$
 select jsonb_build_object(
   'identity',jsonb_build_object('tenantId','00000000-0000-0000-0000-000000000001','vapiCallId','vapi-1','birchillsCallId','birchills-1','classification','commercial'),
   'callBinding',jsonb_build_object('tenantId','00000000-0000-0000-0000-000000000001','vapiCallId','vapi-1','birchillsCallId','birchills-1','source','birchills','providerEventId','binding-1','occurredAt','2026-10-21T10:00:00Z','state','matched'),
   'attempts',jsonb_build_array(jsonb_build_object('tenantId','00000000-0000-0000-0000-000000000001','vapiCallId','vapi-1','birchillsCallId','birchills-1','source','vapi','providerEventId','attempt-1','occurredAt','2026-10-21T10:01:00Z','target','rob109','outcome','failed')),
   'deposit',jsonb_build_object('tenantId','00000000-0000-0000-0000-000000000001','vapiCallId','vapi-1','birchillsCallId','birchills-1','source','birchills','providerEventId','deposit-1','occurredAt','2026-10-21T10:02:00Z','mailbox','603','mailboxMessageId','00000000-0000-0000-0000-000000000006','state','deposited'));
$$;
grant usage on schema synthetic to service_role;
grant execute on function synthetic.core() to service_role;

set role service_role;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'C123456');
  raise exception 'default-off prepare unexpectedly succeeded';
exception when sqlstate '55000' then null;end $$;
reset role;
do $$begin
  if (select count(*) from public.receptionist_emergency_603_delivery_config)<>0
    or (select count(*) from public.receptionist_emergency_603_outbox)<>0 then
    raise exception 'migration seeded active state';end if;end $$;
insert into public.receptionist_emergency_603_delivery_config
 (tenant_id,email_owner,reviewed_slack_channel,route_version,preparation_enabled,reviewed_at)
 values('00000000-0000-0000-0000-000000000001','openfolk_sender','C123456','synthetic-v1',true,now());
set role service_role;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'CWRONG');
  raise exception 'unreviewed route unexpectedly prepared';
exception when sqlstate '22023' then null;end $$;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
    jsonb_set(synthetic.core(),'{attempts,0,outcome}','"human_accepted"'),'C123456');
  raise exception 'accepted attempt unexpectedly prepared';
exception when sqlstate '22023' then null;end $$;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
    jsonb_set(synthetic.core(),'{deposit,mailboxMessageId}','"wrong"'),'C123456');
  raise exception 'unmatched deposit unexpectedly prepared';
exception when sqlstate '22023' then null;end $$;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'C123456');
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'C123456');
  if (select count(*) from public.receptionist_emergency_603_outbox)<>3 then raise exception 'replay duplicate';end if;
  if (select count(distinct delivery_id) from public.receptionist_emergency_603_outbox)<>3 then raise exception 'duplicate ID';end if;
end $$;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
    jsonb_set(synthetic.core(),'{callBinding,providerEventId}','"binding-2"'),'C123456');
  raise exception 'conflicting replay unexpectedly succeeded';
exception when sqlstate '22023' then null;end $$;
reset role;
update public.receptionist_emergency_603_delivery_config set reviewed_slack_channel='CNEWR0UTE',route_version='synthetic-v2'
 where tenant_id='00000000-0000-0000-0000-000000000001';
set role service_role;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'CNEWR0UTE');
  raise exception 'changed route unexpectedly replaced frozen intents';
exception when sqlstate '22023' then null;end $$;
reset role;
update public.receptionist_emergency_603_delivery_config set reviewed_slack_channel='C123456',route_version='synthetic-v1'
 where tenant_id='00000000-0000-0000-0000-000000000001';
update public.receptionist_voicemail_sources set raw_sha256=repeat('d',64)
 where id='00000000-0000-0000-0000-000000000005';
set role service_role;
do $$begin
  perform * from public.emma_603_prepare('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',synthetic.core(),'C123456');
  raise exception 'changed source hash unexpectedly replaced frozen intents';
exception when sqlstate '22023' then null;end $$;
reset role;
update public.receptionist_voicemail_sources set raw_sha256=repeat('a',64)
 where id='00000000-0000-0000-0000-000000000005';
set role service_role;
do $$begin
  if exists(select 1 from public.emma_603_claim('00000000-0000-0000-0000-000000000001')) then
    raise exception 'sender claimed while default Off';end if;end $$;
reset role;
update public.receptionist_emergency_603_delivery_config set sender_enabled=true where tenant_id='00000000-0000-0000-0000-000000000001';
set role service_role;
do $$declare r public.receptionist_emergency_603_outbox%rowtype;outcome text;begin
  select * into r from public.emma_603_claim('00000000-0000-0000-0000-000000000001');
  if r.delivery_id is null then raise exception 'enabled claim missing';end if;
  if public.emma_603_settle(r.delivery_id,gen_random_uuid(),'uncertain',null) then raise exception 'wrong reservation settled';end if;
  outcome:=case when r.target='urgent_slack' then 'posted' else 'submitted' end;
  if not public.emma_603_settle(r.delivery_id,r.reservation_id,outcome,'provider-1') then raise exception 'valid settlement failed';end if;
  if public.emma_603_settle(r.delivery_id,r.reservation_id,outcome,'provider-1') then raise exception 'settlement replay sent twice';end if;
  select * into r from public.emma_603_claim('00000000-0000-0000-0000-000000000001');
  if r.delivery_id is null then raise exception 'second claim missing';end if;
  update public.receptionist_emergency_603_outbox set reserved_until=clock_timestamp()-interval '1 second' where delivery_id=r.delivery_id;
  perform * from public.emma_603_claim('00000000-0000-0000-0000-000000000001');
  if (select state from public.receptionist_emergency_603_outbox where delivery_id=r.delivery_id)<>'uncertain' then
    raise exception 'expired reservation was retried';end if;
  if (select count(*) from public.receptionist_emergency_603_outbox where state='reserved')<>1 then
    raise exception 'claim did not reserve last row';end if;
end $$;
reset role;
do $$begin
 if (select count(*) from public.receptionist_emergency_603_outbox)<>3 then raise exception 'expected exactly three rows';end if;
end $$;
\echo 'emma 603 synthetic SQL tests passed'
