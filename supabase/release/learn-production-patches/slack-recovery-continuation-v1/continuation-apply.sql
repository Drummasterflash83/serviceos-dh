begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'b40a4549a11381913bbe0f4e89a74c3b2c296f9cb69bd2efada031cd97b72dd1' then raise exception 'Exact continuation release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '311290e85ab8c30b9e81079a71156fc5|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '383ee9a76dee87a499e43f69df1480f4|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_claim_allowed(uuid,uuid)'::regprocedure) is distinct from 'e06723e3b884bbf56e38efdb86e0c2ab|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
end$guard$;
do $$declare d text;needle text:='j.id,j.payload)';begin
 d:=pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Reviewed history continuation payload differs';end if;
 execute replace(d,needle,'j.id,j.payload-''campaign_recovery_id'')');
end$$;
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'b40a4549a11381913bbe0f4e89a74c3b2c296f9cb69bd2efada031cd97b72dd1' then raise exception 'Exact continuation release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '1858a7e3b1714fbd4ccf35208ac9fd5d|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '383ee9a76dee87a499e43f69df1480f4|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_claim_allowed(uuid,uuid)'::regprocedure) is distinct from 'e06723e3b884bbf56e38efdb86e0c2ab|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
end$guard$;
notify pgrst,'reload schema';
commit;
