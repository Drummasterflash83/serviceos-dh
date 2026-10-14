-- Synthetic isolated PostgreSQL contracts. Never run against hosted databases.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema vault;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table public.tenants(id uuid primary key,status text not null);
create table public.profiles(id uuid primary key references auth.users(id));
create table public.platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
-- This is a transactionality fixture, not evidence of encryption at rest.
create table vault.secrets(id uuid primary key,name text unique,decrypted_secret text);
create view vault.decrypted_secrets as select * from vault.secrets;
create function vault.create_secret(new_secret text,new_name text,new_description text default '') returns uuid language plpgsql as $$
declare v_id uuid:=gen_random_uuid();begin insert into vault.secrets values(v_id,new_name,new_secret);return v_id;end $$;
create function vault.update_secret(secret_id uuid,new_secret text,new_name text) returns void language sql as $$
 update vault.secrets set decrypted_secret=new_secret,name=new_name where id=secret_id;
$$;
create function fixture_id(i integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid$$;
create function fixture_assert(ok boolean,msg text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'assertion failed: %',msg;end if;end $$;
create function fixture_denied(statement text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then return;end;
 raise exception 'expected denial: %',statement;
end $$;
create function fixture_pair() returns jsonb language sql as $$select jsonb_build_object('accessToken','synthetic-access','refreshToken','synthetic-refresh',
 'accessExpiresAt',clock_timestamp()+interval '1 hour','refreshExpiresAt',clock_timestamp()+interval '100 days','refreshHardExpiresAt',null)$$;
insert into tenants values(fixture_id(1),'active'),(fixture_id(2),'active');
insert into auth.users(id) values(fixture_id(10)),(fixture_id(11));
insert into profiles values(fixture_id(10)),(fixture_id(11));
insert into platform_authority_grants values(fixture_id(10),'platform.controlplane.admin',null,null);
