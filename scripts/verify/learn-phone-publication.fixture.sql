create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.tenants(id uuid primary key,status text not null default 'active');
create table public.feature_flags(tenant_id uuid,flag text,value jsonb,unique(tenant_id,flag));
create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end$$;
create function public.learn_operator_input_immutable() returns trigger language plpgsql as $$begin raise exception 'retained' using errcode='55000';end$$;
create function public.fixture_id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant usage on schema public to anon,authenticated,service_role;
