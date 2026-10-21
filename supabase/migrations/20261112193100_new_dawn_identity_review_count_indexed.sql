-- Preserve the established review-count semantics while avoiding a join against
-- every retained Email source row. Run only after the draft index is valid.
begin;

do $guard$
begin
 if md5(pg_get_functiondef('public.learn_identity_review_count(uuid)'::regprocedure))
    <> 'fcf76cac657c2245b432cd1199dd48e6'
    or not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      join pg_index x on x.indexrelid=c.oid
      where n.nspname='public'
        and c.relname='learn_email_gmail_draft_review_idx'
        and x.indisvalid and x.indisready
        and pg_get_indexdef(c.oid) =
          'CREATE INDEX learn_email_gmail_draft_review_idx ON public.email_messages USING btree (tenant_id, id) WHERE ((provider = ''gmail''::text) AND ((raw_payload -> ''label_ids''::text) @> ''["DRAFT"]''::jsonb))'
    )
 then raise exception 'identity_review_count_source_or_index_changed';
 end if;
end $guard$;

create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select (all_reviews.n - gmail_drafts.n)::integer
 from (
  select count(*) n
  from public.interactions i
  where i.tenant_id=p_tenant and i.processing_status='identity_review'
 ) all_reviews
 cross join (
  select count(*) n
  from public.email_messages m
  where m.tenant_id=p_tenant
   and m.provider='gmail'
   and (m.raw_payload->'label_ids') @> '["DRAFT"]'::jsonb
   and exists (
    select 1 from public.interactions i
    where i.tenant_id=m.tenant_id and i.source_table='email_messages'
     and i.source_id=m.id and i.processing_status='identity_review'
   )
 ) gmail_drafts
$$;

-- CREATE OR REPLACE preserves the existing service-role-only EXECUTE grants.
commit;
