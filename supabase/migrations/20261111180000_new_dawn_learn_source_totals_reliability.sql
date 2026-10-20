-- Give each communication source its own audited count so a growing email
-- archive cannot withhold the Phone counts. Keep the old communications part
-- for already-open tabs; the new client requests calls, recordings and emails
-- separately. The Slack proof and Commusoft count contracts stay unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.new_dawn_learn_daily_stats_part(
  p_tenant uuid, p_part text, p_operator_reason text default null
) returns jsonb language plpgsql security definer
  set search_path = pg_catalog set statement_timeout = '20s' as $$
declare
  actor uuid := auth.uid();
  operator_read boolean := p_operator_reason is not null;
  as_of timestamptz := statement_timestamp();
  day_start timestamptz;
  counts jsonb;
  recent_job jsonb;
  audit_id uuid;
begin
  if p_tenant is null or actor is null or p_part is null
    or p_part not in ('calls', 'recordings', 'emails',
      'communications', 'slack', 'business') then
    raise exception 'learn_daily_stats_part_invalid' using errcode = '22023';
  end if;
  perform 1 from auth.users u where u.id = actor and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= as_of) for share;
  if not found then raise exception 'learn_daily_stats_forbidden' using errcode = '42501'; end if;

  if operator_read then
    if length(btrim(p_operator_reason)) not between 3 and 500 then
      raise exception 'learn_daily_stats_reason_invalid' using errcode = '22023';
    end if;
    perform public.learn_operator_input_access(p_tenant, actor, true);
  else
    perform 1 from public.profiles p join public.tenants t on t.id = p.tenant_id
      where p.id = actor and p.tenant_id = p_tenant and p.role in ('owner', 'admin')
        and t.status = 'active' for share of p, t;
    if not found or exists(select 1 from public.view_as_context v
        where v.actor_user_id = actor and v.ended_at is null
          and (v.expires_at is null or v.expires_at > as_of))
      or exists(select 1 from public.platform_authority_grants g
        where g.profile_id = actor and g.permission in
          ('platform.controlplane.view', 'platform.controlplane.admin')
          and coalesce(g.effective_from, '-infinity') <= as_of
          and coalesce(g.effective_to, 'infinity') > as_of) then
      raise exception 'learn_daily_stats_forbidden' using errcode = '42501';
    end if;
  end if;

  perform 1 from public.feature_flags f where f.tenant_id = p_tenant
    and f.flag = case when operator_read then 'new_dawn.learn_daily_stats.operator_preview'
      else 'new_dawn.learn_daily_stats' end and f.value = 'true'::jsonb for share;
  if not found then raise exception 'learn_daily_stats_disabled' using errcode = '42501'; end if;

  day_start := date_trunc('day', as_of at time zone 'Europe/London') at time zone 'Europe/London';
  if p_part = 'calls' then
    select jsonb_build_object('calls', jsonb_build_object(
      'today', count(*) filter (where created_at >= day_start),
      'total', count(*))) into counts from public.phone_calls
      where tenant_id = p_tenant and created_at <= as_of;
  elsif p_part = 'recordings' then
    select jsonb_build_object('recordings', jsonb_build_object(
      'today', count(*) filter (where created_at >= day_start),
      'total', count(*))) into counts from public.phone_recordings
      where tenant_id = p_tenant and created_at <= as_of;
  elsif p_part = 'emails' then
    select jsonb_build_object('emails', jsonb_build_object(
      'today', count(*) filter (where created_at >= day_start),
      'total', count(*))) into counts from public.email_messages
      where tenant_id = p_tenant and created_at <= as_of;
  elsif p_part = 'communications' then
    select jsonb_build_object(
      'calls', (select jsonb_build_object('today', count(*) filter (where created_at >= day_start),
        'total', count(*)) from public.phone_calls
        where tenant_id = p_tenant and created_at <= as_of),
      'recordings', (select jsonb_build_object('today', count(*) filter (where created_at >= day_start),
        'total', count(*)) from public.phone_recordings
        where tenant_id = p_tenant and created_at <= as_of),
      'emails', (select jsonb_build_object('today', count(*) filter (where created_at >= day_start),
        'total', count(*)) from public.email_messages
        where tenant_id = p_tenant and created_at <= as_of)
    ) into counts;
  elsif p_part = 'slack' then
    -- Count only current public-channel versions with their immutable proof;
    -- private channels and individual/group DMs remain excluded.
    select jsonb_build_object('slack', jsonb_build_object(
      'today', count(*) filter (where s.created_at >= day_start), 'total', count(*)
    )) into counts
    from public.slack_messages s
    where s.tenant_id = p_tenant and s.created_at <= as_of
      and not coalesce((s.provider_payload->>'type' = 'message'
        and s.provider_payload->>'subtype' = 'tombstone'
        and s.provider_payload->'hidden' = 'true'::jsonb), false)
      and exists (
        select 1 from public.slack_message_versions v
        join public.slack_source_visibility_proofs proof on proof.version_id = v.id
        join public.slack_channel_visibility_receipts visibility
          on visibility.id = proof.receipt_id and visibility.tenant_id = p_tenant
        where v.tenant_id = p_tenant and v.message_id = s.id
          and v.source_version = s.source_version
          and visibility.team_id = s.team_id and visibility.channel_id = s.channel_id
          and visibility.evidence->>'version' = 'slack-capture-visibility/1'
          and visibility.evidence->'is_channel' = 'true'::jsonb
          and visibility.evidence->'is_private' = 'false'::jsonb
          and visibility.evidence->'is_im' = 'false'::jsonb
          and visibility.evidence->'is_mpim' = 'false'::jsonb
          and visibility.evidence->'is_shared' = 'false'::jsonb
          and visibility.evidence->'is_ext_shared' = 'false'::jsonb
          and visibility.evidence->'is_org_shared' = 'false'::jsonb
          and visibility.evidence->'is_pending_ext_shared' = 'false'::jsonb
          and visibility.evidence->'pending_shared' = 'false'::jsonb
      );
  else
    -- One identity per Commusoft source ID; revisions do not inflate totals.
    with source_identity as materialized (
      select v.connection_id, v.collection, v.external_id,
        min(v.first_seen_at) first_saved_at,
        bool_and(coalesce(v.payload->>'type' = 'customer', false)) is_customer,
        bool_and(coalesce(v.payload->>'type' = 'workaddress', false)) is_site
      from public.learn_business_input_versions v
      where v.tenant_id = p_tenant and v.provider = 'commusoft'
        and v.collection in ('jobs', 'properties')
      group by v.connection_id, v.collection, v.external_id
    )
    select jsonb_build_object(
      'jobs', (select jsonb_build_object('today', count(*) filter (where first_saved_at >= day_start),
        'total', count(*)) from source_identity where collection = 'jobs' and first_saved_at <= as_of),
      'customers', (select jsonb_build_object('today', count(*) filter (where first_saved_at >= day_start),
        'total', count(*)) from source_identity where collection = 'properties'
          and is_customer and first_saved_at <= as_of),
      'sites', (select jsonb_build_object('today', count(*) filter (where first_saved_at >= day_start),
        'total', count(*)) from source_identity where collection = 'properties'
          and is_site and first_saved_at <= as_of)
    ) into counts;

    -- The last committed page can contain a revision to an older job. Use the
    -- source-created order already used by the provider freshness reader, and
    -- show when that job identity was first retained in LEARN.
    select jsonb_build_object('number', v.external_id,
      'saved_at', (select min(first_seen_at)
        from public.learn_business_input_versions first_version
        where first_version.tenant_id = v.tenant_id
          and first_version.connection_id = v.connection_id
          and first_version.provider = v.provider
          and first_version.collection = v.collection
          and first_version.external_id = v.external_id))
      into recent_job
    from public.learn_business_input_versions v
    where v.tenant_id = p_tenant and v.provider = 'commusoft'
      and v.collection = 'jobs' and v.first_seen_at <= as_of
      and v.external_id ~ '^[1-9][0-9]{0,15}$'
      and v.payload->>'createdOnDateTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    order by v.payload->>'createdOnDateTime' desc,
      v.external_id::numeric desc limit 1;
  end if;

  if operator_read then perform public.learn_operator_input_access(p_tenant, actor, true);
  else
    perform 1 from public.profiles p join public.tenants t on t.id = p.tenant_id
      where p.id = actor and p.tenant_id = p_tenant and p.role in ('owner', 'admin')
        and t.status = 'active' for share of p, t;
    if not found or exists(select 1 from public.view_as_context v
        where v.actor_user_id = actor and v.ended_at is null
          and (v.expires_at is null or v.expires_at > clock_timestamp()))
      or exists(select 1 from public.platform_authority_grants g
        where g.profile_id = actor and g.permission in
          ('platform.controlplane.view', 'platform.controlplane.admin')
          and coalesce(g.effective_from, '-infinity') <= clock_timestamp()
          and coalesce(g.effective_to, 'infinity') > clock_timestamp()) then
      raise exception 'learn_daily_stats_forbidden' using errcode = '42501';
    end if;
  end if;
  audit_id := gen_random_uuid();
  insert into public.controlplane_change_log
    (id, tenant_id, actor, action, resource_type, resource_id, after, reason,
      correlation_id, view_as_active, source)
  values (audit_id, p_tenant, actor::text,
    case when operator_read then 'learn.daily_stats_part_preview' else 'learn.daily_stats_part_read' end,
    'learn_saved_inputs', p_tenant::text,
    jsonb_build_object('part', p_part, 'day_start', day_start, 'as_of', as_of),
    case when operator_read then btrim(p_operator_reason)
      else 'Client LEARN saved-input summary' end,
    audit_id::text, false, 'new-dawn-learn-daily-stats');
  perform set_config('response.headers', '[{"Cache-Control":"no-store"}]', true);
  return jsonb_build_object('version', 'new-dawn-learn-daily-stats-part/1',
    'part', p_part, 'tenant_id', p_tenant, 'actor_id', actor,
    'observed_at', as_of, 'day_start', day_start, 'timezone', 'Europe/London',
    'counts', counts, 'latest_saved_job', recent_job,
    'provider_newest_job', null, 'provider_newest_state', 'not_checked',
    'audit_id', audit_id, 'scope', 'retained_saved_rows');
end $$;
revoke all on function public.new_dawn_learn_daily_stats_part(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.new_dawn_learn_daily_stats_part(uuid, text, text)
  to authenticated;
commit;
