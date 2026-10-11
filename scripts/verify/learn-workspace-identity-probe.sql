-- Synthetic full-schema assertions. Caller wraps migration + this in ROLLBACK.
do $$begin
 assert not exists(select 1 from google_workspace_mailboxes where directory_primary_email is not null or directory_identity_conflict),'Existing identity inferred';
end$$;
insert into tenants(id,slug,display_name,status) values('eb190660-cccc-4000-8000-000000000001','workspace-identity-rollback','Synthetic identity rollback','active');
insert into google_workspace_connections(id,tenant_id,domain,status) values('eb190660-cccc-4000-8000-000000000002','eb190660-cccc-4000-8000-000000000001','example.invalid','active');
insert into google_workspace_mailboxes(id,tenant_id,connection_id,email_address,mailbox_type,status,sync_enabled)
 values('eb190660-cccc-4000-8000-000000000003','eb190660-cccc-4000-8000-000000000001','eb190660-cccc-4000-8000-000000000002','alias@example.invalid','alias','active',true);
update google_workspace_mailboxes set directory_primary_email='primary@example.invalid' where id='eb190660-cccc-4000-8000-000000000003';
-- Simulate a later scan whose read predates the first binding; DB pins the first owner.
update google_workspace_mailboxes set directory_primary_email='other@example.invalid',directory_identity_conflict=false where id='eb190660-cccc-4000-8000-000000000003';
do $$begin
 assert exists(select 1 from google_workspace_mailboxes where id='eb190660-cccc-4000-8000-000000000003' and directory_primary_email='primary@example.invalid' and directory_identity_conflict and status='active' and sync_enabled);
end$$;
-- A later retry or ordinary settings update cannot erase the conflict.
update google_workspace_mailboxes set directory_primary_email=null,directory_identity_conflict=false where id='eb190660-cccc-4000-8000-000000000003';
do $$begin
 assert exists(select 1 from google_workspace_mailboxes where id='eb190660-cccc-4000-8000-000000000003' and directory_primary_email='primary@example.invalid' and directory_identity_conflict);
 begin update google_workspace_mailboxes set email_address='different@example.invalid' where id='eb190660-cccc-4000-8000-000000000003';raise exception 'Identity scope changed';exception when sqlstate 'PT409' then assert sqlerrm='workspace_identity_scope_changed';end;
 begin insert into google_workspace_mailboxes(tenant_id,connection_id,email_address,directory_primary_email) values('eb190660-cccc-4000-8000-000000000001','eb190660-cccc-4000-8000-000000000002','malformed@example.invalid','not-an-email');raise exception 'Malformed primary accepted';exception when check_violation then null;end;
end$$;
set local role authenticated;
do $$begin
 begin update google_workspace_mailboxes set directory_primary_email='forged@example.invalid' where id='eb190660-cccc-4000-8000-000000000003';assert not found,'Unauthorised identity change';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$begin
 assert exists(select 1 from google_workspace_mailboxes where id='eb190660-cccc-4000-8000-000000000003' and directory_primary_email='primary@example.invalid' and directory_identity_conflict);
end$$;
