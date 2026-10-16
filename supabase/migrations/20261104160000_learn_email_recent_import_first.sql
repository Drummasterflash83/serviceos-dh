-- The older Email lane has an exact fallback, but its occurrence-ordered first
-- pass can scan years of already-linked mail before finding a newly imported
-- old message. Start with recently retained unlinked rows in ingestion order.
-- Existing source rows, receipts, publication rules and the full fallback stay
-- unchanged. This migration activates no new job or provider access.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$declare definition text; baseline text; before_text text; after_text text;
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 baseline:=md5(definition);
 if baseline not in ('c5cf30c0855e27ce6ca70acf5b41cab3',
                     'eccd3929d3be927513b7237e503f2d7c')
 then raise exception 'recent_email_selector_baseline_changed';end if;
 if not exists(select 1 from pg_attribute
  where attrelid='public.email_messages'::regclass and attname='created_at'
    and not attisdropped)
 then raise exception 'email_created_at_missing';end if;
 before_text:='  where m.tenant_id=p_tenant'||chr(10)||
   '   and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id and i.source_table=''email_messages'' and i.source_id=m.id)';
 after_text:='  where m.tenant_id=p_tenant'||chr(10)||
   '   and m.created_at>=clock_timestamp()-interval ''30 days'''||chr(10)||
   '   and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id and i.source_table=''email_messages'' and i.source_id=m.id)';
 if position(before_text in definition)=0 or position(after_text in definition)>0
 then raise exception 'recent_email_selector_predicate_changed';end if;
 definition:=replace(definition,before_text,after_text);
 before_text:='  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id'||chr(10)||
   '  limit least(2000,greatest(200,bound+100))';
 after_text:='  order by m.created_at desc,m.id desc'||chr(10)||
   '  limit least(2000,greatest(200,bound+100))';
 if position(before_text in definition)=0 or position(after_text in definition)>0
 then raise exception 'recent_email_selector_order_changed';end if;
 definition:=replace(definition,before_text,after_text);
 if position('return query select * from public.learn_projection_pending_full(p_tenant,p_source,bound);' in definition)=0
 then raise exception 'full_projection_fallback_missing';end if;
 execute definition;
end$$;
create index learn_email_projection_recent_import_idx
 on public.email_messages(tenant_id,created_at desc,id desc);
commit;
