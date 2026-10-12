-- Disposable synthetic fixture, never a hosted database. Vault encryption itself
-- is not simulated as evidence: only broker namespaces/transaction semantics.
alter table provider_connections alter id set default gen_random_uuid(),
 add auth_mode text,add verified_at timestamptz,add last_test jsonb,
 add created_by uuid,add updated_by uuid,add revoked_by uuid;
create unique index fixture_provider_unique on provider_connections(tenant_id,provider);
create trigger fixture_provider_updated before update on provider_connections
 for each row execute function set_updated_at();
create table provider_connection_events(id uuid default gen_random_uuid(),tenant_id uuid,provider text,event text,actor_id uuid,detail jsonb);
create function public.learn_operator_input_immutable() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text);
create function public.provider_secret_store(p_tenant uuid,p_provider text,p_field text,p_secret text)
returns uuid language plpgsql as $$declare sid uuid;begin
 insert into vault.secrets(name,secret) values('provider_secret:'||p_tenant::text||':'||p_provider||':'||p_field,p_secret)
 on conflict(name) do update set secret=excluded.secret returning id into sid;return sid;end$$;
