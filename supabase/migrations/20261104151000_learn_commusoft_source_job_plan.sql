-- Latest-observation CTEs have no persisted statistics. Avoid quadratic joins
-- over retained history. Function-local setting restores the caller's planner
-- configuration on exit; authority, output, grants and source data are unchanged.
begin;
alter function public.learn_commusoft_source_job_rows(uuid,uuid) set enable_nestloop=off;
commit;
