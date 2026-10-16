-- Revert only the inactive event-hint preparation after verifying it holds no
-- hints. Never discard captured source evidence or pending event hints.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if to_regclass('public.learn_slack_event_hints') is null
  or to_regprocedure('public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text)') is null
 then raise exception 'slack_event_rollback_baseline_missing';end if;
 if exists(select 1 from public.learn_slack_event_hints limit 1)
 then raise exception 'slack_event_rollback_has_hints';end if;
end$$;
drop function public.learn_slack_event_record(uuid,text,text,text,text,text,text,text,text);
drop table public.learn_slack_event_hints;
commit;
