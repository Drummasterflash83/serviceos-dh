\set ON_ERROR_STOP on
create role service_role;
create role anon;
create role authenticated;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
 version text primary key, name text not null, statements text[] not null
);
create table public.interactions (
 id uuid primary key, tenant_id uuid not null, source_table text not null,
 source_id uuid not null, processing_status text not null,
 unique(tenant_id,source_table,source_id)
);
create index interactions_tenant_processing_idx
 on public.interactions(tenant_id,processing_status);
create table public.email_messages (
 id uuid primary key, tenant_id uuid not null, provider text not null,
 raw_payload jsonb not null
);
create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer
 from public.interactions i
 left join public.email_messages m
  on i.source_table='email_messages' and m.tenant_id=i.tenant_id and m.id=i.source_id
 where i.tenant_id=p_tenant and i.processing_status='identity_review'
  and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
$$;
revoke all on function public.learn_identity_review_count(uuid)
 from public, anon, authenticated, service_role;
grant execute on function public.learn_identity_review_count(uuid) to service_role;
insert into public.email_messages values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',
  'gmail','{"label_ids":["DRAFT"]}'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',
  'gmail','{"label_ids":["INBOX"]}'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001',
  'microsoft_365','{"label_ids":["DRAFT"]}');
insert into public.interactions values
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',
  'email_messages','00000000-0000-0000-0000-000000000011','identity_review'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001',
  'email_messages','00000000-0000-0000-0000-000000000012','identity_review'),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000001',
  'email_messages','00000000-0000-0000-0000-000000000013','identity_review'),
 ('00000000-0000-0000-0000-000000000024','00000000-0000-0000-0000-000000000001',
  'email_messages','00000000-0000-0000-0000-000000000014','identity_review'),
 ('00000000-0000-0000-0000-000000000025','00000000-0000-0000-0000-000000000001',
  'slack_messages','00000000-0000-0000-0000-000000000015','identity_review');
do $check$ begin
 if md5(pg_get_functiondef(
   'public.learn_identity_review_count(uuid)'::regprocedure))
    <> 'fcf76cac657c2245b432cd1199dd48e6'
  or public.learn_identity_review_count('00000000-0000-0000-0000-000000000001')<>4
 then raise exception 'identity_review_release_fixture_changed';end if;
end $check$;
