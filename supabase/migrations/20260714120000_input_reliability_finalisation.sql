-- ServiceOS — Input Reliability Finalisation v1 (phone projection content version).
--
-- WHY: the timestamp marker interactions.source_updated_at =
-- max(phone_calls.updated_at, latest_insight.updated_at) never goes clean.
-- phone-scheduled-sync → simwood-sync-calls re-upserts phone_calls every 5 min
-- (onConflict), and the set_updated_at BEFORE-UPDATE trigger bumps
-- phone_calls.updated_at = now() on every NO-OP re-upsert. So
-- pc.updated_at > source_updated_at is true again next cycle → interactions.sync
-- re-selected and rewrote all 221 calls forever.
--
-- FIX: mark projection state by the CONTENT of the projected source fields, not a
-- timestamp. `interactions.source_version` = md5 of (call fields + latest insight
-- summary/sentiment). A no-op re-upsert leaves the content identical → same hash →
-- not selected; a genuine call/insight change → different hash → selected once.
-- The hash has ONE definition (phone_projection_version) used by the selector, the
-- projector and the finaliser — no divergence, no now().
--
-- Non-destructive & idempotent: one additive column + three read-only functions.
-- The prior source_updated_at column is left in place (unused) — no destructive drop.

-- ---------------------------------------------------------------------------
-- interactions.source_version — deterministic projected-content marker
-- ---------------------------------------------------------------------------
alter table interactions
  add column if not exists source_version text;

-- ---------------------------------------------------------------------------
-- phone_projection_version — the ONE definition of a phone call's projected
-- content hash. Latest insight is chosen the same way the projector chooses it
-- (created_at desc). Timestamps are NOT hashed, so no-op re-upserts are invisible.
-- ---------------------------------------------------------------------------
create or replace function phone_projection_version(p_tenant_id uuid, p_call_id uuid)
returns text
language sql
stable
as $$
  select md5(
    coalesce(pc.direction, '')             || '|' ||
    coalesce(pc.from_number, '')           || '|' ||
    coalesce(pc.to_number, '')             || '|' ||
    coalesce(pc.started_at::text, '')      || '|' ||
    coalesce(pc.duration_seconds::text, '')|| '|' ||
    coalesce(pc.outcome, '')               || '|' ||
    coalesce(pc.linked_id, '')             || '|' ||
    coalesce(ins.summary, '')              || '|' ||
    coalesce(ins.sentiment, '')
  )
  from phone_calls pc
  left join lateral (
    select summary, sentiment
    from phone_ai_insights ai
    where ai.tenant_id = pc.tenant_id and ai.call_id = pc.id
    order by ai.created_at desc
    limit 1
  ) ins on true
  where pc.tenant_id = p_tenant_id and pc.id = p_call_id;
$$;

-- ---------------------------------------------------------------------------
-- phone_select_projectable — calls needing (re)projection, by CONTENT version.
-- Returns the columns the projector needs PLUS the computed source_version, so
-- the projector stores exactly the value the selector compared against.
-- ---------------------------------------------------------------------------
drop function if exists phone_select_projectable(uuid, int);
create function phone_select_projectable(p_tenant_id uuid, p_limit int default 500)
returns table (
  id uuid,
  provider_call_id text,
  direction text,
  from_number text,
  to_number text,
  started_at timestamptz,
  duration_seconds integer,
  outcome text,
  linked_id text,
  created_at timestamptz,
  source_version text
)
language sql
stable
as $$
  with computed as (
    select
      pc.id, pc.tenant_id, pc.provider_call_id, pc.direction, pc.from_number,
      pc.to_number, pc.started_at, pc.duration_seconds, pc.outcome, pc.linked_id,
      pc.created_at,
      phone_projection_version(pc.tenant_id, pc.id) as source_version
    from phone_calls pc
    where pc.tenant_id = p_tenant_id
  )
  select c.id, c.provider_call_id, c.direction, c.from_number, c.to_number,
         c.started_at, c.duration_seconds, c.outcome, c.linked_id, c.created_at,
         c.source_version
  from computed c
  left join interactions i
    on i.tenant_id = c.tenant_id
   and i.source_table = 'phone_calls'
   and i.source_id = c.id
  where i.id is null
     or i.source_version is distinct from c.source_version
  order by coalesce(c.started_at, c.created_at) asc
  limit greatest(1, least(2000, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- phone_projection_diagnostics — WHY each call is (or isn't) selected (§3).
-- Codes + timestamps only — never transcript/audio content.
-- ---------------------------------------------------------------------------
create or replace function phone_projection_diagnostics(p_tenant_id uuid, p_limit int default 500)
returns table (
  call_id uuid,
  interaction_id uuid,
  call_updated_at timestamptz,
  insight_updated_at timestamptz,
  stored_version text,
  computed_version text,
  dirty_reason text
)
language sql
stable
as $$
  select
    pc.id as call_id,
    i.id as interaction_id,
    pc.updated_at as call_updated_at,
    ins.updated_at as insight_updated_at,
    i.source_version as stored_version,
    phone_projection_version(pc.tenant_id, pc.id) as computed_version,
    case
      when i.id is null then 'missing_interaction'
      when i.source_version is null then 'missing_source_marker'
      when i.source_version is distinct from phone_projection_version(pc.tenant_id, pc.id)
        then 'version_changed'
      else 'clean'
    end as dirty_reason
  from phone_calls pc
  left join interactions i
    on i.tenant_id = pc.tenant_id
   and i.source_table = 'phone_calls'
   and i.source_id = pc.id
  left join lateral (
    select updated_at
    from phone_ai_insights ai
    where ai.tenant_id = pc.tenant_id and ai.call_id = pc.id
    order by ai.created_at desc
    limit 1
  ) ins on true
  where pc.tenant_id = p_tenant_id
  order by coalesce(pc.started_at, pc.created_at) asc
  limit greatest(1, least(2000, p_limit));
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (Edge Functions). Never authenticated/public.
-- ---------------------------------------------------------------------------
revoke all on function phone_projection_version(uuid, uuid) from public;
revoke all on function phone_select_projectable(uuid, int) from public;
revoke all on function phone_projection_diagnostics(uuid, int) from public;
grant execute on function phone_projection_version(uuid, uuid) to service_role;
grant execute on function phone_select_projectable(uuid, int) to service_role;
grant execute on function phone_projection_diagnostics(uuid, int) to service_role;
