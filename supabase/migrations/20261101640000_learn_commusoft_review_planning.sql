-- Search selectivity varies widely between an exact reference, a description
-- and an empty page query. A cached generic plan on the retained TEST inventory
-- repeatedly scanned the materialized latest-version set in a nested loop and
-- exceeded the API statement timeout. Replan this reader for its actual inputs.
-- The setting is scoped to the function; authority, output and data are unchanged.
begin;
alter function public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)
  set plan_cache_mode = force_custom_plan;
commit;
