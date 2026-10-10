-- Disposable contracts only. Vault encryption is exercised separately in hosted TEST.
alter table provider_connections alter column id set default gen_random_uuid();
alter table provider_connections alter column updated_at set default clock_timestamp();
alter table provider_connections add column created_by uuid,add column updated_by uuid,add column revoked_by uuid,add column last_test jsonb;
create trigger provider_connections_set_updated_at before update on provider_connections for each row execute function set_updated_at();
create unique index provider_connections_tenant_provider_uk on provider_connections(tenant_id,provider);
create table provider_connection_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,provider text,event text,actor_id uuid,detail jsonb,created_at timestamptz default clock_timestamp());
create function vault.create_secret(new_secret text,new_name text default null,new_description text default '',new_key_id uuid default null)
returns uuid language plpgsql as $$declare key uuid:=gen_random_uuid();begin
 insert into vault.decrypted_secrets values(key,new_name,new_secret);return key;end$$;
create function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null,new_key_id uuid default null)
returns void language plpgsql as $$begin update vault.decrypted_secrets set decrypted_secret=coalesce(new_secret,decrypted_secret),name=coalesce(new_name,name) where id=secret_id;end$$;
insert into tenants values(fixture_id(300),'active'),(fixture_id(301),'active');
insert into platform_authority_grants(profile_id,permission,granted_by) values(fixture_id(180),'platform.controlplane.admin','synthetic'),(fixture_id(182),'platform.controlplane.view','synthetic');
create function fixture_connection_definition(mode text default 'replace',revision timestamptz default null) returns jsonb language sql as $$
select jsonb_build_object('kind','configure_commusoft','reason','Synthetic connection review','region','uk','account_key','synthetic-account',
'expected_revision',revision,'credential_mode',mode,'same_account_confirmed',true)$$;
grant execute on function fixture_connection_definition(text,timestamptz) to authenticated;
