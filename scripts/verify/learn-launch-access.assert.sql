insert into profiles(id,tenant_id,role) values
 ('11110000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','owner'),
 ('11110000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000001','admin'),
 ('11110000-0000-0000-0000-000000000003','aaaa0000-0000-0000-0000-000000000001','viewer'),
 ('11110000-0000-0000-0000-000000000004','aaaa0000-0000-0000-0000-000000000002','owner');
insert into email_messages(id,tenant_id,created_at,raw_payload) values
 ('22220000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001',now(),'{"label_ids":["INBOX","SENT","PRIVATE_LABEL"],"body":"Private synthetic email","provider_detail":"Must not leave status view"}'),
 ('22220000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000002',now(),'{"label_ids":["DRAFT"],"body":"Foreign synthetic email"}');
insert into email_sync_runs(tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message)
 values('aaaa0000-0000-0000-0000-000000000001','failed','messages',now(),now(),3,'Private provider error');
insert into phone_sync_runs(tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message)
 values('aaaa0000-0000-0000-0000-000000000001','success','calls',now(),now(),4,null);
insert into phone_calls(id,tenant_id,created_at,direction) values
 ('33330000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001',now(),'IN'),
 ('33330000-0000-0000-0000-000000000002','aaaa0000-0000-0000-0000-000000000002',now(),'OUT');
insert into phone_transcripts(id,tenant_id,status,transcript_text) values
 ('44440000-0000-0000-0000-000000000001','aaaa0000-0000-0000-0000-000000000001','completed','Private transcript');
create temporary table source_before as select jsonb_agg(to_jsonb(e)) as rows from email_messages e;
set request.jwt.claim.sub='11110000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_launch_email_messages)=1;
 assert (select raw_payload='{"label_ids":["INBOX","SENT"]}'::jsonb from learn_launch_email_messages);
 assert (select count(*) from learn_launch_phone_calls)=1;
 assert (select error_message='[redacted]' from learn_launch_email_sync_runs);
 assert (select error_message is null from learn_launch_phone_sync_runs);
 assert (select status='completed' from learn_launch_phone_transcripts);
 assert not has_table_privilege('authenticated','email_messages','SELECT');
 assert not has_column_privilege('authenticated','email_messages','raw_payload','SELECT');
 assert not has_column_privilege('authenticated','phone_transcripts','transcript_text','SELECT');
 assert not pg_has_role('authenticated','learn_launch_metadata_reader','MEMBER');
 begin perform raw_payload from email_messages;raise exception 'Unexpected raw-source read';exception when insufficient_privilege then null;end;
 begin update learn_launch_phone_calls set direction='OUT';raise exception 'Unexpected view write';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Admin has the same tenant scope; foreign owners see their own rows only.
set request.jwt.claim.sub='11110000-0000-0000-0000-000000000002';
set role authenticated;
do $$ begin assert (select count(*) from learn_launch_email_messages)=1;end $$;
reset role;
set request.jwt.claim.sub='11110000-0000-0000-0000-000000000004';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_launch_email_messages)=1;
 assert (select raw_payload='{"label_ids":["DRAFT"]}'::jsonb from learn_launch_email_messages);
 assert (select count(*) from learn_launch_email_sync_runs)=0;
 assert (select count(*) from learn_launch_email_messages where tenant_id='aaaa0000-0000-0000-0000-000000000001')=0;
end $$;
reset role;
set request.jwt.claim.sub='11110000-0000-0000-0000-000000000003';
set role authenticated;
do $$ begin
 assert (select count(*) from learn_launch_email_messages)=0;
 assert (select count(*) from learn_launch_phone_calls)=0;
end $$;
reset role;
-- Stale owner JWT cannot retain authority after the profile role changes.
update profiles set role='viewer' where id='11110000-0000-0000-0000-000000000001';
set request.jwt.claim.sub='11110000-0000-0000-0000-000000000001';
set role authenticated;
do $$ begin assert (select count(*) from learn_launch_email_messages)=0;end $$;
reset role;
set request.jwt.claim.sub='';
set role authenticated;
do $$ begin assert (select count(*) from learn_launch_email_messages)=0;end $$;
reset role;
set role anon;
do $$ begin
 begin perform 1 from learn_launch_email_messages;raise exception 'Unexpected anonymous access';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from of_test_deploy.migrations)=2, 'Bootstrap and one release receipt must remain';
 assert (select count(*) from of_test_deploy.migrations where migration_name='learn_launch_metadata_views_v1'
   and project_ref='saatxzwxvdvqevbnskxy' and source_sha256 ~ '^[a-f0-9]{64}$' and applied_at is not null)=1;
 assert (select rows from source_before)=(select jsonb_agg(to_jsonb(e)) from email_messages e), 'Original source payloads must be unchanged';
 assert not exists(select * from test_policy_before except select * from pg_policies where schemaname='public'), 'Existing policies must remain identical';
 assert not has_schema_privilege('learn_launch_metadata_reader','public','CREATE');
 assert not pg_has_role('postgres','learn_launch_metadata_reader','SET'), 'Temporary deployer SET must be revoked';
 assert not pg_has_role('postgres','learn_launch_metadata_reader','USAGE'), 'Deployer must not inherit reader privileges';
 assert (select not rolcanlogin and not rolbypassrls and not rolsuper and not rolinherit from pg_roles where rolname='learn_launch_metadata_reader');
 assert (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_launch_%' and c.relkind='v' and c.reloptions @> array['security_barrier=true','security_invoker=false'])=8;
end $$;
