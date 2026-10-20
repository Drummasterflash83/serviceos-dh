-- Synthetic-only minimal schema for 20261109210000_new_dawn_learn_daily_stats.sql.
-- Run inside a fresh disposable PostgreSQL 17 database, never on LIVE.
create schema auth;
create table auth.users(id uuid primary key, deleted_at timestamptz, banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
create table public.tenants(id uuid primary key, status text not null);
create table public.profiles(id uuid primary key, tenant_id uuid not null, role text not null);
create table public.platform_authority_grants(
  profile_id uuid, permission text, effective_from timestamptz, effective_to timestamptz);
create table public.view_as_context(
  actor_user_id uuid, ended_at timestamptz, expires_at timestamptz);
create table public.feature_flags(tenant_id uuid, flag text, value jsonb);
create table public.phone_calls(tenant_id uuid, created_at timestamptz);
create table public.phone_recordings(tenant_id uuid, created_at timestamptz);
create table public.email_messages(tenant_id uuid, created_at timestamptz);
create table public.slack_messages(
  id uuid primary key, tenant_id uuid, team_id text, channel_id text,
  source_version text, provider_payload jsonb, created_at timestamptz);
create table public.slack_message_versions(
  id uuid primary key, tenant_id uuid, message_id uuid, source_version text);
create table public.slack_channel_visibility_receipts(
  id uuid primary key, tenant_id uuid, team_id text, channel_id text, evidence jsonb);
create table public.slack_source_visibility_proofs(receipt_id uuid, version_id uuid);
create table public.learn_business_input_pages(
  id uuid primary key, tenant_id uuid, connection_id uuid, provider text,
  collection text, committed_at timestamptz);
create table public.learn_business_input_versions(
  id uuid primary key, tenant_id uuid, connection_id uuid, provider text,
  collection text, external_id text, first_seen_at timestamptz, payload jsonb);
create table public.learn_business_input_observations(
  page_id uuid, version_id uuid, ordinal integer);
create table public.controlplane_change_log(
  id uuid, tenant_id uuid, actor text, action text, resource_type text,
  resource_id text, after jsonb, reason text, correlation_id text,
  view_as_active boolean, source text);
create function public.learn_operator_input_access(p_tenant uuid, p_actor uuid, p_write boolean)
returns void language plpgsql as $$begin
  if not exists(select 1 from public.platform_authority_grants
    where profile_id = p_actor and permission = 'platform.controlplane.admin') then
    raise exception 'operator_forbidden' using errcode = '42501';
  end if;
end$$;

insert into public.tenants values
  ('00000000-0000-0000-0000-000000000001', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'active');
insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000011'),
  ('00000000-0000-0000-0000-000000000022'),
  ('00000000-0000-0000-0000-000000000033');
insert into public.profiles values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000002', 'owner'),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001', 'owner');
insert into public.platform_authority_grants(profile_id, permission) values
  ('00000000-0000-0000-0000-000000000033', 'platform.controlplane.admin');
insert into public.feature_flags values
  ('00000000-0000-0000-0000-000000000001', 'new_dawn.learn_daily_stats', 'true'),
  ('00000000-0000-0000-0000-000000000001', 'new_dawn.learn_daily_stats.operator_preview', 'true'),
  ('00000000-0000-0000-0000-000000000002', 'new_dawn.learn_daily_stats', 'true');
insert into public.phone_calls values
  ('00000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000002', now());
insert into public.phone_recordings values
  ('00000000-0000-0000-0000-000000000001', now() - interval '2 days');
insert into public.email_messages values
  ('00000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000000002', now());
insert into public.learn_business_input_versions values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', '001', now() - interval '2 days', '{"id":1}'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', '001', now(), '{"id":1,"status":"Open"}'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', '002', now(), '{"id":2}'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'properties', '10', now(), '{"type":"customer"}'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'properties', '11', now(), '{"type":"workaddress"}'),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', 'FOREIGN', now(), '{"id":3}');
insert into public.learn_business_input_pages values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', now()),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099', 'commusoft', 'jobs', now());
insert into public.learn_business_input_observations values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 1),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', 1),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000103', 2),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000106', 1);
insert into public.slack_messages values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001', 'T', 'PUBLIC', 'v1', '{"type":"message"}', now()),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000001', 'T', 'PRIVATE', 'v1', '{"type":"message"}', now()),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000001', 'T', 'PUBLIC', 'v1', '{"type":"message","subtype":"tombstone","hidden":true}', now());
insert into public.slack_message_versions values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000301', 'v1'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000302', 'v1'),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000303', 'v1');
insert into public.slack_channel_visibility_receipts values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', 'T', 'PUBLIC', '{"version":"slack-capture-visibility/1","is_channel":true,"is_private":false,"is_im":false,"is_mpim":false,"is_shared":false,"is_ext_shared":false,"is_org_shared":false,"is_pending_ext_shared":false,"pending_shared":false}'),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', 'T', 'PRIVATE', '{"version":"slack-capture-visibility/1","is_channel":true,"is_private":true,"is_im":false,"is_mpim":false,"is_shared":false,"is_ext_shared":false,"is_org_shared":false,"is_pending_ext_shared":false,"pending_shared":false}');
insert into public.slack_source_visibility_proofs values
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000401'),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000402'),
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000403');
