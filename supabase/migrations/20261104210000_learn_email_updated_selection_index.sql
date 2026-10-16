-- Future schema replay of the concurrently installed LIVE/TEST Email change
-- selector index. Existing installations are verified by the guarded release
-- script first; this idempotent migration is for fresh recovery environments.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create index if not exists learn_email_projection_updated_idx
 on public.email_messages(tenant_id,updated_at desc,id desc);
commit;
