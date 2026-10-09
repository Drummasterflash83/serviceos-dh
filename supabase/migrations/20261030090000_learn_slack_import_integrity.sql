-- Preserve Slack source and approval evidence, and align setup with the
-- serialized owner/preview authority introduced for governed work actions.
begin;
-- A narrow service-only writer avoids granting direct queue/source DML merely
-- to publish a validated Slack page. Its body checks job, tenant and account.
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 security definer;
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 set search_path=public,pg_temp;
do $$ declare t text;begin
 foreach t in array array['slack_messages','slack_message_versions','slack_history_imports'] loop
  execute format('create trigger learn_slack_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',t);
 end loop;
end $$;
create trigger learn_slack_retain_message before delete on public.slack_messages
 for each row execute function public.slack_version_immutable();

do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:='errcode=''40001''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Reviewed Slack conflict contract changed';
 end if;
 definition:=replace(definition,needle,'errcode=''PT409''');
 needle:=E'begin\n if auth.uid() is null';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then
  raise exception 'Reviewed Slack authority contract changed';
 end if;
 definition:=replace(definition,needle,$patch$begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Slack approval requires a fresh read-committed snapshot' using errcode='22023';
 end if;
 -- Same order as governed work. Authority mutations take the matching tenant
 -- mutex; privileged truncation takes the global exclusive lock.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null$patch$);
 execute definition;
end $$;
commit;
