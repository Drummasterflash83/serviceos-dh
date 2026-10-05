-- ServiceOS — Security-2: tenant-scoped RLS read policies + feed-ready hardening.
--
-- Makes the phone_* data safe to read directly from the authenticated frontend:
--   * SELECT-only RLS policies scoped to the caller's profile.tenant_id.
--   * No INSERT/UPDATE/DELETE policies — writes stay server-side (service role
--     bypasses RLS). No public/anon reads.
--   * Non-destructive hardening: a nullable transcript_id link, feed/join
--     indexes, and uniqueness that reflects the pipeline's one-row invariants.
--
-- Idempotent: helpers use CREATE OR REPLACE; policies are dropped-if-exists then
-- recreated; indexes/column use IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- Caller helpers (SECURITY DEFINER so they resolve regardless of profiles RLS)
-- ---------------------------------------------------------------------------
create or replace function current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Schema hardening (non-destructive)
-- ---------------------------------------------------------------------------

-- Direct link from an insight to its source transcript (kept in raw_payload too).
alter table phone_ai_insights add column if not exists transcript_id uuid;

-- Feed + join indexes.
create index if not exists phone_calls_feed_idx on phone_calls (tenant_id, started_at desc);
create index if not exists phone_recordings_feed_idx on phone_recordings (tenant_id, started_at desc);
create index if not exists phone_transcripts_recording_idx on phone_transcripts (tenant_id, recording_id);
create index if not exists phone_ai_insights_recording_idx on phone_ai_insights (tenant_id, recording_id);
create index if not exists phone_ai_insights_transcript_idx on phone_ai_insights (tenant_id, transcript_id);

-- Uniqueness reflecting the pipeline invariants (transcribe/analyse keep ONE row
-- per recording). Partial unique indexes — safe on clean data. If a pre-existing
-- duplicate exists, resolve it before applying (this whole migration is one
-- transaction and will roll back on conflict).
create unique index if not exists phone_transcripts_one_completed_per_recording
  on phone_transcripts (tenant_id, recording_id)
  where status = 'completed' and recording_id is not null;

create unique index if not exists phone_ai_insights_one_per_recording
  on phone_ai_insights (tenant_id, recording_id)
  where recording_id is not null;

-- ---------------------------------------------------------------------------
-- Tenant-scoped SELECT policies (read-only; RLS already enabled per table)
-- ---------------------------------------------------------------------------

-- Call / feed data: any authenticated user in the tenant may read
-- (owner/admin/ops/viewer).
drop policy if exists phone_calls_select_tenant on phone_calls;
create policy phone_calls_select_tenant on phone_calls
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists phone_recordings_select_tenant on phone_recordings;
create policy phone_recordings_select_tenant on phone_recordings
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists phone_transcripts_select_tenant on phone_transcripts;
create policy phone_transcripts_select_tenant on phone_transcripts
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists phone_ai_insights_select_tenant on phone_ai_insights;
create policy phone_ai_insights_select_tenant on phone_ai_insights
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists phone_sync_runs_select_tenant on phone_sync_runs;
create policy phone_sync_runs_select_tenant on phone_sync_runs
  for select to authenticated
  using (tenant_id = current_tenant_id());

-- Audit log: owner/admin only (tighter than feed data).
drop policy if exists audit_logs_select_admin on audit_logs;
create policy audit_logs_select_admin on audit_logs
  for select to authenticated
  using (tenant_id = current_tenant_id() and current_user_role() in ('owner', 'admin'));
