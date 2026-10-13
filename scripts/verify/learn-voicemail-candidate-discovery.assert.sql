-- Isolated full-schema fixture only. No provider transports or real source content.
begin;
set local search_path=public,pg_catalog;
create function pg_temp.vc(n int) returns uuid language sql immutable as $$select ('ce490000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.vc(int) to service_role;
insert into tenants(id,slug,display_name,status) values(pg_temp.vc(1),'candidate-discovery-fixture','Synthetic candidate discovery','active');
insert into auth.users(id,email,banned_until) values(pg_temp.vc(2),'candidate-discovery@example.invalid','infinity');
update profiles set tenant_id=pg_temp.vc(1),role='owner' where id=pg_temp.vc(2);
insert into email_accounts(id,tenant_id,provider,email_address,status) values(pg_temp.vc(3),pg_temp.vc(1),'gmail','candidate-discovery@example.invalid','active_dwd');
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) values(pg_temp.vc(4),pg_temp.vc(1),'candidate-discovery','Synthetic mailbox','601',pg_temp.vc(2));
insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
 values(pg_temp.vc(5),pg_temp.vc(1),pg_temp.vc(4),pg_temp.vc(3),'candidate-discovery@example.invalid','birchills-net.20251104.gappssmtp.com',pg_temp.vc(2),'owner','2026-01-01','2026-10-13','Synthetic candidate discovery fixture',pg_temp.vc(2),true);
-- 20,000 ordinary emails before the candidate UUIDs must consume no page budget.
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select ('00000000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,pg_temp.vc(1),'gmail','ordinary'||n,'synthetic@example.invalid','Ordinary message','2026-10-12','inbound','{}' from generate_series(1,20000)n;
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select pg_temp.vc(n),pg_temp.vc(1),'gmail',to_hex(n),'notifications@birchills.net','New message in mailbox 601 from Synthetic','2026-10-12','inbound',jsonb_build_object('provider_account_id',pg_temp.vc(3),'label_ids','[]'::jsonb) from generate_series(100,304)n;
-- Non-admissible date/account/extension/sender rows stay outside pagination.
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select pg_temp.vc(n),pg_temp.vc(1),'gmail',to_hex(n),case when n=310 then 'notifications@evil.invalid' else 'notifications@birchills.net' end,
 case when n=311 then 'New message in mailbox 602 from Synthetic' else 'New message in mailbox 601 from Synthetic' end,
 case n when 305 then '2025-12-31'::timestamptz when 306 then '2026-10-13'::timestamptz else '2026-10-12'::timestamptz end,'inbound',
 jsonb_build_object('provider_account_id',case when n=307 then pg_temp.vc(999) else pg_temp.vc(3) end,'label_ids','[]'::jsonb)
 from unnest(array[305,306,307,310,311])n;
-- Diagnostics remain visible but cannot enqueue an unverified source.
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select pg_temp.vc(n),pg_temp.vc(1),'gmail',case when n=315 then 'invalid-id' else to_hex(n) end,'notifications@birchills.net','New message in mailbox 601 from Synthetic',
 case when n=316 then null when n=317 then 'infinity'::timestamptz else '2026-10-12'::timestamptz end,'inbound',
 jsonb_build_object('provider_account_id',case when n=312 then null else pg_temp.vc(3) end,'label_ids',case when n=313 then '["DRAFT"]'::jsonb else '[]'::jsonb end,'provider_availability',case when n=314 then 'unavailable' else 'available' end)
 from generate_series(312,317)n;
create temp table vc_preservation as select count(*) n,md5(string_agg(md5(to_jsonb(e)::text),'' order by id)) hash from email_messages e;
set local role service_role;
do $$declare a jsonb;b jsonb;begin
 a:=voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(10));assert a->>'rows_examined'='100' and a->>'jobs_enqueued'='100' and a->>'state'='scanning',a::text;
 assert voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(10))=a;
 b:=voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(11));assert b->>'jobs_enqueued'='100' and b->>'rows_examined'='100';
 b:=voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(12));assert b->>'state'='retained_pass_complete' and b->>'pass_rows_examined'='211' and b->>'jobs_enqueued'='5' and b->>'needs_review'='5' and b->>'excluded'='1',b::text;
 assert (select next_scan_at-completed_at from receptionist_voicemail_scans where route_id=pg_temp.vc(5))=interval '1 minute';
 assert voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(13))->>'state'='waiting';
 begin perform voicemail_discover_page(pg_temp.vc(999),pg_temp.vc(5),pg_temp.vc(14));raise exception 'Foreign tenant admitted';exception when invalid_parameter_value then null;end;
