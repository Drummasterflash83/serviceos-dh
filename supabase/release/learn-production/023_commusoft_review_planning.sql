-- DRAFT: function-local planning only. No capture, accounts, data or grants.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production review-planning target/checksum required';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_review_planning_v1')
 then raise exception 'Review planning already installed; inspect before retry';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='217a1d5eea6b0c632b2e4fa7d3b5ae251bfb388053a3d59f0283714c6f4e5ead')
 then raise exception 'Pinned review-planning prerequisite missing';end if;
 if (select md5(pg_get_functiondef('public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'::regprocedure))) is distinct from '1f00889016006e8e5fe6a0447d6fad40'
 then raise exception 'Prior work-search reader changed';end if;
end $$;
-- Search selectivity varies widely between an exact reference, a description
-- and an empty page query. A cached generic plan on the retained TEST inventory
-- repeatedly scanned the materialized latest-version set in a nested loop and
-- exceeded the API statement timeout. Replan this reader for its actual inputs.
-- The setting is scoped to the function; authority, output and data are unchanged.

alter function public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)
  set plan_cache_mode = force_custom_plan;

insert into of_learn_deploy.migrations values('learn_commusoft_review_planning_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
commit;
