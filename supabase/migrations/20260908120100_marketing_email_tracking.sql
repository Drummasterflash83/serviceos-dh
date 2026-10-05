-- ============================================================================
-- Marketing — basic open/click tracking (ACTIVATION, additive)
-- ----------------------------------------------------------------------------
-- One tracking row per delivery, written ONLY by the service role via the
-- public tracking endpoint (marketing-track) when a recipient opens the pixel
-- or follows a rewritten link. The adapter stays write-free: it embeds an
-- HMAC-signed pixel/redirect derived from the delivery id (no DB write); the
-- public endpoint verifies the signature and records the event here. Browsers
-- get no direct access to this table; the tenant reads aggregate counts only
-- through the summary RPC. No per-recipient behavioural profiling, no advanced
-- analytics — just opened_at / clicked_at as the mission scopes.
-- ============================================================================

create table if not exists marketing_email_tracking (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id) on delete cascade,
  delivery_id    uuid not null references marketing_deliveries (id) on delete cascade,
  opened_at      timestamptz,
  first_open_at  timestamptz,
  open_count     integer not null default 0 check (open_count >= 0),
  clicked_at     timestamptz,
  first_click_at timestamptz,
  click_count    integer not null default 0 check (click_count >= 0),
  last_click_url text check (last_click_url is null or length(last_click_url) <= 2048),
  created_at     timestamptz not null default now(),
  unique (delivery_id)
);
create index if not exists marketing_email_tracking_tenant_idx
  on marketing_email_tracking (tenant_id);

alter table marketing_email_tracking enable row level security;
-- no browser policy: reads/writes go only through service-role RPCs (deliveries
-- follow the same discipline). No SELECT/INSERT/UPDATE grants to anon/authenticated.
revoke all on marketing_email_tracking from anon, authenticated;

-- ── record one open/click event (service-role, called by marketing-track) ────
-- Resolves the tenant from the delivery, so the public endpoint never supplies
-- it. Idempotent-ish: first event sets first_*; every event advances the
-- rolling *_at + counter. A non-existent/al ien delivery records nothing and
-- alien delivery records nothing and returns false WITHOUT disclosing which
-- case occurred (the endpoint returns a
-- generic response regardless).
create or replace function marketing_track_record(p_delivery uuid, p_kind text, p_url text)
returns boolean
language plpgsql
as $$
declare
  v_tenant uuid;
begin
  if p_delivery is null or p_kind not in ('open', 'click') then
    return false;
  end if;
  select tenant_id into v_tenant from marketing_deliveries where id = p_delivery;
  if v_tenant is null then
    return false;
  end if;

  insert into marketing_email_tracking (tenant_id, delivery_id)
  values (v_tenant, p_delivery)
  on conflict (delivery_id) do nothing;

  if p_kind = 'open' then
    update marketing_email_tracking
       set opened_at = now(),
           first_open_at = coalesce(first_open_at, now()),
           open_count = open_count + 1
     where delivery_id = p_delivery;
  else
    update marketing_email_tracking
       set clicked_at = now(),
           first_click_at = coalesce(first_click_at, now()),
           click_count = click_count + 1,
           last_click_url = left(coalesce(p_url, ''), 2048)
     where delivery_id = p_delivery;
  end if;
  return true;
end $$;

-- ── aggregate tracking for a campaign (service-role, for the tenant UI) ──────
create or replace function marketing_campaign_tracking_summary(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare v jsonb;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'sent', count(*),
    'opened', count(*) filter (where t.opened_at is not null),
    'clicked', count(*) filter (where t.clicked_at is not null),
    'total_opens', coalesce(sum(t.open_count), 0),
    'total_clicks', coalesce(sum(t.click_count), 0))
  into v
  from marketing_broadcast_dispatches d
  left join marketing_email_tracking t
         on t.delivery_id = d.delivery_id and t.tenant_id = p_tenant
  where d.tenant_id = p_tenant
    and d.campaign_id = p_campaign
    and d.delivery_id is not null;
  return coalesce(v, jsonb_build_object('sent', 0, 'opened', 0, 'clicked', 0,
                                        'total_opens', 0, 'total_clicks', 0));
end $$;

revoke all on function marketing_track_record(uuid, text, text) from public;
revoke all on function marketing_campaign_tracking_summary(uuid, uuid) from public;
grant execute on function marketing_track_record(uuid, text, text) to service_role;
grant execute on function marketing_campaign_tracking_summary(uuid, uuid) to service_role;
