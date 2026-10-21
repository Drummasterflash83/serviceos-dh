-- One Drummonds-only source-report wakeup at 04:05 UTC. This is after 04:00
-- Europe/London in both GMT and BST; the claim computes yesterday locally.
-- The policy starts Off and the worker selects no tenant from the request.
begin;
set local lock_timeout='3s';
do $$
declare base text;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or
    not exists(select 1 from pg_extension where extname='pg_net') then
  raise exception 'daily_quickbooks_scheduler_unavailable';end if;
 select rtrim(base_url,'/') into base from public.scheduler_config where id=true;
 if base is distinct from 'https://tgbnakbxwcqjeimygroz.functions.supabase.co' or
    not exists(select 1 from vault.secrets where name='LEARN_QUICKBOOKS_DAILY_REPORT_KEY') or
    exists(select 1 from cron.job where jobname='openfolk-quickbooks-daily-reports') then
  raise exception 'daily_quickbooks_scheduler_scope_changed';end if;
 perform cron.schedule('openfolk-quickbooks-daily-reports','5 4 * * *',format(
  $job$select net.http_post(url := %L,
   headers := jsonb_build_object('content-type','application/json',
    'x-serviceos-worker-key',(select decrypted_secret from vault.decrypted_secrets
     where name='LEARN_QUICKBOOKS_DAILY_REPORT_KEY')),
   body := null::jsonb, timeout_milliseconds := 120000);$job$,
  base||'/learn-quickbooks-daily-reports'));
end $$;
commit;
