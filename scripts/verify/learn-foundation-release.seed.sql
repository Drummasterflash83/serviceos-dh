-- Fixed IDs exist only in this disposable database. No customer rows are copied.
create schema verify;
create function verify.id(n int) returns uuid language sql immutable as $$
 select ('f0000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
grant usage on schema verify to authenticated,service_role;
grant execute on function verify.id(int) to authenticated,service_role;
insert into tenants(id,slug,display_name) values (verify.id(1),'synthetic-a','Synthetic A'),(verify.id(2),'synthetic-b','Synthetic B');
insert into auth.users(id) select verify.id(n) from generate_series(11,14) n;
insert into profiles(id,tenant_id,role) values (verify.id(11),verify.id(1),'owner'),(verify.id(12),verify.id(1),'viewer'),(verify.id(13),verify.id(1),'openfolk'),(verify.id(14),verify.id(2),'owner');
insert into email_messages(id,tenant_id,provider_message_id,body_text,raw_payload) values
 (verify.id(21),verify.id(1),'synthetic-existing-message','Keep this exact body','{"labels":["INBOX"],"private":"preserved"}');
create table verify.email_before as select to_jsonb(e) payload from email_messages e;
