-- PREPARED ONLY. Requires the separate concrete production-release approval.
-- Restore returns original active states; it does not prove runtime compatibility.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if current_user <> 'postgres'
   or current_setting('serviceos.release_project',true) is distinct from 'tgbnakbxwcqjeimygroz'
   or current_setting('serviceos.release_manifest_sha256',true) is distinct from '7067f9f8f390cb22d0a43cb9567100cc43aeea3ed6fb9a72f7377c59a48ee84e'
   or current_setting('serviceos.release_schedule_action',true) is distinct from 'pause' then
   raise exception 'Reviewed production release schedule target and action required';
 end if;
end $guard$;
select pg_advisory_xact_lock(hashtextextended('openfolk:learn-production-release',0));
-- The production postgres role can use cron.alter_job but cannot update or lock
-- cron.job directly. Its existing API holds the affected row locks to commit.
-- This advisory lock coordinates release runners; it does not fence other callers.
create temporary table release_expected_schedule(
 jobid bigint primary key,jobname text,schedule text,command_hash text,original_active boolean
) on commit drop;
insert into release_expected_schedule values
(35,'serviceos-worker','* * * * *','8db9215dcb087977d71c2c66aec49e45',true),
(36,'serviceos-phone-sync','*/5 * * * *','00dca0017140144a8f5e7bd6e73d8f0a',true),
(37,'serviceos-phone-processing','*/2 * * * *','386681c2cf264ee0c8b4b522ec615146',true),
(38,'serviceos-email-sync','*/5 * * * *','ad8c01be92875be65ca2410bab51de12',true),
(39,'serviceos-email-workspace','*/5 * * * *','d2a80e20aa7e37cd01fd6dac3e06b7ab',true),
(40,'serviceos-email-wksp-backfill','*/15 * * * *','8354a109177bffb9c7e55a8bfd62e5cf',true),
(41,'serviceos-interactions','*/5 * * * *','d3390d06393559972307772e33699bb7',true),
(42,'serviceos-identity','*/5 * * * *','6326fa9be696289c8af2560cfc54f26b',true),
(44,'serviceos-customer-cards','*/5 * * * *','1c53a8faba626782ee8c2d503443b16b',true);
create temporary table release_prior_schedule on commit drop as select to_jsonb(j) row from cron.job j;
do $transition$ declare r record; begin
 if (select count(*) from cron.job j join release_expected_schedule e using(jobid)) <> 9
   or exists(select 1 from cron.job j join release_expected_schedule e using(jobid)
      where j.jobname is distinct from e.jobname or j.schedule is distinct from e.schedule
        or md5(j.command) is distinct from e.command_hash
        or j.active is distinct from e.original_active) then
   raise exception 'Schedule baseline or active state differs; inspect before retry';
 end if;
 for r in select * from release_expected_schedule order by jobid loop
   perform cron.alter_job(r.jobid,active := false);
 end loop;
 -- Compare every column of every unrelated row and every non-active field of
 -- targeted rows. Commands never leave the database in the returned receipt.
 if exists(
   select 1 from release_prior_schedule p full join cron.job j
     on (p.row->>'jobid')::bigint=j.jobid
   left join release_expected_schedule e on e.jobid=j.jobid
   where p.row is null or j.jobid is null
     or case when e.jobid is null then p.row is distinct from to_jsonb(j)
       else (p.row-'active') is distinct from (to_jsonb(j)-'active')
         or j.active is distinct from false end
 ) then raise exception 'Unexpected scheduler change; transaction rolled back'; end if;
end $transition$;
select jsonb_build_object('project','tgbnakbxwcqjeimygroz','mode','pause',
 'manifestSha256','7067f9f8f390cb22d0a43cb9567100cc43aeea3ed6fb9a72f7377c59a48ee84e','observedAt',clock_timestamp(),
 'schedules',(select jsonb_agg(jsonb_build_object('jobId',j.jobid,'active',j.active,
    'commandHash',md5(j.command)) order by j.jobid)
   from cron.job j join release_expected_schedule e using(jobid)),
 'inFlightWorkVerifiedStopped',false) as schedule_transition;
commit;
