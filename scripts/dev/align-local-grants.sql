-- ServiceOS — LOCAL DEV ONLY: align service_role privileges to hosted Supabase.
--
-- Hosted Supabase grants service_role full DML on public tables via default privileges set
-- for the table-creating role. Locally, migrations applied by `supabase migration up` create
-- postgres-owned tables whose default ACL grants service_role only Dxtm (no SELECT/INSERT/
-- UPDATE/DELETE). That makes the service-role Edge Functions fail locally (e.g. profile load
-- in requireTenantUser). This script makes LOCAL behave like hosted. It is NOT a migration
-- and must never run against remote.
--
-- Run:  docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres < scripts/dev/align-local-grants.sql

grant usage on schema public to service_role, authenticated, anon;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- authenticated keeps SELECT (row visibility still gated by RLS policies); no write grants.
grant select on all tables in schema public to authenticated;

-- Future tables created by postgres during this session inherit the same grants.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant select on tables to authenticated;
