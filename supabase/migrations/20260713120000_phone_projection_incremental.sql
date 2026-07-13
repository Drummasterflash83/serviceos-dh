-- ServiceOS — Phone interaction projection: incremental selection (v1).
--
-- WHY: interactions.sync re-selected the newest 500 phone_calls and upserted ALL
-- of them every 5 minutes (phone_processed=221 forever), even though every call
-- already had a canonical interaction. The phone PIPELINE finaliser
-- (_shared/phone_enrich.ts) already creates/refreshes the interaction + publishes
-- interaction.ready for recording-based calls, so the scheduled projector only
-- needs to be a REPAIR/BACKFILL path: new calls with no interaction, calls whose
-- source row or AI insight changed after projection, and legacy rows.
--
-- This adds a stable projection marker (`interactions.source_updated_at`) — set to
-- the MAX source timestamp at projection time — and a DB selector that returns
-- only genuinely-projectable phone calls, oldest first, bounded. interactions.
-- updated_at churns on every no-op upsert (set_updated_at trigger), so it CANNOT
-- be the marker; source_updated_at only ever holds real source timestamps.
--
-- Non-destructive & idempotent: one additive nullable column + read-only function
-- + additive indexes. No data mutation. Service-role-only grant on the function.

-- ---------------------------------------------------------------------------
-- interactions.source_updated_at — the max source timestamp at projection time
-- ---------------------------------------------------------------------------
alter table interactions
  add column if not exists source_updated_at timestamptz;

-- Selector join / completeness + duplicate checks by (tenant, type, source).
create index if not exists interactions_tenant_type_source_idx
  on interactions (tenant_id, interaction_type, source_id);

-- Latest-insight-per-call lookup used by the selector.
create index if not exists phone_ai_insights_call_updated_idx
  on phone_ai_insights (call_id, updated_at);

-- ---------------------------------------------------------------------------
-- phone_select_projectable — the ONLY calls that genuinely need (re)projection
-- ---------------------------------------------------------------------------
-- Eligible when:
--   * no canonical interaction exists yet, OR
--   * the interaction has no projection marker (legacy / pipeline-created → repair
--     once), OR
--   * the source call changed after projection (phone_calls.updated_at newer), OR
--   * the latest AI insight changed after projection (insight.updated_at newer).
-- Oldest-eligible first (no starvation), bounded. An unchanged call is NEVER
-- returned, so a steady-state run selects zero.
create or replace function phone_select_projectable(
  p_tenant_id uuid,
  p_limit int default 500
)
returns setof phone_calls
language sql
stable
as $$
  select pc.*
  from phone_calls pc
  left join interactions i
    on i.tenant_id = pc.tenant_id
   and i.source_table = 'phone_calls'
   and i.source_id = pc.id
  left join lateral (
    select max(ai.updated_at) as insight_updated_at
    from phone_ai_insights ai
    where ai.tenant_id = pc.tenant_id
      and ai.call_id = pc.id
  ) ins on true
  where pc.tenant_id = p_tenant_id
    and (
      i.id is null
      or i.source_updated_at is null
      or pc.updated_at > i.source_updated_at
      or (ins.insight_updated_at is not null and ins.insight_updated_at > i.source_updated_at)
    )
  order by coalesce(pc.started_at, pc.created_at) asc
  limit greatest(1, least(2000, p_limit));
$$;

revoke all on function phone_select_projectable(uuid, int) from public;
grant execute on function phone_select_projectable(uuid, int) to service_role;
