-- Receipt-complete campaign replies must no longer retain a queued label.
-- The campaign step previously returned once aggregate progress was complete,
-- before normalising the last completed thread members. Move that existing
-- receipt-based normalisation before the early return, then repair retained
-- labels with the same verified completion predicate. No provider request,
-- campaign approval, message or access policy changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare d text;
 early text:=' select * into a from public.connector_accounts where id=c.account_id and tenant_id=h.tenant_id for update;';
 normalize text:=E' update public.slack_history_campaign_threads mt set state=\'captured\' where mt.campaign_id=h.id and mt.account_id=a.id\n and mt.state<>\'captured\' and public.learn_slack_campaign_thread_import_complete(mt.current_import);';
begin
 d:=pg_get_functiondef('public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure);
 if md5(d)<>'cbc8c540043042d736f53d5cc5971e53'
  or length(d)-length(replace(d,early,''))<>length(early)
  or length(d)-length(replace(d,normalize,''))<>length(normalize)
 then raise exception 'slack_campaign_thread_step_baseline_changed';end if;
 d:=replace(d,normalize,'');
 d:=replace(d,early,early||E'\n'||normalize);
 execute d;
end$$;

update public.slack_history_campaign_threads member set state='captured'
 where member.state='queued' and member.current_import is not null
 and public.learn_slack_campaign_thread_import_complete(member.current_import);
commit;
