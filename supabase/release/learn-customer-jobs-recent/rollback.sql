-- Restore the previous frontend before removing its additive reader.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
 if current_setting('serviceos.release_target',true) is null or current_setting('serviceos.release_target',true) not in ('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy') or current_setting('serviceos.release_sha256',true) is distinct from 'f327d3a3de104285afd385173156f38f44bf4161a6a9723e1594b091f1ab9643' then raise exception 'Exact recent-jobs target/source required';end if;
 if md5(pg_get_functiondef('public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text)'::regprocedure)) is distinct from 'fe0f5e375ccce3d9881010100f792937' or md5(pg_get_functiondef('public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure)) is distinct from '0176020ae98545133b07c0a841f5862b' then raise exception 'Recent-jobs reversal definition changed';end if;
end$$;
drop function public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text);
notify pgrst,'reload schema';
commit;
