\set ON_ERROR_STOP on
\timing on

create table public.interactions (
 id uuid primary key,
 tenant_id uuid not null,
 source_table text not null,
 source_id uuid not null,
 processing_status text not null,
 unique(tenant_id, source_table, source_id)
);
create index interactions_tenant_processing_idx
 on public.interactions(tenant_id,processing_status);
create table public.email_messages (
 id uuid primary key,
 tenant_id uuid not null,
 provider text not null,
 raw_payload jsonb not null
);
create index email_messages_tenant_id_idx on public.email_messages(tenant_id);

-- A mixed, retained-source fixture with a large Email body, orphan source
-- references, another provider carrying a DRAFT label, and two tenants.
insert into public.interactions(id,tenant_id,source_table,source_id,processing_status)
select md5(('interaction-'||n)::text)::uuid,
 case when n%997=0 then '00000000-0000-0000-0000-000000000002'::uuid
 else '00000000-0000-0000-0000-000000000001'::uuid end,
 case when n%3=0 then 'slack_messages' else 'email_messages' end,
 md5(('source-'||n)::text)::uuid,
 case when n%17=0 then 'processed' else 'identity_review' end
from generate_series(1,180000) n;

insert into public.email_messages(id,tenant_id,provider,raw_payload)
select md5(('source-'||n)::text)::uuid,
 case when n%997=0 then '00000000-0000-0000-0000-000000000002'::uuid
 else '00000000-0000-0000-0000-000000000001'::uuid end,
 case when n%107=0 then 'microsoft_365' else 'gmail' end,
 jsonb_build_object('label_ids',case when n%127=0 then jsonb_build_array('DRAFT')
   when n%131=0 then jsonb_build_array('INBOX') else jsonb_build_array() end,
  'body',repeat(md5(n::text),100))
from generate_series(1,180000) n
where n%3<>0 and n%211<>0;

analyze public.interactions;
analyze public.email_messages;

do $fixture$
begin
 if not exists(select 1 from public.interactions i left join public.email_messages m
   on m.tenant_id=i.tenant_id and m.id=i.source_id
   where i.source_table='email_messages' and m.id is null)
  or not exists(select 1 from public.email_messages
   where provider<>'gmail' and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb)
  or not exists(select 1 from public.email_messages
   where provider='gmail' and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb)
  or not exists(select 1 from public.interactions
   where source_table='slack_messages' and processing_status='identity_review')
 then raise exception 'identity_review_fixture_incomplete';end if;
end $fixture$;

-- Baseline body copied from the installed migration.
create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer
 from public.interactions i
 left join public.email_messages m
  on i.source_table='email_messages' and m.tenant_id=i.tenant_id and m.id=i.source_id
 where i.tenant_id=p_tenant and i.processing_status='identity_review'
  and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
$$;

create temp table expected as
select tenant_id, public.learn_identity_review_count(tenant_id) n
from (select distinct tenant_id from public.interactions) tenants;

\ir ../../supabase/migrations/20261112193000_new_dawn_identity_review_gmail_draft_index.sql
\ir ../../supabase/migrations/20261112193100_new_dawn_identity_review_count_indexed.sql

do $check$
declare mismatches integer;
begin
 select count(*) into mismatches from expected e
 where e.n is distinct from public.learn_identity_review_count(e.tenant_id);
 if mismatches<>0 then raise exception 'identity_review_count_mismatch:%',mismatches;end if;
 if public.learn_identity_review_count('00000000-0000-0000-0000-000000000003')<>0
 then raise exception 'empty_tenant_mismatch';end if;
end $check$;

-- Both components should be index-backed. No private message content is emitted.
explain (analyze,buffers)
select (all_reviews.n-gmail_drafts.n)::integer
from (select count(*) n from public.interactions i
 where i.tenant_id='00000000-0000-0000-0000-000000000001'
  and i.processing_status='identity_review') all_reviews
cross join (select count(*) n from public.email_messages m
 where m.tenant_id='00000000-0000-0000-0000-000000000001'
  and m.provider='gmail'
  and (m.raw_payload->'label_ids') @> '["DRAFT"]'::jsonb
  and exists(select 1 from public.interactions i
   where i.tenant_id=m.tenant_id and i.source_table='email_messages'
    and i.source_id=m.id and i.processing_status='identity_review')) gmail_drafts;

select 'synthetic_identity_review_count_pass' as result,
 (select sum(n) from expected) as expected_total,
 (select sum(public.learn_identity_review_count(tenant_id)) from expected) as actual_total;
