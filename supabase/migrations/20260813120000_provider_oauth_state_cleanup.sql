-- ServiceOS — Provider OAuth-state maintenance: scheduled purge of spent state rows.
--
-- provider_oauth_states holds transient PKCE/CSRF state. Consumed (used_at set) and expired
-- (past expires_at) rows are dead weight; ACTIVE rows (unused AND unexpired) must never be
-- deleted. cleanup_provider_oauth_states() purges only the dead rows past a short retain
-- grace (kept briefly for minimal debuggability, then removed). No credentials live in this
-- table, so nothing security-bearing is deleted. Scheduled in-DB via pg_cron where present.
--
-- ROLLBACK:
--   do $$ begin if exists (select 1 from pg_extension where extname='pg_cron') then
--     perform cron.unschedule('provider-oauth-state-cleanup'); end if; end $$;
--   drop function if exists public.cleanup_provider_oauth_states(interval);

create or replace function public.cleanup_provider_oauth_states(p_retain interval default '1 hour')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with removed as (
    delete from public.provider_oauth_states
     where created_at < now() - p_retain
       and (used_at is not null or expires_at < now())   -- consumed OR expired only
    returning 1
  )
  select count(*) into v_count from removed;
  return coalesce(v_count, 0);
end;
$$;

-- Maintenance function is service-role only (also used by the cron job owner).
revoke all on function public.cleanup_provider_oauth_states(interval) from public;
revoke all on function public.cleanup_provider_oauth_states(interval) from anon;
revoke all on function public.cleanup_provider_oauth_states(interval) from authenticated;
grant execute on function public.cleanup_provider_oauth_states(interval) to service_role;

-- Schedule every 30 minutes IF pg_cron is enabled (remote). Skip cleanly where absent (local
-- dev). Idempotent: unschedule any prior job of this name first.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      execute 'select cron.unschedule(''provider-oauth-state-cleanup'')';
    exception
      when others then null; -- not scheduled yet
    end;
    execute 'select cron.schedule(''provider-oauth-state-cleanup'', ''*/30 * * * *'', '
         || '''select public.cleanup_provider_oauth_states()'')';
  end if;
end $$;
