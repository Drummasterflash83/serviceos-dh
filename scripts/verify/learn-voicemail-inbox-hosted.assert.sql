-- Transaction-local banned/passwordless fixtures; always rolled back to a savepoint.
create function pg_temp.inbox_id(n int) returns uuid language sql immutable as $$select ('ce770002-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.inbox_id(int) to authenticated;
do $$begin
 assert not exists(select 1 from tenants where id in(pg_temp.inbox_id(1),pg_temp.inbox_id(2)));
 assert not exists(select 1 from auth.users where id in(pg_temp.inbox_id(10),pg_temp.inbox_id(11),pg_temp.inbox_id(12)));
end$$;
insert into tenants(id,slug,display_name,status) values(pg_temp.inbox_id(1),'voicemail-inbox-rollback-a','Synthetic inbox rollback A','active'),(pg_temp.inbox_id(2),'voicemail-inbox-rollback-b','Synthetic inbox rollback B','active');
insert into auth.users(id,email,banned_until) select pg_temp.inbox_id(n),'voicemail-inbox-rollback-'||n||'@example.invalid','infinity'::timestamptz from generate_series(10,12)n;
insert into profiles(id,tenant_id,role) select pg_temp.inbox_id(n),pg_temp.inbox_id(1),'owner' from generate_series(10,12)n on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id,notification_email,email_enabled) values(pg_temp.inbox_id(20),pg_temp.inbox_id(1),'rollback','Current private configuration','601',pg_temp.inbox_id(11),'synthetic-current@example.invalid',true);
insert into receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,owner_user_id,received_at) values(pg_temp.inbox_id(30),pg_temp.inbox_id(1),pg_temp.inbox_id(20),'old',pg_temp.inbox_id(10),now()),(pg_temp.inbox_id(31),pg_temp.inbox_id(1),pg_temp.inbox_id(20),'new',pg_temp.inbox_id(11),now());
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ce770002-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare r jsonb;begin
 assert (select count(*) from public.voicemail_mailbox_summary(pg_temp.inbox_id(1)))=0;
 assert (select count(*) from public.receptionist_voicemails where tenant_id=pg_temp.inbox_id(1))=1;
 r:=public.learn_voicemail_mailboxes(pg_temp.inbox_id(1));
 assert jsonb_array_length(r->'rows')=1;
 assert r#>>'{rows,0,access_scope}'='retained_messages' and r#>>'{rows,0,message_count}'='1';
 assert r#>>'{rows,0,display_name}'='Earlier private messages' and r#>>'{rows,0,extension}'='';
 assert r#>'{rows,0,notification_email}'='null'::jsonb and r#>'{rows,0,email_enabled}'='null'::jsonb and r#>'{rows,0,last_synced_at}'='null'::jsonb;
 assert public.learn_voicemail_mailboxes(pg_temp.inbox_id(2))->'rows'='[]'::jsonb;
end$$;
set local request.jwt.claim.sub='ce770002-aaaa-4000-8000-000000000011';
do $$declare r jsonb;begin
 r:=public.learn_voicemail_mailboxes(pg_temp.inbox_id(1));assert jsonb_array_length(r->'rows')=1 and r#>>'{rows,0,access_scope}'='current' and r#>>'{rows,0,message_count}'='1';
 assert (select count(*) from public.receptionist_voicemails where id=pg_temp.inbox_id(30))=0;
end$$;
set local request.jwt.claim.sub='ce770002-aaaa-4000-8000-000000000012';
do $$begin assert public.learn_voicemail_mailboxes(pg_temp.inbox_id(1))->'rows'='[]'::jsonb;end$$;
reset role;
insert into receptionist_mailbox_managers values(pg_temp.inbox_id(1),pg_temp.inbox_id(20),pg_temp.inbox_id(12),pg_temp.inbox_id(12),now());
set local role authenticated;
do $$begin assert public.learn_voicemail_mailboxes(pg_temp.inbox_id(1))#>>'{rows,0,message_count}'='2';end$$;
reset role;delete from receptionist_mailbox_managers where mailbox_id=pg_temp.inbox_id(20);set local role authenticated;
do $$begin assert public.learn_voicemail_mailboxes(pg_temp.inbox_id(1))->'rows'='[]'::jsonb;end$$;
reset role;
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id) select pg_temp.inbox_id(n),pg_temp.inbox_id(1),'rollback-'||n,'Synthetic owned '||n,n::text,pg_temp.inbox_id(10) from generate_series(100,121)n;
set local request.jwt.claim.sub='ce770002-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=public.learn_voicemail_mailboxes(pg_temp.inbox_id(1));b:=public.learn_voicemail_mailboxes(pg_temp.inbox_id(1),(a->>'next_after')::uuid);
 assert jsonb_array_length(a->'rows')=20 and jsonb_array_length(b->'rows')=3 and b->'next_after'='null'::jsonb;
 assert (select count(distinct r->>'id') from jsonb_array_elements((a->'rows')||(b->'rows'))r)=23;
end$$;
reset role;
