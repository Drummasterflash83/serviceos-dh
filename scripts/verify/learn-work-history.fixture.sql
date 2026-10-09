-- Dependencies only; the intelligence objects/history schema is loaded from
-- its real foundation migration by the isolated SQL runner.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,role text);
create table team_members(id uuid primary key,tenant_id uuid,effective_from timestamptz,effective_to timestamptz,confirmed_at timestamptz);
create table view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
create table objectives(id uuid primary key,tenant_id uuid);
create table objective_links(tenant_id uuid,objective_id uuid references objectives(id),target_kind text,target_ref text,
  relation text check(relation<>'reject-fixture'),rationale text,created_by text,approved boolean);
create function current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant',true),'')::uuid $$;
create function is_openfolk() returns boolean language sql stable as $$ select false $$;
create function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
