-- TEST only: phone handlers use the server role; ordinary client grants stay closed.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Explicit TEST target required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_history_recovery_v1' and source_sha256='0e33e36138c1e8988d13b90b32295ace2d2f3480d6fec83b2deaae919f421efc' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Recovery prerequisite missing';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_phone_service_access_v1') then raise exception 'Phone access receipt already exists';end if;
 if exists(select 1 from unnest(array['phone_calls','phone_recordings','phone_sync_runs']) t cross join unnest(array['service_role','anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r,'public.'||t,p)) then raise exception 'Phone table privileges differ';end if;
end $$;
grant select,insert,update on public.phone_calls,public.phone_recordings,public.phone_sync_runs to service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_phone_service_access_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