end$$;reset role;
-- Simulate late backfill and binding/label repair after the UUID cursor passed.
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 values(pg_temp.vc(90),pg_temp.vc(1),'gmail','aaa90','notifications@birchills.net','New message in mailbox 601 from Synthetic','2026-01-01','inbound',jsonb_build_object('provider_account_id',pg_temp.vc(3),'label_ids','[]'::jsonb)),
 (pg_temp.vc(91),pg_temp.vc(1),'gmail','aaa91','notifications@birchills.net','New message in mailbox 601 from Synthetic','2026-10-12 23:59:59.999Z','inbound',jsonb_build_object('provider_account_id',pg_temp.vc(3),'label_ids','[]'::jsonb));
update email_messages set raw_payload=jsonb_set(raw_payload,'{provider_account_id}',to_jsonb(pg_temp.vc(3)::text)) where id=pg_temp.vc(312);
update email_messages set raw_payload=jsonb_set(raw_payload,'{label_ids}','[]') where id=pg_temp.vc(313);
update platform_jobs set status='dead_letter' where tenant_id=pg_temp.vc(1) and payload->>'messageId'=to_hex(100);
update receptionist_voicemail_scans set next_scan_at=clock_timestamp()-interval '1 second' where route_id=pg_temp.vc(5);
set local role service_role;
do $$declare a jsonb;n int:=0;begin
 for i in 1..3 loop a:=voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),gen_random_uuid());n:=n+(a->>'jobs_enqueued')::int;end loop;
 assert n=4 and a->>'state'='retained_pass_complete' and a->>'generation'='2',a::text;
 assert (select count(*) from platform_jobs where tenant_id=pg_temp.vc(1) and job_type='phone.voicemail_import')=209;
 assert (select count(*) from platform_jobs where tenant_id=pg_temp.vc(1) and status='dead_letter')=1;
 assert not exists(select 1 from receptionist_voicemail_candidates where email_message_id in(pg_temp.vc(305),pg_temp.vc(306),pg_temp.vc(307),pg_temp.vc(310),pg_temp.vc(311)));
end$$;reset role;
-- Lost transaction receipt rolls back cursor, candidates and jobs; retry succeeds.
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 values(pg_temp.vc(89),pg_temp.vc(1),'gmail','aaa89','notifications@birchills.net','New message in mailbox 601 from Synthetic','2026-05-01','inbound',jsonb_build_object('provider_account_id',pg_temp.vc(3)));
update receptionist_voicemail_scans set next_scan_at=clock_timestamp()-interval '1 second' where route_id=pg_temp.vc(5);
create function pg_temp.vc_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_receipt_failure';end$$;
create trigger vc_fail before insert on receptionist_voicemail_scan_receipts for each row execute function pg_temp.vc_fail();
set local role service_role;
do $$declare before jsonb;begin
 select to_jsonb(s) into before from receptionist_voicemail_scans s where route_id=pg_temp.vc(5);
 begin perform voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(15));raise exception 'Receipt failure ignored';exception when raise_exception then assert sqlerrm='synthetic_receipt_failure';end;
 assert (select to_jsonb(s) from receptionist_voicemail_scans s where route_id=pg_temp.vc(5))=before;
 assert not exists(select 1 from receptionist_voicemail_candidates where email_message_id=pg_temp.vc(89));
end$$;reset role;
drop trigger vc_fail on receptionist_voicemail_scan_receipts;
set local role service_role;
do $$begin assert voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),pg_temp.vc(15))->>'jobs_enqueued'='1';end$$;reset role;
-- Capture gate and paused route remain authoritative, old receipts remain evidence.
insert into feature_flags(tenant_id,flag,value) values(pg_temp.vc(1),'learn.inputs.email.enabled','false');
set local role service_role;
do $$begin begin perform voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),gen_random_uuid());raise exception 'Capture pause ignored';exception when sqlstate '55000' then assert sqlerrm='voicemail_capture_paused';end;end$$;reset role;
update receptionist_voicemail_email_routes set enabled=false where id=pg_temp.vc(5);
set local role service_role;
do $$begin begin perform voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),gen_random_uuid());raise exception 'Disabled route ignored';exception when invalid_parameter_value then assert sqlerrm='voicemail_route_unverified';end;end$$;reset role;
set local role authenticated;
do $$begin begin perform public.voicemail_discover_page(pg_temp.vc(1),pg_temp.vc(5),gen_random_uuid());raise exception 'Client discovery admitted';exception when insufficient_privilege then null;end;end$$;reset role;
-- Discovery never changes retained source rows; only explicit fixture repairs differ.
do $$begin
 assert (select n from vc_preservation)+3=(select count(*) from email_messages);
 assert not exists(select 1 from receptionist_voicemails where tenant_id=pg_temp.vc(1));
 assert not exists(select 1 from receptionist_voicemail_sources where tenant_id=pg_temp.vc(1));
end$$;
rollback;
