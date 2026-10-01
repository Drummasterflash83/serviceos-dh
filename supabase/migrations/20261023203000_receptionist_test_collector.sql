begin;
-- Collect results after the operator leaves the page. Does not start voice tests.
-- Reuses the existing platform-worker scheduler credential, never exposes it.
do $$
declare v_base text;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron')
 or not exists(select 1 from pg_extension where extname='pg_net') then
   raise exception 'Existing platform scheduler required';
 end if;
 select rtrim(base_url,'/') into v_base from public.scheduler_config where id=true;
 if v_base is null or not exists(select 1 from vault.secrets where name='WORKER_SECRET') then
   raise exception 'Platform scheduler configuration required';
 end if;
 perform cron.schedule('openfolk-receptionist-test-results','*/2 * * * *',format(
 $job$select net.http_post(url := %L,
 headers := jsonb_build_object('content-type','application/json','x-schedule-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='WORKER_SECRET')),
 body := '{}'::jsonb, timeout_milliseconds := 55000);$job$,
 v_base || '/receptionist-test-collector'));
end $$;
commit;
