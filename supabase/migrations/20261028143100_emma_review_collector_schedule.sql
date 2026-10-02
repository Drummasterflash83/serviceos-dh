begin;
-- Read-only Vapi evidence reviews; enabled workspaces only. No calls are placed,
-- no assistant settings are changed, and the worker bounds AI spend separately.
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
 perform cron.schedule('openfolk-emma-call-reviews','*/2 * * * *',format(
 $job$select net.http_post(url := %L,
 headers := jsonb_build_object('content-type','application/json','x-schedule-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='WORKER_SECRET')),
 body := '{}'::jsonb, timeout_milliseconds := 120000);$job$,
 v_base || '/receptionist-review-collector'));
end $$;
commit;
