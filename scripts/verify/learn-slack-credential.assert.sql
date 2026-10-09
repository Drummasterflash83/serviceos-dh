reset role;
-- Synthetic strings only, in a disposable database with network disabled. No
-- credential is printed, exported, or sent to a provider.
create table verify.credential_refs(kind text,id uuid);
insert into verify.credential_refs values
 ('own',vault.create_secret('xoxb-synthetic-not-a-live-credential','provider_secret:'||verify.id(901)||':slack:bot_token')),
 ('foreign',vault.create_secret('xoxb-synthetic-foreign-not-a-live-credential','provider_secret:'||verify.id(902)||':slack:bot_token'));
grant select on verify.credential_refs to service_role;
update provider_connections set secret_refs=jsonb_build_object('bot_token',(select id from verify.credential_refs where kind='own')) where id=verify.id(921);
set role service_role;
do $$declare ref uuid;rev timestamptz;foreign_ref uuid;begin
 select id into ref from verify.credential_refs where kind='own';
 select id into foreign_ref from verify.credential_refs where kind='foreign';
 select updated_at into rev from provider_connections where id=verify.id(921);
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,ref)='xoxb-synthetic-not-a-live-credential';
 assert learn_slack_read_credential(verify.id(902),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,ref) is null;
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(981),1,verify.id(921),rev,ref) is null;
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev-interval '1 second',ref) is null;
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,foreign_ref) is null;
 assert not has_function_privilege('authenticated','learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)','execute');
 assert not has_function_privilege('anon','learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)','execute');
 update provider_connections set secret_refs=jsonb_build_object('bot_token',foreign_ref) where id=verify.id(921) returning updated_at into rev;
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,foreign_ref) is null,'Foreign Vault name resolved through a matching reference';
 update provider_connections set secret_refs=jsonb_build_object('bot_token',ref),status='revoked' where id=verify.id(921) returning updated_at into rev;
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,ref) is null;
 update provider_connections set status='configured' where id=verify.id(921) returning updated_at into rev;
 update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=verify.id(980);
 assert learn_slack_read_credential(verify.id(901),verify.id(980),'learn-slack:'||verify.id(982),2,verify.id(921),rev,ref) is null;
end $$;
reset role;
