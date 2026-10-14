-- Restore the previous frontend first; retained Slack messages and history remain.
begin;
set local lock_timeout='3s';
do $$begin
 if md5(pg_get_functiondef('public.learn_slack_card_source_read(uuid,uuid,text)'::regprocedure)) is distinct from '3d7159aa266c900aaf6f983d8cd33c9d'
 then raise exception 'Slack reader differs; inspect before reversal';end if;
end$$;
drop function public.learn_slack_card_source_read(uuid,uuid,text);
notify pgrst,'reload schema';
commit;
