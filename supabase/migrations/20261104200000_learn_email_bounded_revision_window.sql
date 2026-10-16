-- Keep the retained older Email selector inside the worker's query budget.
-- A ten-row request currently revises 200 newly imported candidates before
-- returning; a bounded 32-candidate window preserves held-source skipping and
-- the exact full-selector fallback while avoiding that unnecessary work.
-- The function remains service-role-only and never changes a source row.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $$declare definition text; before_text text; after_text text;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition) not in ('c2ca034cf37189240e8a07b30aedd368',
                            '0ffedc2f069d2d594bfb282fdf629985')
 then raise exception 'bounded_email_window_baseline_changed';end if;
 if position('and m.created_at>=clock_timestamp()-interval ''30 days''' in definition)=0
   or position('return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);' in definition)=0
 then raise exception 'bounded_email_window_contract_changed';end if;
 before_text:='  order by m.created_at desc,m.id desc'||chr(10)||
   '  limit least(2000,greatest(200,bound+100))';
 after_text:='  order by m.created_at desc,m.id desc'||chr(10)||
   '  limit least(2000,greatest(32,bound+22))';
 if position(before_text in definition)=0 or position(after_text in definition)>0
 then raise exception 'bounded_email_window_anchor_changed';end if;
 definition:=replace(definition,before_text,after_text);
 execute definition;
end$$;
-- This service-only SECURITY DEFINER selector has its own bounded read budget.
-- The generic PostgREST authenticator's shorter limit otherwise cancels a
-- legitimate catch-up batch under variable database load.
alter function public.learn_projection_pending(uuid,text,integer)
 set statement_timeout='25s';
commit;
