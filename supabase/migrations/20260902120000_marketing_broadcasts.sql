-- ============================================================================
-- MARKETING PHASE 5 — Broadcasts: governed bulk email end to end.
-- ADDITIVE, RUN-ONCE. Nothing here modifies the committed Phase 0-4 migrations
-- or the frozen Automation Engine; Phase-4 functions that must learn about
-- broadcasts are REPLACED here without weakening any test-send invariant.
--
-- What this migration adds around the EXISTING marketing_campaigns identity
-- (one campaign model — no competing broadcast table):
--  - CAMPAIGN REVISIONS (marketing_campaign_revisions): immutable authored
--    content (subject, preview text, ONE safe canonical plain-text body with a
--    strictly validated {{token}} + [label](https://url) syntax — never
--    arbitrary HTML or executable templates), allowlisted personalisation
--    tokens with explicit fallbacks, sender + segment + segment-version
--    binding, derived content hash. Editing an approved campaign creates a
--    NEW revision and returns the campaign to draft; history is never
--    rewritten.
--  - CAMPAIGN APPROVALS (marketing_campaign_approvals): append-only, binding
--    the exact campaign version, revision + hash, sender, segment version,
--    approver (a CURRENT same-tenant owner/admin holding canonical
--    marketing.campaigns.launch — enforced by the RPC and re-checked at
--    dispatch), authority basis, decision and correlation.
--  - CAMPAIGN EVENTS (marketing_campaign_events): append-only factual state
--    transitions with a guard-assigned sequence (fictional history is
--    rejected for every caller, like Phase-4 delivery events).
--  - AUDIENCE SNAPSHOTS + MEMBERS (marketing_audience_snapshots /
--    marketing_audience_members): the IMMUTABLE launch audience. EVERY
--    segment candidate receives a member row — included or excluded with
--    exact reason codes, the observed eligibility state, the frozen resolved
--    endpoint and the frozen allowlisted personalisation context. The
--    exclusion summary is explainable from immutable rows; refreshing
--    preflight creates a NEW snapshot and invalidates the old confirmation.
--  - LAUNCH CONFIRMATIONS (marketing_launch_confirmations): short-lived,
--    ONE-USE server-issued challenges binding tenant, campaign, version,
--    revision, snapshot + hash, actor, mode (immediate | scheduled with
--    IANA-timezone evidence incl. DST fold), expiry and the launch request
--    id. A browser "confirm: true" is never sufficient.
--  - DISPATCHES (marketing_broadcast_dispatches): the bounded, lease-safe
--    per-recipient work model (FOR UPDATE SKIP LOCKED claims), separate from
--    immutable audience membership: pending → preparing → queued → executing
--    → submitted | skipped | failed | unknown | cancelled, with generation
--    history. An unknown result is NEVER rewritten into a retry.
--  - UNSUBSCRIBE (marketing_unsubscribe_tokens + marketing_unsubscribe_apply):
--    opaque per-recipient tokens; ONLY the sha-256 digest is stored here —
--    the plaintext token exists solely inside the frozen envelope/URL. The
--    public path is idempotent, non-enumerating (identical generic response
--    for invalid/expired/revoked/replayed tokens), appends ONE unsubscribed
--    preference + converges ONE active hard suppression + ONE event, and
--    affects queued sends immediately through the execution-time authority.
--  - AUTOMATION REGISTRATION: intent type `send_marketing_broadcast_email`
--    on the EXISTING email.send_marketing capability — external, high risk,
--    requires_approval = TRUE (a real append-only automation_approvals row
--    recording the genuine tenant-senior launch actor), status lookup
--    honestly FALSE (unknown results freeze, exactly like Phase 4).
--  - EXECUTION-TIME AUTHORITY (marketing_broadcast_send_authority): the ONE
--    canonical SQL recheck used by the dispatch worker BEFORE creating the
--    intent AND by the Gmail adapter IMMEDIATELY before its single provider
--    call: marketing enabled, campaign ACTIVE with the exact bound
--    revision/snapshot/member, approval still valid (approver still a
--    same-tenant owner/admin holding launch), sender enabled + ready,
--    capability enabled, person/point/destination unchanged, and CURRENT
--    endpoint eligibility exactly 'subscribed' (suppression/preference are
--    re-derived live — there is NO override).
--  - DELIVERY EXTENSION: marketing_deliveries gains broadcast provenance
--    (campaign, revision, snapshot, member, dispatch, contact point,
--    unsubscribe token, rendered HTML/preview, generation) and the
--    'broadcast' purpose plus 'skipped'/'cancelled' statuses. The Phase-4
--    guard and reconciler are REPLACED with supersets: every Phase-4
--    test-send invariant is preserved verbatim and re-proven by the
--    unchanged Phase-4 suites.
--  - CANONICAL PROJECTION: confirmed broadcast submissions converge on ONE
--    canonical email_messages row (now carrying origin_campaign_id +
--    origin_person_id) and ONE Interaction via the EXISTING projector, which
--    copies the structural campaign link into the new
--    interactions.related_campaign_id column. Failed/skipped/cancelled/
--    unknown sends create NO canonical email row and NO Interaction.
--
-- Honest limitations recorded deliberately:
--  * Click tracking is NOT implemented (no redirect endpoint exists).
--    marketing_settings.tracking_enabled remains configuration; reporting
--    returns clicked = null ("unavailable"), never a fabricated zero, and no
--    URL is ever rewritten. Delivered/opened/replied/bounced are likewise
--    null — Gmail provides no such evidence through this pipeline.
--  * "submitted" means GMAIL ACCEPTED THE REQUEST — never "delivered".
--  * Gmail has no provider idempotency key: unknown results FREEZE for human
--    review; resume/retry never touches a submitted or unknown recipient.
--  * A trigger/RPC cannot identify its caller — guarantees are STRUCTURAL
--    (shapes, composite tenant FKs, factual anchoring, append-only guards,
--    grants) plus service-role-only execution.
--
-- Rollback (dev only): drop the Phase-5 functions/tables in reverse
-- dependency order (see the object list above); restore the Phase-4
-- definitions of marketing_delivery_guard / marketing_delivery_reconcile /
-- serviceos_schedule_defs from 20260901120000/20260803120000; then
--   alter table marketing_deliveries drop column ... (broadcast columns);
--   alter table email_messages drop column origin_campaign_id, origin_person_id;
--   alter table interactions drop column related_campaign_id;
--   delete from automation_intent_types where intent_type = 'send_marketing_broadcast_email';
-- ============================================================================

-- ── Composite keys so every Phase-5 reference is STRUCTURALLY tenant-bound ──
create unique index if not exists marketing_campaigns_tenant_id_uk
  on marketing_campaigns (tenant_id, id);
create unique index if not exists marketing_segments_tenant_id_uk
  on marketing_segments (tenant_id, id);
create unique index if not exists contact_points_tenant_id_uk
  on contact_points (tenant_id, id);

-- ── Tenant guardrail: bounded bulk audiences (server-enforced at preflight) ──
alter table marketing_settings
  add column if not exists max_bulk_recipients int not null default 500;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'marketing_settings_max_bulk_recipients_check') then
    alter table marketing_settings add constraint marketing_settings_max_bulk_recipients_check
      check (max_bulk_recipients between 1 and 10000);
  end if;
end $$;

-- ============================================================================
-- CAMPAIGN MODEL EXTENSIONS — around the EXISTING marketing_campaigns row
-- ============================================================================
alter table marketing_campaigns
  add column if not exists version              int not null default 1,
  add column if not exists current_revision_id  uuid,
  add column if not exists active_snapshot_id   uuid,
  add column if not exists schedule_local       text,
  add column if not exists schedule_fold        text
    check (schedule_fold is null or schedule_fold in ('earlier', 'later')),
  add column if not exists launch_public_base_url text,
  add column if not exists cancelled_at         timestamptz,
  add column if not exists cancelled_by         uuid;

-- structurally tenant-bound references the skeleton lacked
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mc_sender_fk') then
    alter table marketing_campaigns add constraint mc_sender_fk
      foreign key (tenant_id, sender_profile_id)
      references marketing_sender_profiles (tenant_id, id) on delete set null (sender_profile_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_segment_fk') then
    alter table marketing_campaigns add constraint mc_segment_fk
      foreign key (tenant_id, segment_id)
      references marketing_segments (tenant_id, id) on delete set null (segment_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_owner_fk') then
    alter table marketing_campaigns add constraint mc_owner_fk
      foreign key (tenant_id, owner_id)
      references profiles (tenant_id, id) on delete set null (owner_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_created_by_fk') then
    alter table marketing_campaigns add constraint mc_created_by_fk
      foreign key (tenant_id, created_by)
      references profiles (tenant_id, id) on delete set null (created_by);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_approved_by_fk') then
    alter table marketing_campaigns add constraint mc_approved_by_fk
      foreign key (tenant_id, approved_by)
      references profiles (tenant_id, id) on delete set null (approved_by);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_launched_by_fk') then
    alter table marketing_campaigns add constraint mc_launched_by_fk
      foreign key (tenant_id, launched_by)
      references profiles (tenant_id, id) on delete set null (launched_by);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mc_cancelled_by_fk') then
    alter table marketing_campaigns add constraint mc_cancelled_by_fk
      foreign key (tenant_id, cancelled_by)
      references profiles (tenant_id, id) on delete set null (cancelled_by);
  end if;
end $$;

-- campaigns are archived, never hard-deleted by any client role (tenant
-- cascade cleanup still works — it runs as the table owner)
revoke delete, truncate on marketing_campaigns from anon, authenticated, service_role;

-- ============================================================================
-- CAMPAIGN REVISIONS — immutable authored content
-- ============================================================================
create table marketing_campaign_revisions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  campaign_id       uuid not null,
  revision_number   int not null check (revision_number >= 1),
  sender_profile_id uuid not null,
  segment_id        uuid not null,
  segment_version   int not null,
  subject           text not null check (length(subject) between 1 and 300),
  preview_text      text check (preview_text is null or length(preview_text) <= 150),
  body_authored     text not null check (length(body_authored) between 1 and 20000),
  tokens_required   text[] not null default '{}',
  token_fallbacks   jsonb not null default '{}'::jsonb,
  content_hash      text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source            text not null default 'editor' check (source in ('editor', 'duplicate')),
  created_by        uuid,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, campaign_id, revision_number),
  constraint mcr_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mcr_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id),
  constraint mcr_segment_fk foreign key (tenant_id, segment_id)
    references marketing_segments (tenant_id, id),
  constraint mcr_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null (created_by)
);
create index marketing_campaign_revisions_idx
  on marketing_campaign_revisions (tenant_id, campaign_id, revision_number desc);
-- Append-only pattern (Phase-3 precedent): UPDATE raises; DELETE is made
-- impossible by REVOKING the privilege from every client role INCLUDING the
-- service role — while tenant CASCADE cleanup (which runs as the table owner)
-- keeps working. A delete-blocking trigger would abort legitimate tenant
-- removal, so none is installed on any Phase-5 history table.
create trigger marketing_campaign_revisions_append_only_update
  before update on marketing_campaign_revisions
  for each row execute function marketing_history_append_only();
alter table marketing_campaign_revisions enable row level security;
create policy marketing_campaign_revisions_select on marketing_campaign_revisions
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_campaign_revisions to authenticated;
grant select, insert on marketing_campaign_revisions to service_role;
revoke update, delete, truncate on marketing_campaign_revisions
  from anon, authenticated, service_role;

-- campaign → current revision (after the revisions table exists)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mc_current_revision_fk') then
    alter table marketing_campaigns add constraint mc_current_revision_fk
      foreign key (tenant_id, current_revision_id)
      references marketing_campaign_revisions (tenant_id, id) on delete set null (current_revision_id);
  end if;
end $$;

-- ============================================================================
-- CAMPAIGN APPROVALS — append-only, exact-binding
-- ============================================================================
create table marketing_campaign_approvals (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  campaign_id         uuid not null,
  campaign_version    int not null,
  revision_id         uuid not null,
  revision_hash       text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  sender_profile_id   uuid not null,
  segment_id          uuid not null,
  segment_version     int not null,
  approver_profile_id uuid,
  authority_basis     text not null default 'marketing.campaigns.launch',
  decision            text not null check (decision in ('approved', 'changes_requested')),
  note                text check (note is null or length(note) <= 500),
  correlation_id      uuid not null default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint mca_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mca_revision_fk foreign key (tenant_id, revision_id)
    references marketing_campaign_revisions (tenant_id, id),
  constraint mca_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id),
  constraint mca_segment_fk foreign key (tenant_id, segment_id)
    references marketing_segments (tenant_id, id),
  constraint mca_approver_fk foreign key (tenant_id, approver_profile_id)
    references profiles (tenant_id, id) on delete set null (approver_profile_id)
);
create index marketing_campaign_approvals_idx
  on marketing_campaign_approvals (tenant_id, campaign_id, created_at desc);
create trigger marketing_campaign_approvals_append_only_update
  before update on marketing_campaign_approvals
  for each row execute function marketing_history_append_only();
alter table marketing_campaign_approvals enable row level security;
create policy marketing_campaign_approvals_select on marketing_campaign_approvals
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_campaign_approvals to authenticated;
grant select, insert on marketing_campaign_approvals to service_role;
revoke update, delete, truncate on marketing_campaign_approvals
  from anon, authenticated, service_role;

-- ============================================================================
-- CAMPAIGN EVENTS — append-only factual transitions (guarded chain)
-- ============================================================================
create table marketing_campaign_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id) on delete cascade,
  campaign_id uuid not null,
  seq         int not null check (seq >= 1),
  from_status text,
  to_status   text not null,
  actor       text,
  detail      text check (detail is null or length(detail) <= 300),
  created_at  timestamptz not null default now(),
  unique (tenant_id, campaign_id, seq),
  constraint mce_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade
);
create index marketing_campaign_events_idx
  on marketing_campaign_events (tenant_id, campaign_id, seq);

create or replace function marketing_campaign_event_guard()
returns trigger language plpgsql as $$
declare
  v_c marketing_campaigns%rowtype;
  v_prev marketing_campaign_events%rowtype;
begin
  select * into v_c from marketing_campaigns
   where id = new.campaign_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'a campaign event requires its same-tenant campaign';
  end if;
  -- an event records the campaign's ACTUAL state, never a claimed one
  if new.to_status is distinct from v_c.status then
    raise exception 'a campaign event must record the campaign''s actual status (campaign is %, event claims %)',
      v_c.status, new.to_status;
  end if;
  select * into v_prev from marketing_campaign_events
   where tenant_id = new.tenant_id and campaign_id = new.campaign_id
   order by seq desc limit 1;
  if not found then
    if new.from_status is not null or new.to_status <> 'draft' then
      raise exception 'the first campaign event must be the initial null -> draft record';
    end if;
    new.seq := 1;
  else
    if new.from_status is distinct from v_prev.to_status then
      raise exception 'a campaign event must continue the recorded history (last recorded %, event claims %)',
        v_prev.to_status, coalesce(new.from_status, '<null>');
    end if;
    new.seq := v_prev.seq + 1;
  end if;
  return new;
end $$;
create trigger marketing_campaign_events_guard
  before insert on marketing_campaign_events
  for each row execute function marketing_campaign_event_guard();
create trigger marketing_campaign_events_append_only_update
  before update on marketing_campaign_events
  for each row execute function marketing_history_append_only();
alter table marketing_campaign_events enable row level security;
create policy marketing_campaign_events_select on marketing_campaign_events
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_campaign_events to authenticated;
grant select, insert on marketing_campaign_events to service_role;
revoke update, delete, truncate on marketing_campaign_events
  from anon, authenticated, service_role;

-- ============================================================================
-- AUDIENCE SNAPSHOTS + MEMBERS — the immutable launch audience
-- ============================================================================
create table marketing_audience_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  campaign_id         uuid not null,
  revision_id         uuid not null,
  approval_id         uuid not null,
  segment_id          uuid not null,
  segment_version     int not null,
  segment_hash        text not null check (segment_hash ~ '^[0-9a-f]{64}$'),
  sender_profile_id   uuid not null,
  settings_version    int not null,
  candidate_count     int not null check (candidate_count >= 0),
  included_count      int not null check (included_count >= 0),
  excluded_count      int not null check (excluded_count >= 0),
  exclusion_breakdown jsonb not null default '{}'::jsonb,
  snapshot_hash       text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  constraint mas_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mas_revision_fk foreign key (tenant_id, revision_id)
    references marketing_campaign_revisions (tenant_id, id),
  constraint mas_approval_fk foreign key (tenant_id, approval_id)
    references marketing_campaign_approvals (tenant_id, id),
  constraint mas_segment_fk foreign key (tenant_id, segment_id)
    references marketing_segments (tenant_id, id),
  constraint mas_sender_fk foreign key (tenant_id, sender_profile_id)
    references marketing_sender_profiles (tenant_id, id),
  constraint mas_created_by_fk foreign key (tenant_id, created_by)
    references profiles (tenant_id, id) on delete set null (created_by)
);
create index marketing_audience_snapshots_idx
  on marketing_audience_snapshots (tenant_id, campaign_id, created_at desc);
create trigger marketing_audience_snapshots_append_only_update
  before update on marketing_audience_snapshots
  for each row execute function marketing_history_append_only();
alter table marketing_audience_snapshots enable row level security;
create policy marketing_audience_snapshots_select on marketing_audience_snapshots
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_audience_snapshots to authenticated;
grant select, insert on marketing_audience_snapshots to service_role;
revoke update, delete, truncate on marketing_audience_snapshots
  from anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mc_active_snapshot_fk') then
    alter table marketing_campaigns add constraint mc_active_snapshot_fk
      foreign key (tenant_id, active_snapshot_id)
      references marketing_audience_snapshots (tenant_id, id) on delete set null (active_snapshot_id);
  end if;
end $$;

create table marketing_audience_members (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  snapshot_id       uuid not null,
  campaign_id       uuid not null,
  person_id         uuid not null,
  contact_point_id  uuid,
  destination       text,
  included          boolean not null,
  exclusion_reasons text[] not null default '{}',
  eligibility_state text not null,
  personalisation   jsonb not null default '{}'::jsonb,
  evidence          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, snapshot_id, person_id),
  constraint mam_snapshot_fk foreign key (tenant_id, snapshot_id)
    references marketing_audience_snapshots (tenant_id, id) on delete cascade,
  constraint mam_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mam_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  constraint mam_point_fk foreign key (tenant_id, contact_point_id)
    references contact_points (tenant_id, id) on delete set null (contact_point_id),
  constraint mam_included_shape check (
    (included and contact_point_id is not null or not included)
    and (included and destination is not null or not included)
    and (not included or exclusion_reasons = '{}')
    and (included or array_length(exclusion_reasons, 1) >= 1))
);
create index marketing_audience_members_idx
  on marketing_audience_members (tenant_id, snapshot_id, included);
create trigger marketing_audience_members_append_only_update
  before update on marketing_audience_members
  for each row execute function marketing_history_append_only();
alter table marketing_audience_members enable row level security;
create policy marketing_audience_members_select on marketing_audience_members
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_audience_members to authenticated;
grant select, insert on marketing_audience_members to service_role;
revoke update, delete, truncate on marketing_audience_members
  from anon, authenticated, service_role;

-- ============================================================================
-- LAUNCH CONFIRMATIONS — short-lived, one-use, exact-binding
-- ============================================================================
create table marketing_launch_confirmations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  campaign_id        uuid not null,
  campaign_version   int not null,
  revision_id        uuid not null,
  snapshot_id        uuid not null,
  snapshot_hash      text not null,
  actor_profile_id   uuid,
  challenge_digest   text not null check (challenge_digest ~ '^[0-9a-f]{64}$'),
  public_base_url    text not null,
  mode               text check (mode is null or mode in ('immediate', 'scheduled')),
  schedule_local     text,
  timezone           text,
  scheduled_at_utc   timestamptz,
  schedule_fold      text check (schedule_fold is null or schedule_fold in ('earlier', 'later')),
  launch_request_id  text check (launch_request_id is null
                                 or launch_request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  launch_fingerprint text check (launch_fingerprint is null
                                 or launch_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null,
  used_at            timestamptz,
  superseded_at      timestamptz,
  unique (tenant_id, id),
  constraint mlc_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mlc_revision_fk foreign key (tenant_id, revision_id)
    references marketing_campaign_revisions (tenant_id, id),
  constraint mlc_snapshot_fk foreign key (tenant_id, snapshot_id)
    references marketing_audience_snapshots (tenant_id, id),
  constraint mlc_actor_fk foreign key (tenant_id, actor_profile_id)
    references profiles (tenant_id, id) on delete set null (actor_profile_id)
);
create index marketing_launch_confirmations_idx
  on marketing_launch_confirmations (tenant_id, campaign_id, created_at desc);
-- launch idempotency: one confirmation per (tenant, launch_request_id)
create unique index marketing_launch_confirmations_request_uk
  on marketing_launch_confirmations (tenant_id, launch_request_id)
  where launch_request_id is not null;

-- a confirmation is IMMUTABLE except the single legal use (used_at set once,
-- together with the frozen launch facts recorded by the launch RPC)
create or replace function marketing_launch_confirmation_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_id is distinct from old.campaign_id
     or new.campaign_version is distinct from old.campaign_version
     or new.revision_id is distinct from old.revision_id
     or new.snapshot_id is distinct from old.snapshot_id
     or new.snapshot_hash is distinct from old.snapshot_hash
     or (new.actor_profile_id is distinct from old.actor_profile_id
         and not (new.actor_profile_id is null and old.actor_profile_id is not null))
     or new.challenge_digest is distinct from old.challenge_digest
     or new.public_base_url is distinct from old.public_base_url
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'a launch confirmation is immutable';
  end if;
  if old.used_at is not null then
    raise exception 'a launch confirmation is single-use';
  end if;
  if old.superseded_at is not null then
    raise exception 'a superseded launch confirmation can never change again';
  end if;
  -- a newer preflight SUPERSEDES an unused confirmation (write-once, nothing
  -- else may ride along)
  if new.superseded_at is not null then
    if new.used_at is not null
       or new.mode is distinct from old.mode
       or new.launch_request_id is distinct from old.launch_request_id
       or new.launch_fingerprint is distinct from old.launch_fingerprint then
      raise exception 'supersession records nothing but the supersession';
    end if;
    return new;
  end if;
  if new.used_at is null
     and (new.mode is distinct from old.mode
          or new.launch_request_id is distinct from old.launch_request_id
          or new.launch_fingerprint is distinct from old.launch_fingerprint
          or new.schedule_local is distinct from old.schedule_local
          or new.timezone is distinct from old.timezone
          or new.scheduled_at_utc is distinct from old.scheduled_at_utc
          or new.schedule_fold is distinct from old.schedule_fold) then
    raise exception 'launch facts are recorded only by the single legal use';
  end if;
  return new;
end $$;
create trigger marketing_launch_confirmations_guard
  before update on marketing_launch_confirmations
  for each row execute function marketing_launch_confirmation_guard();
alter table marketing_launch_confirmations enable row level security;
-- challenge digests are never client-readable: NO select policy exists AND
-- the privilege is explicitly revoked (supabase default privileges can grant
-- SELECT on new tables — revoking makes the boundary deterministic in EVERY
-- environment, the proven Phase-3 pattern)
grant select, insert, update on marketing_launch_confirmations to service_role;
revoke select on marketing_launch_confirmations from anon, authenticated;
revoke delete, truncate on marketing_launch_confirmations
  from anon, authenticated, service_role;

-- ============================================================================
-- DISPATCHES — bounded, lease-safe per-recipient work
-- ============================================================================
create table marketing_broadcast_dispatches (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id) on delete cascade,
  campaign_id          uuid not null,
  snapshot_id          uuid not null,
  member_id            uuid not null,
  person_id            uuid not null,
  contact_point_id     uuid,
  generation           int not null default 1 check (generation >= 1),
  status               text not null default 'pending'
                         check (status in ('pending', 'preparing', 'queued', 'executing',
                                           'submitted', 'skipped', 'failed', 'unknown',
                                           'cancelled')),
  lease_worker         text,
  lease_expires_at     timestamptz,
  delivery_id          uuid,
  automation_intent_id uuid,
  skip_reason          text check (skip_reason is null or length(skip_reason) <= 120),
  failure_class        text check (failure_class is null or length(failure_class) <= 120),
  prepared_at          timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, member_id, generation),
  constraint mbd_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete cascade,
  constraint mbd_snapshot_fk foreign key (tenant_id, snapshot_id)
    references marketing_audience_snapshots (tenant_id, id) on delete cascade,
  constraint mbd_member_fk foreign key (tenant_id, member_id)
    references marketing_audience_members (tenant_id, id) on delete cascade,
  constraint mbd_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  constraint mbd_point_fk foreign key (tenant_id, contact_point_id)
    references contact_points (tenant_id, id) on delete set null (contact_point_id),
  constraint mbd_intent_fk foreign key (tenant_id, automation_intent_id)
    references automation_intents (tenant_id, id) on delete set null (automation_intent_id)
);
create index marketing_broadcast_dispatches_claim_idx
  on marketing_broadcast_dispatches (tenant_id, campaign_id, status, created_at);
-- the hot path is the worker claim, which filters by tenant + status (NOT by
-- campaign) and orders by created_at — the campaign-first index above cannot
-- serve it
create index marketing_broadcast_dispatches_status_idx
  on marketing_broadcast_dispatches (tenant_id, status, created_at);
create index marketing_broadcast_dispatches_person_idx
  on marketing_broadcast_dispatches (tenant_id, person_id);
create trigger marketing_broadcast_dispatches_set_updated_at
  before update on marketing_broadcast_dispatches
  for each row execute function set_updated_at();

-- FACTUAL dispatch guard: legal machine + immutable lineage + terminal
-- pinning, for EVERY caller including the service role.
create or replace function marketing_broadcast_dispatch_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'a dispatch must be created pending — % is not a creatable state',
        new.status;
    end if;
    if new.delivery_id is not null or new.automation_intent_id is not null
       or new.skip_reason is not null or new.failure_class is not null
       or new.prepared_at is not null or new.finished_at is not null then
      raise exception 'a new dispatch cannot carry work facts';
    end if;
    -- the dispatch must mirror its INCLUDED member exactly
    if not exists (select 1 from marketing_audience_members m
                    where m.id = new.member_id and m.tenant_id = new.tenant_id
                      and m.snapshot_id = new.snapshot_id
                      and m.campaign_id = new.campaign_id
                      and m.person_id = new.person_id
                      and m.contact_point_id is not distinct from new.contact_point_id
                      and m.included) then
      raise exception 'a dispatch must mirror an INCLUDED member of its own snapshot';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_id is distinct from old.campaign_id
     or new.snapshot_id is distinct from old.snapshot_id
     or new.member_id is distinct from old.member_id
     or new.person_id is distinct from old.person_id
     or (new.contact_point_id is distinct from old.contact_point_id
         and not (new.contact_point_id is null and old.contact_point_id is not null))
     or new.generation is distinct from old.generation
     or new.created_at is distinct from old.created_at then
    raise exception 'dispatch identity and lineage are immutable';
  end if;
  if old.delivery_id is not null and new.delivery_id is distinct from old.delivery_id then
    raise exception 'a recorded dispatch delivery is immutable';
  end if;
  if old.automation_intent_id is not null
     and new.automation_intent_id is distinct from old.automation_intent_id then
    raise exception 'a recorded dispatch intent is immutable';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'pending'   and new.status in ('preparing', 'skipped', 'cancelled'))
         or (old.status = 'preparing' and new.status in ('pending', 'queued', 'skipped',
                                                         'failed', 'cancelled'))
         or (old.status = 'queued'    and new.status in ('executing', 'submitted', 'skipped',
                                                         'failed', 'unknown', 'cancelled'))
         or (old.status = 'executing' and new.status in ('queued', 'submitted', 'skipped',
                                                         'failed', 'unknown'))
         or (old.status = 'unknown'   and new.status in ('submitted', 'failed'))) then
      raise exception 'illegal dispatch transition % -> %', old.status, new.status;
    end if;
    if new.status = 'skipped' and new.skip_reason is null then
      raise exception 'a skipped dispatch requires its skip reason';
    end if;
    if new.status = 'failed' and new.failure_class is null then
      raise exception 'a failed dispatch requires its failure classification';
    end if;
  else
    -- status-preserving updates may only move the lease
    if new.skip_reason is distinct from old.skip_reason
       or new.failure_class is distinct from old.failure_class
       or new.prepared_at is distinct from old.prepared_at
       or new.finished_at is distinct from old.finished_at then
      raise exception 'dispatch facts may only change through a factual status transition';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_broadcast_dispatches_guard
  before insert or update on marketing_broadcast_dispatches
  for each row execute function marketing_broadcast_dispatch_guard();
alter table marketing_broadcast_dispatches enable row level security;
create policy marketing_broadcast_dispatches_select on marketing_broadcast_dispatches
  for select to authenticated
  using (tenant_id = current_tenant_id() and marketing_has_permission('marketing.view'));
grant select on marketing_broadcast_dispatches to authenticated;
grant select, insert, update on marketing_broadcast_dispatches to service_role;
revoke delete, truncate on marketing_broadcast_dispatches
  from anon, authenticated, service_role;

-- ============================================================================
-- UNSUBSCRIBE TOKENS — digest-only storage, non-enumerable
-- ============================================================================
create table marketing_unsubscribe_tokens (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id) on delete cascade,
  token_digest     text not null check (token_digest ~ '^[0-9a-f]{64}$'),
  campaign_id      uuid,
  dispatch_id      uuid,
  person_id        uuid not null,
  contact_point_id uuid,
  destination      text not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  used_at          timestamptz,
  unique (tenant_id, id),
  unique (token_digest),
  constraint mut_campaign_fk foreign key (tenant_id, campaign_id)
    references marketing_campaigns (tenant_id, id) on delete set null (campaign_id),
  constraint mut_dispatch_fk foreign key (tenant_id, dispatch_id)
    references marketing_broadcast_dispatches (tenant_id, id) on delete set null (dispatch_id),
  constraint mut_person_fk foreign key (tenant_id, person_id)
    references people (tenant_id, id) on delete cascade,
  constraint mut_point_fk foreign key (tenant_id, contact_point_id)
    references contact_points (tenant_id, id) on delete set null (contact_point_id)
);
create index marketing_unsubscribe_tokens_idx
  on marketing_unsubscribe_tokens (tenant_id, person_id);

create or replace function marketing_unsubscribe_token_guard()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.token_digest is distinct from old.token_digest
     or (new.person_id is distinct from old.person_id)
     or new.destination is distinct from old.destination
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'an unsubscribe token is immutable';
  end if;
  -- used_at / revoked_at are write-once
  if old.used_at is not null and new.used_at is distinct from old.used_at then
    raise exception 'a token use is recorded once';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a token revocation is recorded once';
  end if;
  return new;
end $$;
create trigger marketing_unsubscribe_tokens_guard
  before update on marketing_unsubscribe_tokens
  for each row execute function marketing_unsubscribe_token_guard();
alter table marketing_unsubscribe_tokens enable row level security;
-- token digests are never client-readable: NO select policy exists AND the
-- privilege is explicitly revoked (deterministic in every environment)
grant select, insert, update on marketing_unsubscribe_tokens to service_role;
revoke select on marketing_unsubscribe_tokens from anon, authenticated;
revoke delete, truncate on marketing_unsubscribe_tokens
  from anon, authenticated, service_role;

-- ============================================================================
-- CAMPAIGN TRANSITION GUARD — the server-enforced legal state machine, with
-- factual anchoring, for EVERY caller including the service role.
-- ============================================================================
create or replace function marketing_campaign_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a campaign must be created as a draft';
    end if;
    if new.approved_by is not null or new.approved_at is not null
       or new.launched_by is not null or new.launched_at is not null
       or new.paused_at is not null or new.completed_at is not null
       or new.archived_at is not null or new.cancelled_at is not null
       or new.active_snapshot_id is not null then
      raise exception 'a new campaign cannot carry lifecycle facts';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.campaign_type is distinct from old.campaign_type
     or new.created_at is distinct from old.created_at
     or (new.created_by is distinct from old.created_by
         and not (new.created_by is null and old.created_by is not null)) then
    raise exception 'campaign identity is immutable';
  end if;
  -- optimistic-concurrency version can only move forward
  if new.version < old.version then
    raise exception 'a campaign version can never move backwards';
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft'     and new.status in ('review'))
         or (old.status = 'review'    and new.status in ('draft', 'approved'))
         or (old.status = 'approved'  and new.status in ('draft', 'scheduled', 'active'))
         or (old.status = 'scheduled' and new.status in ('active', 'paused', 'cancelled'))
         or (old.status = 'active'    and new.status in ('paused', 'completed', 'cancelled'))
         -- a campaign paused BEFORE its scheduled instant returns to 'scheduled'
         -- (resuming it must never bring an unreached schedule forward)
         or (old.status = 'paused'    and new.status in ('active', 'scheduled', 'cancelled'))
         or (old.status = 'completed' and new.status in ('archived'))
         or (old.status = 'cancelled' and new.status in ('archived'))) then
      raise exception 'illegal campaign transition % -> %', old.status, new.status;
    end if;
    -- FACTUAL anchoring — states cannot be fabricated:
    if new.status = 'approved' then
      if new.current_revision_id is null or not exists (
           select 1 from marketing_campaign_approvals a
            where a.tenant_id = new.tenant_id and a.campaign_id = new.id
              and a.revision_id = new.current_revision_id and a.decision = 'approved') then
        raise exception 'an approved campaign requires an approval of its current revision';
      end if;
    end if;
    if new.status in ('scheduled', 'active') and old.status in ('approved') then
      if new.active_snapshot_id is null or not exists (
           select 1 from marketing_launch_confirmations c
            where c.tenant_id = new.tenant_id and c.campaign_id = new.id
              and c.snapshot_id = new.active_snapshot_id and c.used_at is not null) then
        raise exception 'launching requires a USED launch confirmation bound to the active snapshot';
      end if;
    end if;
    if new.status = 'scheduled'
       and (new.schedule_at is null or new.timezone is null or new.schedule_local is null) then
      raise exception 'a scheduled campaign requires its resolved schedule evidence';
    end if;
    if new.status = 'completed' then
      if exists (select 1 from marketing_broadcast_dispatches d
                  where d.tenant_id = new.tenant_id and d.campaign_id = new.id
                    and d.snapshot_id = new.active_snapshot_id
                    and d.status in ('pending', 'preparing', 'queued', 'executing', 'unknown')) then
        raise exception 'a campaign cannot complete with unresolved recipients (incl. unknown results)';
      end if;
    end if;
    -- lifecycle facts move only WITH their transition
    if new.approved_at is distinct from old.approved_at and new.status <> 'approved' then
      raise exception 'approval facts are recorded by the approval transition';
    end if;
    if new.launched_at is distinct from old.launched_at
       and new.status not in ('active', 'scheduled') then
      raise exception 'launch facts are recorded by the launch transition';
    end if;
  else
    -- status-preserving updates cannot rewrite lifecycle facts
    if new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.launched_by is distinct from old.launched_by
       or new.launched_at is distinct from old.launched_at
       or new.completed_at is distinct from old.completed_at
       or new.cancelled_at is distinct from old.cancelled_at
       or new.archived_at is distinct from old.archived_at then
      raise exception 'campaign lifecycle facts may only change through their factual transition';
    end if;
    -- the launch bundle is pinned while launched work exists
    if old.status in ('scheduled', 'active', 'paused')
       and (new.current_revision_id is distinct from old.current_revision_id
            or new.active_snapshot_id is distinct from old.active_snapshot_id
            or new.sender_profile_id is distinct from old.sender_profile_id
            or new.segment_id is distinct from old.segment_id) then
      raise exception 'the launched campaign bundle is pinned';
    end if;
  end if;
  return new;
end $$;
create trigger marketing_campaigns_guard
  before insert or update on marketing_campaigns
  for each row execute function marketing_campaign_guard();

-- ============================================================================
-- MARKETING DELIVERIES — broadcast provenance (additive) + vocabulary
-- ============================================================================
alter table marketing_deliveries
  add column if not exists campaign_id           uuid,
  add column if not exists campaign_revision_id  uuid,
  add column if not exists audience_snapshot_id  uuid,
  add column if not exists audience_member_id    uuid,
  add column if not exists dispatch_id           uuid,
  add column if not exists contact_point_id      uuid,
  add column if not exists unsubscribe_token_id  uuid,
  add column if not exists body_html             text
    check (body_html is null or length(body_html) <= 100000),
  add column if not exists preview_text          text
    check (preview_text is null or length(preview_text) <= 150),
  add column if not exists dispatch_generation   int
    check (dispatch_generation is null or dispatch_generation >= 1);

alter table marketing_deliveries drop constraint marketing_deliveries_purpose_check;
alter table marketing_deliveries add constraint marketing_deliveries_purpose_check
  check (purpose in ('test', 'broadcast'));
alter table marketing_deliveries drop constraint marketing_deliveries_status_check;
alter table marketing_deliveries add constraint marketing_deliveries_status_check
  check (status in ('queued', 'executing', 'submitted', 'failed', 'unknown',
                    'skipped', 'cancelled'));
-- broadcast bodies carry the rendered text + footer; keep the bound honest
alter table marketing_deliveries drop constraint marketing_deliveries_body_text_check;
alter table marketing_deliveries add constraint marketing_deliveries_body_text_check
  check (length(body_text) between 1 and 30000);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'md_campaign_fk') then
    alter table marketing_deliveries add constraint md_campaign_fk
      foreign key (tenant_id, campaign_id)
      references marketing_campaigns (tenant_id, id) on delete set null (campaign_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_revision_fk') then
    alter table marketing_deliveries add constraint md_revision_fk
      foreign key (tenant_id, campaign_revision_id)
      references marketing_campaign_revisions (tenant_id, id) on delete set null (campaign_revision_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_snapshot_fk') then
    alter table marketing_deliveries add constraint md_snapshot_fk
      foreign key (tenant_id, audience_snapshot_id)
      references marketing_audience_snapshots (tenant_id, id) on delete set null (audience_snapshot_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_member_fk') then
    alter table marketing_deliveries add constraint md_member_fk
      foreign key (tenant_id, audience_member_id)
      references marketing_audience_members (tenant_id, id) on delete set null (audience_member_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_dispatch_fk') then
    alter table marketing_deliveries add constraint md_dispatch_fk
      foreign key (tenant_id, dispatch_id)
      references marketing_broadcast_dispatches (tenant_id, id) on delete set null (dispatch_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_point_fk') then
    alter table marketing_deliveries add constraint md_point_fk
      foreign key (tenant_id, contact_point_id)
      references contact_points (tenant_id, id) on delete set null (contact_point_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'md_unsub_token_fk') then
    alter table marketing_deliveries add constraint md_unsub_token_fk
      foreign key (tenant_id, unsubscribe_token_id)
      references marketing_unsubscribe_tokens (tenant_id, id) on delete set null (unsubscribe_token_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'mbd_delivery_fk') then
    alter table marketing_broadcast_dispatches add constraint mbd_delivery_fk
      foreign key (tenant_id, delivery_id)
      references marketing_deliveries (tenant_id, id) on delete set null (delivery_id);
  end if;
end $$;

-- ============================================================================
-- CANONICAL PROJECTION LINKAGE — email_messages + interactions
-- ============================================================================
alter table email_messages
  add column if not exists origin_campaign_id uuid,
  add column if not exists origin_person_id   uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_messages_origin_campaign_fk') then
    alter table email_messages add constraint email_messages_origin_campaign_fk
      foreign key (tenant_id, origin_campaign_id)
      references marketing_campaigns (tenant_id, id) on delete set null (origin_campaign_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'email_messages_origin_person_fk') then
    alter table email_messages add constraint email_messages_origin_person_fk
      foreign key (tenant_id, origin_person_id)
      references people (tenant_id, id) on delete set null (origin_person_id);
  end if;
end $$;

alter table interactions
  add column if not exists related_campaign_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'interactions_related_campaign_fk') then
    alter table interactions add constraint interactions_related_campaign_fk
      foreign key (tenant_id, related_campaign_id)
      references marketing_campaigns (tenant_id, id) on delete set null (related_campaign_id);
  end if;
end $$;
create index if not exists interactions_related_campaign_idx
  on interactions (tenant_id, related_campaign_id)
  where related_campaign_id is not null;

-- ============================================================================
-- AUTOMATION REGISTRATION — the BULK intent type. Same EXISTING external
-- capability (email.send_marketing), same adapter, same outcome contract.
-- requires_approval = TRUE, honestly: every broadcast recipient executes only
-- with a real append-only automation_approvals row recording the GENUINE
-- tenant-senior launch actor (a current same-tenant owner/admin holding
-- canonical marketing.campaigns.launch). supports_status_lookup = FALSE,
-- honestly: Gmail exposes no reliable send-status lookup — unknown results
-- FREEZE for review, exactly as in Phase 4.
-- ============================================================================
insert into automation_intent_types
  (intent_type, connector_capability, risk_category, external_side_effect,
   supports_idempotency, supports_status_lookup, requires_approval,
   default_expiry_seconds, schema_version, enabled)
values
  ('send_marketing_broadcast_email', 'email.send_marketing', 'high', true,
   true, false, true, 3600, '1', true)
on conflict (intent_type) do nothing;

-- ============================================================================
-- ACTOR GATES — canonical resolver ceilings (a hostile raw grant stays inert)
-- ============================================================================
create or replace function marketing_require_launch_actor(p_tenant uuid, p_actor uuid)
returns text  -- actor label for audit rows
language plpgsql
stable
as $$
declare
  v_role text;
  v_actor_tenant uuid;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id, role into v_actor_tenant, v_role from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception 'campaign launch authority requires an owner/admin actor'
      using errcode = '42501';
  end if;
  if not ((marketing_effective_permissions(p_actor) -> 'permissions')
          ? 'marketing.campaigns.launch') then
    raise exception 'actor lacks marketing.campaigns.launch' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

create or replace function marketing_require_draft_actor(p_tenant uuid, p_actor uuid)
returns text
language plpgsql
stable
as $$
declare
  v_actor_tenant uuid;
  v_perms jsonb;
begin
  if p_tenant is null or p_actor is null then
    raise exception 'tenant and actor required' using errcode = '22023';
  end if;
  select tenant_id into v_actor_tenant from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  v_perms := marketing_effective_permissions(p_actor);
  if not ((v_perms ->> 'enabled')::boolean) then
    raise exception 'marketing is not enabled for this tenant' using errcode = '42501';
  end if;
  if not ((v_perms -> 'permissions') ? 'marketing.campaigns.draft') then
    raise exception 'actor lacks marketing.campaigns.draft' using errcode = '42501';
  end if;
  return coalesce((select email from profiles where id = p_actor), p_actor::text);
end $$;

-- ============================================================================
-- ENDPOINT RESOLUTION — selection only. The VERDICT always comes from the
-- canonical marketing_endpoint_eligibility; this helper merely resolves WHICH
-- usable contact point the bulk path would address (primary usable first,
-- then most recent usable). Bulk email requires a REAL contact point — a
-- scalar-only person is honestly excluded as no_contact_point.
-- ============================================================================
create or replace function marketing_broadcast_resolve_endpoint(p_tenant uuid, p_person uuid)
returns table (contact_point_id uuid, destination text)
language sql
stable
as $$
  select cp.id, cp.normalized_value
    from contact_points cp
   where cp.tenant_id = p_tenant and cp.person_id = p_person and cp.channel = 'email'
     and cp.verification_state <> 'invalid'
   order by cp.is_primary desc, cp.last_observed_at desc nulls last, cp.created_at desc
   limit 1;
$$;

-- ============================================================================
-- THE ONE EXECUTION-TIME AUTHORITY — used by the dispatch worker BEFORE any
-- intent exists (via p_dispatch) and by the Gmail adapter IMMEDIATELY before
-- its single provider call (via p_delivery). Fail-closed; NO override exists.
-- ============================================================================
create or replace function marketing_broadcast_authority_core(
  p_tenant uuid, p_campaign uuid, p_revision uuid, p_snapshot uuid, p_member uuid,
  p_person uuid, p_point uuid, p_destination text
) returns jsonb
language plpgsql
stable
as $$
declare
  v_c marketing_campaigns%rowtype;
  v_m marketing_audience_members%rowtype;
  v_appr marketing_campaign_approvals%rowtype;
  v_cp contact_points%rowtype;
  v_rd jsonb;
  v_state text;
  v_approver_role text;
  v_approver_tenant uuid;
begin
  if exists (select 1 from marketing_settings s
              where s.tenant_id = p_tenant and not s.marketing_enabled) then
    return jsonb_build_object('allowed', false, 'code', 'marketing_disabled');
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'campaign_missing');
  end if;
  if v_c.status <> 'active' then
    return jsonb_build_object('allowed', false, 'code', 'campaign_not_active',
                              'state', v_c.status);
  end if;
  if v_c.active_snapshot_id is distinct from p_snapshot
     or v_c.current_revision_id is distinct from p_revision then
    return jsonb_build_object('allowed', false, 'code', 'campaign_binding_changed');
  end if;
  select * into v_m from marketing_audience_members
   where id = p_member and tenant_id = p_tenant and snapshot_id = p_snapshot;
  if not found or not v_m.included then
    return jsonb_build_object('allowed', false, 'code', 'member_not_included');
  end if;
  if v_m.person_id is distinct from p_person
     or v_m.contact_point_id is distinct from p_point
     or v_m.destination is distinct from p_destination then
    return jsonb_build_object('allowed', false, 'code', 'member_binding_changed');
  end if;
  -- the campaign approval must still be VALID: an approval of the exact bound
  -- revision by an approver who is STILL a same-tenant owner/admin holding
  -- canonical marketing.campaigns.launch
  select * into v_appr from marketing_campaign_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = p_campaign
     and a.revision_id = p_revision and a.decision = 'approved'
   order by a.created_at desc limit 1;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'campaign_approval_missing');
  end if;
  if v_appr.approver_profile_id is null then
    return jsonb_build_object('allowed', false, 'code', 'campaign_approver_removed');
  end if;
  select tenant_id, role into v_approver_tenant, v_approver_role
    from profiles where id = v_appr.approver_profile_id;
  if not found or v_approver_tenant is distinct from p_tenant
     or v_approver_role not in ('owner', 'admin')
     or not ((marketing_effective_permissions(v_appr.approver_profile_id) -> 'permissions')
             ? 'marketing.campaigns.launch') then
    return jsonb_build_object('allowed', false, 'code', 'campaign_approver_no_longer_authorised');
  end if;
  -- sender still enabled + CURRENTLY ready (canonical live derivation)
  if not exists (select 1 from marketing_sender_profiles p
                  where p.id = v_c.sender_profile_id and p.tenant_id = p_tenant and p.enabled) then
    return jsonb_build_object('allowed', false, 'code', 'sender_disabled');
  end if;
  v_rd := marketing_sender_readiness(p_tenant, v_c.sender_profile_id);
  if not (v_rd ->> 'ready')::boolean then
    return jsonb_build_object('allowed', false, 'code', 'sender_not_ready',
                              'state', v_rd ->> 'state');
  end if;
  if not coalesce((select c.enabled from tenant_connector_capabilities c
                    where c.tenant_id = p_tenant and c.connector_id = 'google-gmail'
                      and c.capability_key = 'email.send_marketing'), false) then
    return jsonb_build_object('allowed', false, 'code', 'capability_disabled');
  end if;
  -- the frozen endpoint must still be this person's SAME usable point
  if p_point is null then
    return jsonb_build_object('allowed', false, 'code', 'endpoint_missing');
  end if;
  select * into v_cp from contact_points cp
   where cp.id = p_point and cp.tenant_id = p_tenant;
  if not found or v_cp.person_id is distinct from p_person
     or v_cp.channel <> 'email'
     or v_cp.normalized_value is distinct from p_destination
     or v_cp.verification_state = 'invalid' then
    return jsonb_build_object('allowed', false, 'code', 'endpoint_changed');
  end if;
  -- CURRENT eligibility: suppression + preference re-derived LIVE through the
  -- ONE canonical authority. Only an explicit current subscribed verdict sends.
  v_state := marketing_endpoint_eligibility(p_tenant, p_person, 'email', p_point);
  if v_state <> 'subscribed' then
    return jsonb_build_object('allowed', false, 'code', 'not_subscribed', 'state', v_state);
  end if;
  return jsonb_build_object('allowed', true, 'code', 'ok');
end $$;

create or replace function marketing_broadcast_send_authority(p_tenant uuid, p_delivery uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_d marketing_deliveries%rowtype;
begin
  if p_tenant is null or p_delivery is null then
    raise exception 'tenant and delivery required' using errcode = '22023';
  end if;
  select * into v_d from marketing_deliveries
   where id = p_delivery and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('allowed', false, 'code', 'delivery_missing');
  end if;
  if v_d.purpose <> 'broadcast' then
    -- test sends keep their own Phase-4 authority path
    return jsonb_build_object('allowed', false, 'code', 'not_a_broadcast_delivery');
  end if;
  return marketing_broadcast_authority_core(
    p_tenant, v_d.campaign_id, v_d.campaign_revision_id, v_d.audience_snapshot_id,
    v_d.audience_member_id, v_d.person_id, v_d.contact_point_id, v_d.recipient_email);
end $$;

-- ============================================================================
-- DELIVERY GUARD — REPLACED with a superset. Every Phase-4 test-send
-- invariant is preserved verbatim; the broadcast branch binds the FULL
-- broadcast lineage to the frozen intent envelope the same way.
-- ============================================================================
create or replace function marketing_delivery_guard()
returns trigger language plpgsql as $$
declare
  v_intent automation_intents%rowtype;
  v_intent_status text;
  v_att automation_execution_attempts%rowtype;
  v_fp_recipient uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'queued' then
      raise exception 'a delivery must be created queued — % is not a creatable state',
        new.status;
    end if;
    if new.execution_attempt_id is not null
       or new.provider_message_id is not null
       or new.provider_thread_id is not null
       or new.submitted_at is not null
       or new.failure_class is not null then
      raise exception 'a new delivery cannot carry execution, provider or failure facts';
    end if;
    select * into v_intent from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'a delivery requires its same-tenant automation intent';
    end if;
    if v_intent.status <> 'pending' then
      raise exception 'a new delivery requires a PENDING intent (intent is %)',
        v_intent.status;
    end if;

    if new.purpose = 'test' then
      if v_intent.intent_type is distinct from 'send_marketing_test_email'
         or v_intent.capability_key is distinct from 'email.send_marketing' then
        raise exception 'a test delivery requires the Phase-4 test intent and Marketing capability';
      end if;
      -- a test delivery can never smuggle broadcast lineage
      if new.campaign_id is not null or new.campaign_revision_id is not null
         or new.audience_snapshot_id is not null or new.audience_member_id is not null
         or new.dispatch_id is not null or new.unsubscribe_token_id is not null
         or new.body_html is not null or new.preview_text is not null
         or new.dispatch_generation is not null or new.contact_point_id is not null
         or new.person_id is not null then
        raise exception 'a test delivery cannot carry broadcast lineage';
      end if;
    elsif new.purpose = 'broadcast' then
      if v_intent.intent_type is distinct from 'send_marketing_broadcast_email'
         or v_intent.capability_key is distinct from 'email.send_marketing' then
        raise exception 'a broadcast delivery requires the broadcast intent and Marketing capability';
      end if;
      if new.recipient_profile_id is not null then
        raise exception 'a broadcast delivery addresses a Person, not a profile';
      end if;
      if new.campaign_id is null or new.campaign_revision_id is null
         or new.audience_snapshot_id is null or new.audience_member_id is null
         or new.dispatch_id is null or new.person_id is null
         or new.contact_point_id is null or new.unsubscribe_token_id is null
         or new.body_html is null or new.dispatch_generation is null then
        raise exception 'a broadcast delivery requires its complete campaign lineage';
      end if;
      -- the dispatch being prepared must be THIS exact recipient's work item
      if not exists (select 1 from marketing_broadcast_dispatches d
                      where d.id = new.dispatch_id and d.tenant_id = new.tenant_id
                        and d.campaign_id = new.campaign_id
                        and d.snapshot_id = new.audience_snapshot_id
                        and d.member_id = new.audience_member_id
                        and d.person_id = new.person_id
                        and d.generation = new.dispatch_generation
                        and d.status = 'preparing') then
        raise exception 'a broadcast delivery requires its own PREPARING dispatch';
      end if;
      -- broadcast lineage must agree with the frozen envelope
      if v_intent.parameters ->> 'campaign_id' is distinct from new.campaign_id::text
         or v_intent.parameters ->> 'campaign_revision_id' is distinct from new.campaign_revision_id::text
         or v_intent.parameters ->> 'audience_snapshot_id' is distinct from new.audience_snapshot_id::text
         or v_intent.parameters ->> 'audience_member_id' is distinct from new.audience_member_id::text
         or v_intent.parameters ->> 'dispatch_id' is distinct from new.dispatch_id::text
         or (v_intent.parameters ->> 'dispatch_generation')::int is distinct from new.dispatch_generation
         or v_intent.parameters ->> 'person_id' is distinct from new.person_id::text
         or v_intent.parameters ->> 'contact_point_id' is distinct from new.contact_point_id::text
         or v_intent.parameters ->> 'unsubscribe_token_id' is distinct from new.unsubscribe_token_id::text
         or v_intent.parameters ->> 'body_html' is distinct from new.body_html
         or v_intent.parameters ->> 'preview_text' is distinct from new.preview_text then
        raise exception 'a broadcast delivery must agree with its intent''s frozen campaign lineage';
      end if;
    else
      raise exception 'unknown delivery purpose %', new.purpose;
    end if;

    -- the intent's FROZEN envelope is the authority — EVERY persisted field
    -- must agree exactly (null semantics included), for BOTH purposes
    if v_intent.parameters ->> 'delivery_id' is distinct from new.id::text
       or v_intent.parameters ->> 'sender_profile_id' is distinct from new.sender_profile_id::text
       or v_intent.parameters ->> 'recipient_profile_id' is distinct from new.recipient_profile_id::text
       or v_intent.parameters ->> 'recipient_email' is distinct from new.recipient_email
       or v_intent.parameters ->> 'actor_profile_id' is distinct from new.actor_profile_id::text
       or v_intent.parameters ->> 'request_id' is distinct from new.request_id
       or v_intent.parameters ->> 'purpose' is distinct from new.purpose
       or v_intent.parameters ->> 'subject' is distinct from new.subject
       or v_intent.parameters ->> 'body_text' is distinct from new.body_text
       or v_intent.parameters ->> 'from_name' is distinct from new.from_name
       or v_intent.parameters ->> 'reply_to' is distinct from new.reply_to
       or v_intent.parameters ->> 'signature_text' is distinct from new.signature_text
       or v_intent.parameters ->> 'content_version' is distinct from new.content_version
       or v_intent.parameters ->> 'content_hash' is distinct from new.content_hash then
      raise exception 'a delivery must agree with its intent''s frozen envelope';
    end if;
    -- correlation binds to the INTENT ROW's correlation, not a caller value
    if v_intent.correlation_id is distinct from new.correlation_id then
      raise exception 'a delivery must carry its intent''s correlation id';
    end if;
    -- the request fingerprint is RECOMPUTED through the one canonical
    -- formula — a shape-valid 64-hex caller value is never trusted
    v_fp_recipient := case when new.purpose = 'test'
                           then new.recipient_profile_id else new.person_id end;
    if new.request_fingerprint is distinct from marketing_request_fingerprint(
         new.request_id, new.actor_profile_id, new.sender_profile_id,
         v_fp_recipient, new.content_hash) then
      raise exception 'the request fingerprint must equal its canonical recomputation';
    end if;
    return new;
  end if;

  -- ── UPDATE path — Phase-4 rules preserved verbatim, plus the broadcast
  --    vocabulary (skipped/cancelled) with its own factual anchors ──
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.sender_profile_id is distinct from old.sender_profile_id
     or new.purpose is distinct from old.purpose
     or (new.actor_profile_id is distinct from old.actor_profile_id
         and not (new.actor_profile_id is null and old.actor_profile_id is not null))
     or (new.recipient_profile_id is distinct from old.recipient_profile_id
         and not (new.recipient_profile_id is null and old.recipient_profile_id is not null))
     or (new.person_id is distinct from old.person_id
         and not (new.person_id is null and old.person_id is not null))
     or new.recipient_email is distinct from old.recipient_email
     or new.automation_intent_id is distinct from old.automation_intent_id
     or new.request_id is distinct from old.request_id
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.correlation_id is distinct from old.correlation_id
     or new.subject is distinct from old.subject
     or new.body_text is distinct from old.body_text
     or new.from_name is distinct from old.from_name
     or new.reply_to is distinct from old.reply_to
     or new.signature_text is distinct from old.signature_text
     or new.content_version is distinct from old.content_version
     or new.content_hash is distinct from old.content_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'delivery identity, lineage and submitted content are immutable';
  end if;
  -- broadcast lineage is equally immutable (genuine FK set-null excepted)
  if (new.campaign_id is distinct from old.campaign_id
      and not (new.campaign_id is null and old.campaign_id is not null))
     or (new.campaign_revision_id is distinct from old.campaign_revision_id
         and not (new.campaign_revision_id is null and old.campaign_revision_id is not null))
     or (new.audience_snapshot_id is distinct from old.audience_snapshot_id
         and not (new.audience_snapshot_id is null and old.audience_snapshot_id is not null))
     or (new.audience_member_id is distinct from old.audience_member_id
         and not (new.audience_member_id is null and old.audience_member_id is not null))
     or (new.dispatch_id is distinct from old.dispatch_id
         and not (new.dispatch_id is null and old.dispatch_id is not null))
     or (new.contact_point_id is distinct from old.contact_point_id
         and not (new.contact_point_id is null and old.contact_point_id is not null))
     or (new.unsubscribe_token_id is distinct from old.unsubscribe_token_id
         and not (new.unsubscribe_token_id is null and old.unsubscribe_token_id is not null))
     or new.body_html is distinct from old.body_html
     or new.preview_text is distinct from old.preview_text
     or new.dispatch_generation is distinct from old.dispatch_generation then
    raise exception 'broadcast lineage and rendered content are immutable';
  end if;
  if old.provider_message_id is not null
     and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'a recorded provider message id is immutable';
  end if;
  if old.provider_thread_id is not null
     and new.provider_thread_id is distinct from old.provider_thread_id then
    raise exception 'a recorded provider thread id is immutable';
  end if;
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'a recorded submission time is immutable';
  end if;
  if (old.provider_message_id is null and new.provider_message_id is not null
      or old.provider_thread_id is null and new.provider_thread_id is not null
      or old.submitted_at is null and new.submitted_at is not null)
     and not (new.status = 'submitted' and old.status is distinct from new.status) then
    raise exception 'provider facts may only be recorded by a confirmed submission';
  end if;
  if new.status is not distinct from old.status then
    if new.execution_attempt_id is distinct from old.execution_attempt_id then
      raise exception 'the cited execution attempt may only change through a factual status transition';
    end if;
    if new.failure_class is distinct from old.failure_class then
      raise exception 'a failure classification may only change through a factual status transition';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status in ('executing', 'submitted', 'failed',
                                                      'unknown', 'skipped', 'cancelled'))
         or (old.status = 'executing' and new.status in ('queued', 'submitted', 'failed',
                                                         'unknown', 'skipped'))
         or (old.status = 'unknown' and new.status in ('submitted', 'failed'))) then
      raise exception 'illegal delivery status transition % -> %', old.status, new.status;
    end if;
    if old.purpose = 'test' and new.status in ('skipped', 'cancelled') then
      raise exception 'a test delivery has no % state', new.status;
    end if;
    select status into v_intent_status from automation_intents
     where id = new.automation_intent_id and tenant_id = new.tenant_id;
    if v_intent_status is null then
      raise exception 'delivery transition requires its automation intent';
    end if;
    if new.status = 'queued' and v_intent_status not in ('pending', 'failed') then
      raise exception 'a queued delivery requires a pending/retrying intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'executing' and v_intent_status not in ('claimed', 'executing') then
      raise exception 'an executing delivery requires a claimed/executing intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'unknown' and v_intent_status <> 'unknown' then
      raise exception 'an unknown delivery requires an unknown intent (intent is %)',
        v_intent_status;
    end if;
    if new.status = 'cancelled' then
      if v_intent_status <> 'cancelled' then
        raise exception 'a cancelled delivery requires a cancelled intent (intent is %)',
          v_intent_status;
      end if;
    end if;
    if new.status = 'skipped' then
      -- a SKIP is factual: the engine recorded a permanent POLICY refusal
      -- (the adapter blocked before the provider) — never an arbitrary label
      if v_intent_status not in ('failed', 'cancelled') then
        raise exception 'a skipped delivery requires a policy-refused intent (intent is %)',
          v_intent_status;
      end if;
      if new.failure_class is null or new.failure_class !~ '^policy_' then
        raise exception 'a skipped delivery requires its policy classification';
      end if;
      if new.execution_attempt_id is not null then
        select * into v_att from automation_execution_attempts
         where id = new.execution_attempt_id and tenant_id = new.tenant_id
           and automation_intent_id = new.automation_intent_id;
        if v_att.id is null or v_att.error_code !~ '^policy_' then
          raise exception 'a skipped delivery must cite the policy-refusal attempt';
        end if;
      end if;
    end if;
    if new.status = 'failed' then
      if old.purpose = 'broadcast' then
        if v_intent_status not in ('failed', 'expired', 'rejected') then
          raise exception 'a failed broadcast delivery requires a terminally failed intent (intent is %)',
            v_intent_status;
        end if;
      elsif v_intent_status not in ('failed', 'expired', 'cancelled', 'rejected') then
        raise exception 'a failed delivery requires a terminally failed intent (intent is %)',
          v_intent_status;
      end if;
      if new.failure_class is null then
        raise exception 'a failed delivery requires its failure classification';
      end if;
      if new.execution_attempt_id is not null then
        select * into v_att from automation_execution_attempts
         where id = new.execution_attempt_id and tenant_id = new.tenant_id
           and automation_intent_id = new.automation_intent_id;
        if v_att.id is null
           or v_att.status not in ('failed_permanent', 'failed_transient', 'unknown') then
          raise exception 'a failed delivery cannot cite a non-failure attempt as evidence';
        end if;
      end if;
    end if;
    if new.status = 'submitted' then
      if new.failure_class is not null then
        raise exception 'a submitted delivery cannot carry a failure classification';
      end if;
      if v_intent_status <> 'succeeded' then
        raise exception 'a submitted delivery requires a succeeded intent (intent is %)',
          v_intent_status;
      end if;
      if new.execution_attempt_id is null then
        raise exception 'a submitted delivery requires its succeeded execution attempt';
      end if;
      select * into v_att from automation_execution_attempts
       where id = new.execution_attempt_id and tenant_id = new.tenant_id
         and automation_intent_id = new.automation_intent_id;
      if v_att.id is null then
        raise exception 'the cited execution attempt does not belong to this delivery''s intent';
      end if;
      if v_att.status <> 'succeeded' then
        raise exception 'a submitted delivery requires a SUCCEEDED attempt (attempt is %)',
          v_att.status;
      end if;
      if new.provider_message_id is null or new.submitted_at is null then
        raise exception 'a submitted delivery requires provider message id + submission time';
      end if;
      if v_att.external_reference is distinct from new.provider_message_id then
        raise exception 'provider message id must equal the attempt''s external reference';
      end if;
      if nullif(v_att.result ->> 'thread_id', '') is not null
         and new.provider_thread_id is distinct from nullif(v_att.result ->> 'thread_id', '') then
        raise exception 'provider thread id must agree with the attempt''s recorded thread';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ============================================================================
-- CONTENT VALIDATION — ONE safe authored model. Plain text with:
--   {{token}}  — allowlisted personalisation only (first_name, last_name,
--                display_name, company_name)
--   [label](https://url) — validated links
-- No arbitrary HTML, no executable templates, no unknown tokens, no control
-- characters (newlines allowed in the body only). Returns the tokens used.
-- ============================================================================
create or replace function marketing_campaign_validate_content(
  p_subject text, p_preview text, p_body text, p_fallbacks jsonb
) returns text[]
language plpgsql
immutable
as $$
declare
  v_allow constant text[] := array['first_name', 'last_name', 'display_name', 'company_name'];
  v_tokens text[] := '{}';
  v_t text;
  v_key text;
  v_val jsonb;
  v_text text;
  v_stripped text;
begin
  if p_subject is null or length(trim(p_subject)) = 0 or length(p_subject) > 300 then
    raise exception 'subject required (max 300 chars)' using errcode = '22023';
  end if;
  if p_subject ~ '[[:cntrl:]]' then
    raise exception 'subject must not contain control characters' using errcode = '22023';
  end if;
  if p_preview is not null then
    if length(p_preview) > 150 or p_preview ~ '[[:cntrl:]]' then
      raise exception 'preview text is bounded to 150 clean characters' using errcode = '22023';
    end if;
  end if;
  if p_body is null or length(p_body) = 0 or length(p_body) > 20000 then
    raise exception 'body required (max 20000 chars)' using errcode = '22023';
  end if;
  if replace(p_body, e'\n', '') ~ '[[:cntrl:]]' then
    raise exception 'body must not contain control characters (newlines only)'
      using errcode = '22023';
  end if;

  v_text := p_subject || e'\n' || p_body;
  -- EVERY {{ occurrence must be a whole valid allowlisted token
  for v_t in select (regexp_matches(v_text, '\{\{\s*([a-z_]+)\s*\}\}', 'g'))[1] loop
    if not (v_t = any(v_allow)) then
      raise exception 'unknown personalisation token {{%}} — allowed: %',
        v_t, array_to_string(v_allow, ', ') using errcode = '22023';
    end if;
    if not (v_t = any(v_tokens)) then v_tokens := v_tokens || v_t; end if;
  end loop;
  v_stripped := regexp_replace(v_text, '\{\{\s*[a-z_]+\s*\}\}', '', 'g');
  if position('{{' in v_stripped) > 0 or position('}}' in v_stripped) > 0 then
    raise exception 'malformed personalisation braces' using errcode = '22023';
  end if;
  -- EVERY [label]( occurrence must be a whole valid http(s) link
  v_stripped := regexp_replace(p_body, '\[[^\]\[]{1,200}\]\(https?://[^\s()<>]+\)', '', 'g');
  if v_stripped ~ '\]\(' then
    raise exception 'malformed link — use [label](https://destination)' using errcode = '22023';
  end if;

  if p_fallbacks is null or jsonb_typeof(p_fallbacks) <> 'object' then
    raise exception 'token_fallbacks must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_fallbacks) loop
    if not (v_key = any(v_allow)) then
      raise exception 'fallback for unknown token %', v_key using errcode = '22023';
    end if;
    v_val := p_fallbacks -> v_key;
    if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 200
       or (v_val #>> '{}') ~ '[[:cntrl:]]' then
      raise exception 'fallback % must be a short clean string', v_key using errcode = '22023';
    end if;
  end loop;
  return v_tokens;
end $$;

-- deterministic revision hash over the complete authored bundle
create or replace function marketing_campaign_revision_hash(
  p_sender uuid, p_segment uuid, p_segment_version int, p_subject text,
  p_preview text, p_body text, p_tokens text[], p_fallbacks jsonb
) returns text
language sql
immutable
as $$
  select encode(extensions.digest(jsonb_build_object(
    'sender', p_sender, 'segment', p_segment, 'segment_version', p_segment_version,
    'subject', p_subject, 'preview', p_preview, 'body', p_body,
    'tokens', to_jsonb(p_tokens), 'fallbacks', p_fallbacks)::text, 'sha256'), 'hex');
$$;

-- ============================================================================
-- CAMPAIGN LIFECYCLE RPCs (service-role only; Edge enforces the double gate)
-- ============================================================================

-- A campaign created BEFORE Phase 5 (a bare skeleton row) has no recorded event
-- history, and the event guard rightly refuses any event that does not continue
-- a chain beginning with the initial null -> draft record. Without an explicit
-- adoption step such a campaign could be revised but never submitted, approved
-- or launched — a dead end, not a governed lifecycle. This seeds EXACTLY the
-- initial record, and only for a campaign that is genuinely a draft with no
-- history at all; it invents no transition that did not happen.
create or replace function marketing_campaign_seed_event_chain(
  p_tenant uuid, p_campaign uuid, p_actor_label text
) returns boolean
language plpgsql
as $$
declare v_status text;
begin
  if exists (select 1 from marketing_campaign_events
              where tenant_id = p_tenant and campaign_id = p_campaign) then
    return false;
  end if;
  select status into v_status from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if v_status is distinct from 'draft' then
    return false;  -- the caller decides how to report an unadoptable row
  end if;
  insert into marketing_campaign_events
    (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign, null, 'draft', p_actor_label,
          'pre-Phase-5 campaign adopted into the governed lifecycle');
  return true;
end $$;

create or replace function marketing_campaign_create(p_tenant uuid, p_actor uuid, p_args jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_key text;
  v_name text;
  v_desc text;
  v_sender marketing_sender_profiles%rowtype;
  v_seg marketing_segments%rowtype;
  v_tokens text[];
  v_hash text;
  v_campaign uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
  v_fallbacks jsonb;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'segment_id', 'subject',
                     'preview_text', 'body_authored', 'token_fallbacks') then
      raise exception 'unknown create argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
  if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'name required (max 120 clean chars)' using errcode = '22023';
  end if;
  v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
  if v_desc is not null and (length(v_desc) > 500 or v_desc ~ '[[:cntrl:]]') then
    raise exception 'description is bounded to 500 clean chars' using errcode = '22023';
  end if;
  begin
    select * into v_sender from marketing_sender_profiles
     where id = (p_args ->> 'sender_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid sender id' using errcode = '22023';
  end;
  if v_sender.id is null then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  begin
    select * into v_seg from marketing_segments
     where id = (p_args ->> 'segment_id')::uuid and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid segment id' using errcode = '22023';
  end;
  if v_seg.id is null then
    raise exception 'segment not found for tenant' using errcode = 'P0002';
  end if;
  if v_seg.status <> 'active' then
    raise exception 'segment is archived' using errcode = '22023';
  end if;
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(
    p_args ->> 'subject', p_args ->> 'preview_text', p_args ->> 'body_authored', v_fallbacks);
  v_hash := marketing_campaign_revision_hash(
    v_sender.id, v_seg.id, v_seg.definition_version, p_args ->> 'subject',
    p_args ->> 'preview_text', p_args ->> 'body_authored', v_tokens, v_fallbacks);

  insert into marketing_campaigns
    (id, tenant_id, name, description, campaign_type, status, owner_id,
     sender_profile_id, segment_id, created_by, version)
  values (v_campaign, p_tenant, v_name, v_desc, 'broadcast', 'draft', p_actor,
          v_sender.id, v_seg.id, p_actor, 1);
  insert into marketing_campaign_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
     segment_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, source, created_by)
  values (v_rev, p_tenant, v_campaign, 1, v_sender.id, v_seg.id,
          v_seg.definition_version, p_args ->> 'subject', p_args ->> 'preview_text',
          p_args ->> 'body_authored', v_tokens, v_fallbacks, v_hash, 'editor', p_actor);
  update marketing_campaigns set current_revision_id = v_rev where id = v_campaign;
  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, v_campaign, null, 'draft', v_label, 'campaign created');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.created', 'marketing_campaign',
          v_campaign::text, 'ok', jsonb_build_object('name', v_name, 'revision', 1));
  perform marketing_event_append(p_tenant, 'marketing.campaign.created', 'marketing_campaign',
    v_campaign, 'marketing-campaigns',
    jsonb_build_object('k', 'created:' || v_campaign, 'actor', v_label, 'at', now()));

  return jsonb_build_object('id', v_campaign, 'revision_id', v_rev, 'status', 'draft',
                            'version', 1, 'content_hash', v_hash);
end $$;

create or replace function marketing_campaign_revise(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb, p_expected_version int
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_prev marketing_campaign_revisions%rowtype;
  v_key text;
  v_sender marketing_sender_profiles%rowtype;
  v_seg marketing_segments%rowtype;
  v_tokens text[];
  v_hash text;
  v_rev uuid := gen_random_uuid();
  v_n int;
  v_fallbacks jsonb;
  v_subject text;
  v_preview text;
  v_body text;
  v_from_status text;
  v_name text;
  v_desc text;
  v_seeded boolean;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' or p_args = '{}'::jsonb then
    raise exception 'changes must be a non-empty object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('name', 'description', 'sender_id', 'segment_id', 'subject',
                     'preview_text', 'body_authored', 'token_fallbacks') then
      raise exception 'unknown revise argument %', v_key using errcode = '22023';
    end if;
  end loop;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.status not in ('draft', 'review', 'approved') then
    raise exception 'a % campaign cannot be revised — cancel or complete it first', v_c.status
      using errcode = '22023';
  end if;
  select * into v_prev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  if not found then
    -- a PRE-PHASE-5 skeleton campaign has no revision yet: the first revise
    -- bootstraps revision 1 and must therefore supply the full content
    if not (p_args ? 'sender_id' and p_args ? 'segment_id'
            and p_args ? 'subject' and p_args ? 'body_authored') then
      raise exception 'this campaign has no revision yet — the first revision needs sender_id, segment_id, subject and body_authored'
        using errcode = '22023';
    end if;
  end if;

  -- effective values = previous revision (when one exists) overlaid with the
  -- supplied changes
  begin
    select * into v_sender from marketing_sender_profiles
     where id = coalesce((p_args ->> 'sender_id')::uuid, v_prev.sender_profile_id)
       and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid sender id' using errcode = '22023';
  end;
  if v_sender.id is null then
    raise exception 'sender not found for tenant' using errcode = 'P0002';
  end if;
  begin
    select * into v_seg from marketing_segments
     where id = coalesce((p_args ->> 'segment_id')::uuid, v_prev.segment_id)
       and tenant_id = p_tenant;
  exception when others then
    raise exception 'invalid segment id' using errcode = '22023';
  end;
  if v_seg.id is null or v_seg.status <> 'active' then
    raise exception 'segment not found or archived' using errcode = '22023';
  end if;
  -- name/description are validated EXACTLY as on create — a revision can never
  -- introduce an oversized or control-character campaign identity
  if p_args ? 'name' then
    v_name := nullif(trim(coalesce(p_args ->> 'name', '')), '');
    if v_name is null or length(v_name) > 120 or v_name ~ '[[:cntrl:]]' then
      raise exception 'name required (max 120 clean chars)' using errcode = '22023';
    end if;
  end if;
  if p_args ? 'description' then
    v_desc := nullif(trim(coalesce(p_args ->> 'description', '')), '');
    if v_desc is not null and (length(v_desc) > 500 or v_desc ~ '[[:cntrl:]]') then
      raise exception 'description is bounded to 500 clean chars' using errcode = '22023';
    end if;
  end if;
  v_subject := coalesce(p_args ->> 'subject', v_prev.subject);
  v_preview := case when p_args ? 'preview_text'
                    then nullif(p_args ->> 'preview_text', '') else v_prev.preview_text end;
  v_body := coalesce(p_args ->> 'body_authored', v_prev.body_authored);
  v_fallbacks := coalesce(p_args -> 'token_fallbacks', v_prev.token_fallbacks, '{}'::jsonb);
  v_tokens := marketing_campaign_validate_content(v_subject, v_preview, v_body, v_fallbacks);
  v_hash := marketing_campaign_revision_hash(
    v_sender.id, v_seg.id, v_seg.definition_version, v_subject, v_preview, v_body,
    v_tokens, v_fallbacks);

  select coalesce(max(revision_number), 0) + 1 into v_n
    from marketing_campaign_revisions
   where tenant_id = p_tenant and campaign_id = p_campaign;
  insert into marketing_campaign_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
     segment_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, source, created_by)
  values (v_rev, p_tenant, p_campaign, v_n, v_sender.id, v_seg.id,
          v_seg.definition_version, v_subject, v_preview, v_body, v_tokens,
          v_fallbacks, v_hash, 'editor', p_actor);

  v_from_status := v_c.status;
  -- editing invalidates approval/preflight through a NEW revision + draft
  -- state — history stays append-only, nothing is deleted
  update marketing_campaigns set
    name = case when p_args ? 'name' then v_name else name end,
    description = case when p_args ? 'description' then v_desc else description end,
    current_revision_id = v_rev,
    sender_profile_id = v_sender.id,
    segment_id = v_seg.id,
    status = 'draft',
    version = version + 1
  where id = p_campaign
  returning * into v_c;
  -- a pre-Phase-5 skeleton has no chain at all: its FIRST recorded fact is the
  -- initial draft record, not a fabricated transition out of a status nothing
  -- ever recorded
  v_seeded := marketing_campaign_seed_event_chain(p_tenant, p_campaign, v_label);
  if not v_seeded and v_from_status <> 'draft' then
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
    values (p_tenant, p_campaign, v_from_status, 'draft', v_label,
            'revision ' || v_n || ' created — approval and preflight invalidated');
  end if;

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.revised', 'marketing_campaign',
          p_campaign::text, 'ok', jsonb_build_object('revision', v_n));
  perform marketing_event_append(p_tenant, 'marketing.campaign.revised', 'marketing_campaign',
    p_campaign, 'marketing-campaigns',
    jsonb_build_object('k', 'revised:' || v_rev, 'revision', v_n, 'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'revision_id', v_rev, 'revision', v_n,
    'status', v_c.status, 'version', v_c.version, 'content_hash', v_hash);
end $$;

create or replace function marketing_campaign_duplicate(
  p_tenant uuid, p_actor uuid, p_campaign uuid
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_prev marketing_campaign_revisions%rowtype;
  v_new uuid := gen_random_uuid();
  v_rev uuid := gen_random_uuid();
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  select * into v_prev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  if not found then
    raise exception 'campaign has no current revision' using errcode = 'P0002';
  end if;

  insert into marketing_campaigns
    (id, tenant_id, name, description, campaign_type, status, owner_id,
     sender_profile_id, segment_id, created_by, version)
  values (v_new, p_tenant, left(v_c.name || ' (copy)', 120), v_c.description, 'broadcast',
          'draft', p_actor, v_prev.sender_profile_id, v_prev.segment_id, p_actor, 1);
  insert into marketing_campaign_revisions
    (id, tenant_id, campaign_id, revision_number, sender_profile_id, segment_id,
     segment_version, subject, preview_text, body_authored, tokens_required,
     token_fallbacks, content_hash, source, created_by)
  values (v_rev, p_tenant, v_new, 1, v_prev.sender_profile_id, v_prev.segment_id,
          v_prev.segment_version, v_prev.subject, v_prev.preview_text,
          v_prev.body_authored, v_prev.tokens_required, v_prev.token_fallbacks,
          v_prev.content_hash, 'duplicate', p_actor);
  update marketing_campaigns set current_revision_id = v_rev where id = v_new;
  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, v_new, null, 'draft', v_label, 'duplicated from ' || p_campaign);

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.created', 'marketing_campaign',
          v_new::text, 'ok', jsonb_build_object('duplicated_from', p_campaign));
  perform marketing_event_append(p_tenant, 'marketing.campaign.created', 'marketing_campaign',
    v_new, 'marketing-campaigns',
    jsonb_build_object('k', 'created:' || v_new, 'duplicated_from', p_campaign,
                       'actor', v_label, 'at', now()));
  return jsonb_build_object('id', v_new, 'revision_id', v_rev, 'status', 'draft', 'version', 1);
end $$;

-- ── idempotent dispatch materialisation for the active snapshot ─────────────
create or replace function marketing_campaign_activate(p_tenant uuid, p_campaign uuid)
returns int
language plpgsql
as $$
declare v_c marketing_campaigns%rowtype; v_n int := 0;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found or v_c.active_snapshot_id is null then
    raise exception 'campaign has no active snapshot' using errcode = 'P0002';
  end if;
  insert into marketing_broadcast_dispatches
    (tenant_id, campaign_id, snapshot_id, member_id, person_id, contact_point_id, generation)
  select m.tenant_id, m.campaign_id, m.snapshot_id, m.id, m.person_id, m.contact_point_id, 1
    from marketing_audience_members m
   where m.tenant_id = p_tenant and m.snapshot_id = v_c.active_snapshot_id and m.included
     and not exists (select 1 from marketing_broadcast_dispatches d
                      where d.tenant_id = p_tenant and d.member_id = m.id and d.generation = 1);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── governed lifecycle transitions ──────────────────────────────────────────
create or replace function marketing_campaign_transition(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_action text,
  p_expected_version int, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_campaign_revisions%rowtype;
  v_to text;
  v_note text;
  v_approval uuid;
  v_cancelled_intents int := 0;
  v_pending_cancelled int := 0;
  v_created int;
  r record;
begin
  if p_action is null or p_action not in
     ('submit_review', 'request_changes', 'approve', 'pause', 'resume', 'cancel', 'archive') then
    raise exception 'unknown transition action' using errcode = '22023';
  end if;
  -- authority: drafters may submit for review; everything else demands the
  -- owner/admin + canonical launch ceiling
  if p_action = 'submit_review' then
    v_label := marketing_require_draft_actor(p_tenant, p_actor);
  else
    v_label := marketing_require_launch_actor(p_tenant, p_actor);
  end if;
  if p_campaign is null or p_expected_version is null then
    raise exception 'campaign and expected_version required' using errcode = '22023';
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  v_note := nullif(trim(coalesce(p_args ->> 'note', '')), '');
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note is bounded to 500 chars' using errcode = '22023';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  -- a pre-Phase-5 skeleton is adopted (initial draft record) before any
  -- transition, so the governed lifecycle is reachable rather than a dead end
  if not exists (select 1 from marketing_campaign_events
                  where tenant_id = p_tenant and campaign_id = p_campaign) then
    if not marketing_campaign_seed_event_chain(p_tenant, p_campaign, v_label) then
      raise exception 'this campaign predates the governed lifecycle and is not a draft (it is %) — it cannot be transitioned',
        v_c.status using errcode = '22023';
    end if;
  end if;
  -- EVERY action states its legal precondition here, so an out-of-sequence
  -- request is a stable client error rather than a raw trigger exception
  if p_action = 'submit_review' and v_c.status <> 'draft' then
    raise exception 'only a draft campaign can be submitted for review (campaign is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'pause' and v_c.status not in ('scheduled', 'active') then
    raise exception 'only a scheduled/active campaign can be paused (campaign is %)', v_c.status
      using errcode = '22023';
  end if;
  if p_action = 'archive' and v_c.status not in ('completed', 'cancelled') then
    raise exception 'only a completed/cancelled campaign can be archived (campaign is %)', v_c.status
      using errcode = '22023';
  end if;

  v_to := case p_action
    when 'submit_review'   then 'review'
    when 'request_changes' then 'draft'
    when 'approve'         then 'approved'
    when 'pause'           then 'paused'
    when 'resume'          then 'active'
    when 'cancel'          then 'cancelled'
    when 'archive'         then 'archived'
  end;

  if p_action = 'approve' then
    if v_c.status <> 'review' then
      raise exception 'only a campaign in review can be approved (campaign is %)', v_c.status
        using errcode = '22023';
    end if;
    select * into v_rev from marketing_campaign_revisions
     where tenant_id = p_tenant and id = v_c.current_revision_id;
    if not found then
      raise exception 'campaign has no current revision' using errcode = 'P0002';
    end if;
    -- the approval binds the EXACT bundle
    insert into marketing_campaign_approvals
      (tenant_id, campaign_id, campaign_version, revision_id, revision_hash,
       sender_profile_id, segment_id, segment_version, approver_profile_id,
       authority_basis, decision, note)
    values (p_tenant, p_campaign, v_c.version, v_rev.id, v_rev.content_hash,
            v_rev.sender_profile_id, v_rev.segment_id, v_rev.segment_version,
            p_actor, 'marketing.campaigns.launch', 'approved', v_note)
    returning id into v_approval;
    update marketing_campaigns
       set status = 'approved', approved_by = p_actor, approved_at = now(),
           version = version + 1
     where id = p_campaign returning * into v_c;
  elsif p_action = 'request_changes' then
    if v_c.status <> 'review' then
      raise exception 'only a campaign in review can have changes requested (campaign is %)',
        v_c.status using errcode = '22023';
    end if;
    insert into marketing_campaign_approvals
      (tenant_id, campaign_id, campaign_version, revision_id, revision_hash,
       sender_profile_id, segment_id, segment_version, approver_profile_id,
       authority_basis, decision, note)
    select p_tenant, p_campaign, v_c.version, r2.id, r2.content_hash,
           r2.sender_profile_id, r2.segment_id, r2.segment_version,
           p_actor, 'marketing.campaigns.launch', 'changes_requested', v_note
      from marketing_campaign_revisions r2
     where r2.tenant_id = p_tenant and r2.id = v_c.current_revision_id;
    update marketing_campaigns set status = 'draft', version = version + 1
     where id = p_campaign returning * into v_c;
  elsif p_action = 'cancel' then
    if v_c.status not in ('scheduled', 'active', 'paused') then
      raise exception 'only scheduled/active/paused campaigns can be cancelled (campaign is %)',
        v_c.status using errcode = '22023';
    end if;
    update marketing_campaigns
       set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(),
           version = version + 1
     where id = p_campaign returning * into v_c;
    -- SAFELY stop unsent work: pending dispatches cancel outright; queued
    -- recipients cancel ONLY through the engine's legal pending→cancelled
    -- transition (claimed/executing/unknown work is never rewritten — an
    -- already-executing provider call may still finish)
    update marketing_broadcast_dispatches d
       set status = 'cancelled', finished_at = now()
     where d.tenant_id = p_tenant and d.campaign_id = p_campaign and d.status = 'pending';
    get diagnostics v_pending_cancelled = row_count;
    for r in select d.id as dispatch_id, d.automation_intent_id, d.delivery_id
               from marketing_broadcast_dispatches d
               join automation_intents i on i.id = d.automation_intent_id
              where d.tenant_id = p_tenant and d.campaign_id = p_campaign
                and d.status = 'queued' and i.status = 'pending'
              for update of d loop
      update automation_intents set status = 'cancelled'
       where id = r.automation_intent_id and tenant_id = p_tenant and status = 'pending';
      if found then
        v_cancelled_intents := v_cancelled_intents + 1;
        update marketing_deliveries set status = 'cancelled'
         where id = r.delivery_id and tenant_id = p_tenant and status = 'queued';
        insert into marketing_delivery_events
          (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail)
        values (p_tenant, r.delivery_id, r.automation_intent_id, 'queued', 'cancelled',
                'campaign cancelled before execution');
        update marketing_broadcast_dispatches
           set status = 'cancelled', finished_at = now()
         where id = r.dispatch_id and tenant_id = p_tenant;
      end if;
    end loop;
  elsif p_action = 'resume' then
    if v_c.status <> 'paused' then
      raise exception 'only a paused campaign can be resumed (campaign is %)', v_c.status
        using errcode = '22023';
    end if;
    -- A campaign paused BEFORE its scheduled instant returns to 'scheduled':
    -- resuming must never bring an unreached schedule forward and start sending
    -- immediately. Only a campaign whose schedule has arrived (or which was
    -- launched immediately) resumes into active dispatch.
    if v_c.schedule_at is not null and v_c.schedule_at > now()
       and not exists (select 1 from marketing_broadcast_dispatches d
                        where d.tenant_id = p_tenant and d.campaign_id = p_campaign) then
      update marketing_campaigns set status = 'scheduled', version = version + 1
       where id = p_campaign returning * into v_c;
      v_created := 0;
    else
      update marketing_campaigns set status = 'active', version = version + 1
       where id = p_campaign returning * into v_c;
      -- resume NEVER retries submitted or unknown work: it only materialises
      -- dispatch rows that never existed (idempotent) and lets pending continue
      v_created := marketing_campaign_activate(p_tenant, p_campaign);
    end if;
  else
    -- submit_review / pause / archive: pure guarded transitions
    update marketing_campaigns
       set status = v_to,
           paused_at = case when v_to = 'paused' then now() else paused_at end,
           archived_at = case when v_to = 'archived' then now() else archived_at end,
           version = version + 1
     where id = p_campaign returning * into v_c;
  end if;

  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign,
          (select to_status from marketing_campaign_events e
            where e.tenant_id = p_tenant and e.campaign_id = p_campaign
            order by seq desc limit 1),
          v_c.status, v_label, coalesce(v_note, p_action));

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.' ||
          case p_action when 'submit_review' then 'review_requested'
                        when 'request_changes' then 'changes_requested'
                        else p_action end,
          'marketing_campaign', p_campaign::text, 'ok',
          jsonb_build_object('to', v_c.status, 'cancelled_intents', v_cancelled_intents,
                             'cancelled_pending', v_pending_cancelled));
  perform marketing_event_append(p_tenant,
    'marketing.campaign.' ||
      case p_action when 'submit_review' then 'review_requested'
                    when 'request_changes' then 'changes_requested'
                    when 'approve' then 'approved'
                    when 'pause' then 'paused'
                    when 'resume' then 'resumed'
                    when 'cancel' then 'cancelled'
                    else 'archived' end,
    'marketing_campaign', p_campaign, 'marketing-campaigns',
    jsonb_build_object('k', p_action || ':' || p_campaign || ':' || v_c.version,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'status', v_c.status, 'version', v_c.version,
    'approval_id', v_approval, 'cancelled_pending', v_pending_cancelled,
    'cancelled_intents', v_cancelled_intents, 'dispatches_created', v_created);
end $$;

-- ============================================================================
-- AUDIENCE — bounded draft preview + the immutable final preflight snapshot
-- ============================================================================
create or replace function marketing_campaign_preview_audience(
  p_tenant uuid, p_actor uuid, p_campaign uuid
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_campaign_revisions%rowtype;
  v_seg marketing_segments%rowtype;
  v_include_all boolean;
  v_candidates int := 0;
  v_eligible int := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_reason text;
  v_state text;
  v_point uuid;
  v_dest text;
  v_cap int;
  r record;
begin
  v_label := marketing_require_draft_actor(p_tenant, p_actor);
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  select * into v_rev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  if not found then
    raise exception 'campaign has no current revision' using errcode = 'P0002';
  end if;
  select * into v_seg from marketing_segments
   where id = v_rev.segment_id and tenant_id = p_tenant;
  if not found then
    raise exception 'segment not found' using errcode = 'P0002';
  end if;
  select coalesce(ms.include_all_discovered, true),
         coalesce(ms.max_bulk_recipients, 500)
    into v_include_all, v_cap
    from marketing_settings ms where ms.tenant_id = p_tenant;
  if not found then v_include_all := true; v_cap := 500; end if;

  for r in
    select p.id from people p
     where p.tenant_id = p_tenant
       and (v_include_all or exists (
              select 1 from contact_relationships ce
               where ce.tenant_id = p_tenant and ce.person_id = p.id and ce.status = 'active'))
       and marketing_segment_match_person(p_tenant, p.id, v_seg.definition)
     limit 2001
  loop
    v_candidates := v_candidates + 1;
    if v_candidates > 2000 then
      return jsonb_build_object('capped', true, 'candidate_count', '2000+',
        'note', 'audience preview is bounded at 2000 candidates');
    end if;
    select contact_point_id, destination into v_point, v_dest
      from marketing_broadcast_resolve_endpoint(p_tenant, r.id);
    -- the VERDICT is always the canonical eligibility (with the resolved
    -- usable point, or its own default resolution when none is usable —
    -- which honestly reports invalid-only endpoints as 'invalid')
    v_state := marketing_endpoint_eligibility(p_tenant, r.id, 'email', v_point);
    v_reason := case v_state
      when 'subscribed' then
        -- bulk email requires a REAL usable contact point: a scalar-only
        -- subscription is not an addressable bulk endpoint
        case when v_point is null then 'no_contact_point' else null end
      when 'unsubscribed' then 'unsubscribed'
      when 'suppressed' then 'hard_suppression'
      when 'invalid' then 'invalid_destination'
      when 'no_contact_point' then 'no_contact_point'
      else 'unknown_preference' end;
    if v_reason is null then
      v_eligible := v_eligible + 1;
    else
      v_breakdown := jsonb_set(v_breakdown, array[v_reason],
        to_jsonb(coalesce((v_breakdown ->> v_reason)::int, 0) + 1));
    end if;
  end loop;

  return jsonb_build_object('candidate_count', v_candidates, 'eligible_estimate', v_eligible,
    'excluded_estimate', v_candidates - v_eligible, 'exclusion_breakdown', v_breakdown,
    'segment_version', v_seg.definition_version,
    'revision_segment_version', v_rev.segment_version,
    'segment_changed_since_revision', v_seg.definition_version <> v_rev.segment_version,
    'max_bulk_recipients', v_cap, 'capped', false,
    'note', 'estimate — the immutable preflight snapshot is the launch truth');
end $$;

-- ── FINAL PREFLIGHT: the immutable snapshot + one-use launch confirmation ───
create or replace function marketing_campaign_preflight(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_expected_version int,
  p_public_base_url text
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_rev marketing_campaign_revisions%rowtype;
  v_seg marketing_segments%rowtype;
  v_appr marketing_campaign_approvals%rowtype;
  v_rd jsonb;
  v_include_all boolean;
  v_cap int;
  v_settings_version int;
  v_members jsonb := '[]'::jsonb;
  v_candidates int := 0;
  v_included int := 0;
  v_excluded int := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_snapshot uuid := gen_random_uuid();
  v_hash text;
  v_challenge text;
  v_confirmation uuid := gen_random_uuid();
  v_samples_inc jsonb := '[]'::jsonb;
  v_samples_exc jsonb := '[]'::jsonb;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_public_base_url is null or p_public_base_url !~ '^https?://[^\s]+$' then
    raise exception 'the Marketing public base URL is not configured — unsubscribe links cannot be built, so launching is not possible'
      using errcode = 'MK428';
  end if;
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  if v_c.version <> p_expected_version then
    raise exception 'campaign changed since it was read' using errcode = 'MK409';
  end if;
  if v_c.status <> 'approved' then
    raise exception 'preflight requires an APPROVED campaign (campaign is %)', v_c.status
      using errcode = '22023';
  end if;
  select * into v_rev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  select * into v_appr from marketing_campaign_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = p_campaign
     and a.revision_id = v_c.current_revision_id and a.decision = 'approved'
   order by a.created_at desc limit 1;
  if v_appr.id is null then
    raise exception 'no approval exists for the current revision' using errcode = '22023';
  end if;
  select * into v_seg from marketing_segments
   where id = v_rev.segment_id and tenant_id = p_tenant;
  if v_seg.status <> 'active' then
    raise exception 'segment is archived' using errcode = '22023';
  end if;
  if v_seg.definition_version <> v_rev.segment_version then
    raise exception 'the segment definition changed since this revision was approved — revise the campaign'
      using errcode = 'MK409';
  end if;
  if exists (select 1 from marketing_settings s
              where s.tenant_id = p_tenant and not s.marketing_enabled) then
    raise exception 'marketing is disabled for this tenant' using errcode = '42501';
  end if;
  if not exists (select 1 from marketing_sender_profiles p
                  where p.id = v_rev.sender_profile_id and p.tenant_id = p_tenant and p.enabled) then
    raise exception 'the campaign sender is disabled' using errcode = '22023';
  end if;
  v_rd := marketing_sender_readiness(p_tenant, v_rev.sender_profile_id);
  if not (v_rd ->> 'ready')::boolean then
    raise exception 'the campaign sender is not ready to send (%)', v_rd ->> 'state'
      using errcode = '22023';
  end if;
  select coalesce(ms.include_all_discovered, true), coalesce(ms.max_bulk_recipients, 500),
         coalesce(ms.version, 1)
    into v_include_all, v_cap, v_settings_version
    from marketing_settings ms where ms.tenant_id = p_tenant;
  if not found then v_include_all := true; v_cap := 500; v_settings_version := 1; end if;

  -- ── the audience is derived SET-BASED in one ordered pass. (An earlier
  --    draft accumulated every member with jsonb_set, which copies the whole
  --    accumulator per candidate — quadratic, ~66s at the 10000 ceiling while
  --    holding the campaign row lock. The evidence and ordering below are
  --    identical; only the accumulation is linear.) ────────────────────────
  select count(*) into v_candidates
    from people p
   where p.tenant_id = p_tenant
     and (v_include_all or exists (
            select 1 from contact_relationships ce
             where ce.tenant_id = p_tenant and ce.person_id = p.id and ce.status = 'active'))
     and marketing_segment_match_person(p_tenant, p.id, v_seg.definition);
  if v_candidates > v_cap then
    raise exception 'audience (% candidates) exceeds the tenant guardrail max_bulk_recipients = %',
      v_candidates, v_cap using errcode = 'MK413';
  end if;

  with candidates as (
    select p.id as person_id, p.created_at,
           jsonb_build_object(
             'first_name', nullif(left(regexp_replace(coalesce(p.first_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'last_name', nullif(left(regexp_replace(coalesce(p.last_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'display_name', nullif(left(regexp_replace(coalesce(p.display_name, ''), '[[:cntrl:]]', '', 'g'), 200), ''),
             'company_name', nullif(left(regexp_replace(coalesce(c.name, ''), '[[:cntrl:]]', '', 'g'), 200), '')
           ) as context
      from people p
      left join companies c on c.id = p.company_id and c.tenant_id = p.tenant_id
     where p.tenant_id = p_tenant
       and (v_include_all or exists (
              select 1 from contact_relationships ce
               where ce.tenant_id = p_tenant and ce.person_id = p.id and ce.status = 'active'))
       and marketing_segment_match_person(p_tenant, p.id, v_seg.definition)
  ), resolved as (
    -- endpoint SELECTION only; the VERDICT is always canonical eligibility,
    -- which with no usable point resolves by default and honestly reports an
    -- invalid-only endpoint as 'invalid'
    select cd.*, ep.contact_point_id, ep.destination,
           marketing_endpoint_eligibility(p_tenant, cd.person_id, 'email', ep.contact_point_id) as state
      from candidates cd
      left join lateral marketing_broadcast_resolve_endpoint(p_tenant, cd.person_id) ep on true
  ), reasoned as (
    select rs.*,
           (case
              when rs.state = 'subscribed' then
                -- a scalar-only subscription is not an addressable bulk endpoint
                case when rs.contact_point_id is null then array['no_contact_point'] else '{}'::text[] end
              else array[case rs.state
                     when 'unsubscribed' then 'unsubscribed'
                     when 'suppressed' then 'hard_suppression'
                     when 'invalid' then 'invalid_destination'
                     when 'no_contact_point' then 'no_contact_point'
                     else 'unknown_preference' end]
            end)
           -- a missing REQUIRED token excludes unless the revision supplies a fallback
           || (case when exists (
                     select 1 from unnest(v_rev.tokens_required) t(tok)
                      where coalesce(rs.context ->> t.tok, '') = ''
                        and not (v_rev.token_fallbacks ? t.tok))
                    then array['missing_personalisation'] else '{}'::text[] end) as reasons,
           -- several People share this endpoint: canonical data supplies no
           -- single unambiguous target, so EVERY sharer is excluded (fail
           -- closed — never duplicated mail)
           (rs.destination is not null
            and count(*) over (partition by rs.destination) > 1) as shared
      from resolved rs
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', rd.person_id, 'contact_point_id', rd.contact_point_id,
           'destination', rd.destination, 'eligibility_state', rd.state,
           'reasons', to_jsonb(rd.reasons), 'context', rd.context,
           'final_reasons', to_jsonb(
             rd.reasons || case when rd.shared
                                then array['duplicate_shared_destination'] else '{}'::text[] end))
         order by rd.created_at, rd.person_id), '[]'::jsonb),
         -- counts come from the SAME rows the members and hash are built from,
         -- so a count can never disagree with the persisted evidence
         count(*) filter (where cardinality(rd.reasons) = 0 and not rd.shared),
         count(*) filter (where cardinality(rd.reasons) > 0 or rd.shared)
    into v_members, v_included, v_excluded
    from reasoned rd;

  -- breakdown and bounded masked samples, from those same frozen rows
  select coalesce(jsonb_object_agg(x.reason, x.n), '{}'::jsonb) into v_breakdown from (
    select reason, count(*)::int as n
      from jsonb_array_elements(v_members) m(value)
      cross join lateral jsonb_array_elements_text(m.value -> 'final_reasons') as t(reason)
     group by reason) x;
  select coalesce(jsonb_agg(s.j order by s.i), '[]'::jsonb) into v_samples_inc from (
    select jsonb_build_object('destination_masked',
             regexp_replace(m.value ->> 'destination', '^(.).*(@.*)$', '\1***\2')) as j,
           row_number() over () as i
      from jsonb_array_elements(v_members) m(value)
     where jsonb_array_length(m.value -> 'final_reasons') = 0
     limit 5) s;
  select coalesce(jsonb_agg(s.j order by s.i), '[]'::jsonb) into v_samples_exc from (
    select jsonb_build_object(
             'destination_masked', case when m.value ->> 'destination' is null then null
               else regexp_replace(m.value ->> 'destination', '^(.).*(@.*)$', '\1***\2') end,
             'reasons', m.value -> 'final_reasons') as j,
           row_number() over () as i
      from jsonb_array_elements(v_members) m(value)
     where jsonb_array_length(m.value -> 'final_reasons') > 0
     limit 5) s;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'campaign', p_campaign, 'revision', v_rev.id, 'revision_hash', v_rev.content_hash,
    'segment', v_seg.id, 'segment_version', v_seg.definition_version,
    'sender', v_rev.sender_profile_id, 'settings_version', v_settings_version,
    'members', v_members)::text, 'sha256'), 'hex');

  insert into marketing_audience_snapshots
    (id, tenant_id, campaign_id, revision_id, approval_id, segment_id, segment_version,
     segment_hash, sender_profile_id, settings_version, candidate_count, included_count,
     excluded_count, exclusion_breakdown, snapshot_hash, created_by)
  values
    (v_snapshot, p_tenant, p_campaign, v_rev.id, v_appr.id, v_seg.id,
     v_seg.definition_version,
     encode(extensions.digest(v_seg.definition::text, 'sha256'), 'hex'),
     v_rev.sender_profile_id, v_settings_version, v_candidates, v_included, v_excluded,
     v_breakdown, v_hash, p_actor);

  -- EVERY candidate becomes exactly one immutable member row, from the SAME
  -- frozen evidence the hash covers (one statement — no per-row accumulation)
  insert into marketing_audience_members
    (tenant_id, snapshot_id, campaign_id, person_id, contact_point_id, destination,
     included, exclusion_reasons, eligibility_state, personalisation, evidence)
  select p_tenant, v_snapshot, p_campaign, (m.value ->> 'person_id')::uuid,
         (m.value ->> 'contact_point_id')::uuid, m.value ->> 'destination',
         jsonb_array_length(m.value -> 'final_reasons') = 0,
         array(select jsonb_array_elements_text(m.value -> 'final_reasons')),
         m.value ->> 'eligibility_state', m.value -> 'context',
         jsonb_build_object('observed_at', now(),
                            'eligibility', m.value ->> 'eligibility_state')
    from jsonb_array_elements(v_members) m(value);

  -- one-use launch confirmation (the plaintext challenge is returned ONCE and
  -- only its digest is stored; refreshing preflight makes older confirmations
  -- unusable because launch requires the campaign's LATEST snapshot)
  update marketing_launch_confirmations
     set superseded_at = now()
   where tenant_id = p_tenant and campaign_id = p_campaign
     and used_at is null and superseded_at is null;
  v_challenge := encode(extensions.gen_random_bytes(24), 'hex');
  insert into marketing_launch_confirmations
    (id, tenant_id, campaign_id, campaign_version, revision_id, snapshot_id, snapshot_hash,
     actor_profile_id, challenge_digest, public_base_url, expires_at)
  values
    (v_confirmation, p_tenant, p_campaign, v_c.version, v_rev.id, v_snapshot, v_hash,
     p_actor, encode(extensions.digest(v_challenge, 'sha256'), 'hex'),
     p_public_base_url, now() + interval '15 minutes');

  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label, 'marketing.campaign.preflight', 'marketing_campaign',
          p_campaign::text, 'ok',
          jsonb_build_object('snapshot', v_snapshot, 'candidates', v_candidates,
                             'included', v_included, 'excluded', v_excluded));

  return jsonb_build_object(
    'snapshot_id', v_snapshot, 'snapshot_hash', v_hash, 'created_at', now(),
    'candidate_count', v_candidates, 'included_count', v_included,
    'excluded_count', v_excluded, 'exclusion_breakdown', v_breakdown,
    'included_samples', v_samples_inc, 'excluded_samples', v_samples_exc,
    'revision_id', v_rev.id, 'revision_hash', v_rev.content_hash,
    'segment_version', v_seg.definition_version, 'settings_version', v_settings_version,
    'approval_id', v_appr.id, 'campaign_version', v_c.version,
    'confirmation_id', v_confirmation, 'challenge', v_challenge,
    'expires_at', now() + interval '15 minutes',
    'max_bulk_recipients', v_cap);
end $$;

-- ── LAUNCH: exact one-use confirmation → active (immediate) or scheduled ────
create or replace function marketing_campaign_launch(
  p_tenant uuid, p_actor uuid, p_campaign uuid, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_label text;
  v_c marketing_campaigns%rowtype;
  v_conf marketing_launch_confirmations%rowtype;
  v_key text;
  v_mode text;
  v_request text;
  v_fp text;
  v_challenge text;
  v_tz text;
  v_local_txt text;
  v_local timestamp;
  v_utc timestamptz;
  v_alt timestamptz;
  v_probe interval;
  v_fold text;
  v_created int := 0;
  v_used marketing_launch_confirmations%rowtype;
begin
  v_label := marketing_require_launch_actor(p_tenant, p_actor);
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('confirmation_id', 'challenge', 'mode', 'schedule_local', 'timezone',
                     'fold', 'request_id') then
      raise exception 'unknown launch argument %', v_key using errcode = '22023';
    end if;
  end loop;
  v_mode := p_args ->> 'mode';
  if v_mode is null or v_mode not in ('immediate', 'scheduled') then
    raise exception 'mode must be immediate|scheduled' using errcode = '22023';
  end if;
  v_request := p_args ->> 'request_id';
  if v_request is null or v_request !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'request_id must match ^[A-Za-z0-9_-]{8,64}$' using errcode = '22023';
  end if;
  v_challenge := p_args ->> 'challenge';
  if v_challenge is null or v_challenge !~ '^[0-9a-f]{48}$' then
    raise exception 'a launch requires its server-issued confirmation challenge'
      using errcode = '22023';
  end if;

  -- resolve the schedule FIRST so the idempotency fingerprint is exact
  if v_mode = 'scheduled' then
    v_tz := p_args ->> 'timezone';
    if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
      raise exception 'a valid IANA timezone is required' using errcode = '22023';
    end if;
    v_local_txt := replace(coalesce(p_args ->> 'schedule_local', ''), 'T', ' ');
    begin
      v_local := v_local_txt::timestamp;
    exception when others then
      raise exception 'schedule_local must be YYYY-MM-DD HH:MM' using errcode = '22023';
    end;
    v_utc := v_local at time zone v_tz;
    if (v_utc at time zone v_tz) <> v_local then
      raise exception 'that local time does not exist in % (daylight-saving gap) — choose another time',
        v_tz using errcode = 'MK414';
    end if;
    -- AMBIGUITY (clocks going back) is NOT always a one-hour fold: Lord Howe
    -- shifts 30 minutes, and historical zones used 20/45/90-minute shifts. Probe
    -- the real candidate offsets, nearest first, so a sub-hour fold can never be
    -- silently resolved to one of its two instants.
    v_alt := null;
    foreach v_probe in array array['00:15', '00:20', '00:30', '00:45', '01:00',
                                   '01:30', '02:00']::interval[] loop
      if ((v_utc - v_probe) at time zone v_tz) = v_local then
        v_alt := v_utc - v_probe;
        exit;
      elsif ((v_utc + v_probe) at time zone v_tz) = v_local then
        v_alt := v_utc + v_probe;
        exit;
      end if;
    end loop;
    v_fold := p_args ->> 'fold';
    if v_alt is not null then
      if v_fold is null or v_fold not in ('earlier', 'later') then
        raise exception 'that local time occurs twice in % (daylight-saving fold) — resolve it explicitly with fold = earlier|later',
          v_tz using errcode = 'MK415';
      end if;
      v_utc := case when v_fold = 'earlier' then least(v_utc, v_alt)
                    else greatest(v_utc, v_alt) end;
    else
      v_fold := null;  -- no ambiguity: never record a meaningless fold
    end if;
    if v_utc < now() + interval '1 minute' then
      raise exception 'the scheduled time must be in the future' using errcode = '22023';
    end if;
  end if;

  v_fp := encode(extensions.digest(jsonb_build_object(
    'request_id', v_request, 'campaign', p_campaign, 'actor', p_actor,
    'confirmation', p_args ->> 'confirmation_id', 'mode', v_mode,
    'schedule_local', p_args ->> 'schedule_local', 'timezone', v_tz,
    'fold', v_fold)::text, 'sha256'), 'hex');

  -- serialise launches per campaign
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || '|mkt_launch|' || p_campaign, 42));

  -- idempotent replay: the SAME exact request converges on the used confirmation
  select * into v_used from marketing_launch_confirmations
   where tenant_id = p_tenant and launch_request_id = v_request;
  if found then
    if v_used.launch_fingerprint = v_fp and v_used.used_at is not null then
      select * into v_c from marketing_campaigns where id = p_campaign and tenant_id = p_tenant;
      return jsonb_build_object('id', p_campaign, 'status', v_c.status,
        'version', v_c.version, 'snapshot_id', v_used.snapshot_id, 'idempotent', true);
    end if;
    raise exception 'launch request_id was already used for a DIFFERENT launch'
      using errcode = 'MK412';
  end if;

  begin
    select * into v_conf from marketing_launch_confirmations
     where id = (p_args ->> 'confirmation_id')::uuid and tenant_id = p_tenant for update;
  exception when others then
    raise exception 'invalid confirmation id' using errcode = '22023';
  end;
  if v_conf.id is null or v_conf.campaign_id is distinct from p_campaign then
    raise exception 'launch confirmation not found for this campaign' using errcode = 'P0002';
  end if;
  if v_conf.used_at is not null then
    raise exception 'this launch confirmation was already used' using errcode = 'MK412';
  end if;
  if v_conf.superseded_at is not null then
    raise exception 'a newer preflight snapshot exists — confirm the latest preflight'
      using errcode = 'MK409';
  end if;
  if v_conf.expires_at < now() then
    raise exception 'the launch confirmation has expired — run preflight again'
      using errcode = 'MK416';
  end if;
  if v_conf.actor_profile_id is distinct from p_actor then
    raise exception 'the launch confirmation belongs to a different actor' using errcode = '42501';
  end if;
  if encode(extensions.digest(v_challenge, 'sha256'), 'hex') <> v_conf.challenge_digest then
    raise exception 'the launch challenge does not match' using errcode = '42501';
  end if;

  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if v_c.status <> 'approved' then
    raise exception 'only an APPROVED campaign can launch (campaign is %)', v_c.status
      using errcode = '22023';
  end if;
  if v_c.version <> v_conf.campaign_version
     or v_c.current_revision_id is distinct from v_conf.revision_id then
    raise exception 'the campaign changed after preflight — run preflight again'
      using errcode = 'MK409';
  end if;
  if (select included_count from marketing_audience_snapshots
       where id = v_conf.snapshot_id and tenant_id = p_tenant) = 0 then
    raise exception 'the snapshot includes no recipients — nothing to launch'
      using errcode = '22023';
  end if;

  -- the single legal use records the frozen launch facts
  update marketing_launch_confirmations set
    used_at = now(), mode = v_mode, launch_request_id = v_request,
    launch_fingerprint = v_fp, schedule_local = p_args ->> 'schedule_local',
    timezone = v_tz, scheduled_at_utc = v_utc, schedule_fold = v_fold
  where id = v_conf.id;

  update marketing_campaigns set
    status = case when v_mode = 'immediate' then 'active' else 'scheduled' end,
    active_snapshot_id = v_conf.snapshot_id,
    launch_public_base_url = v_conf.public_base_url,
    launched_by = p_actor, launched_at = now(),
    schedule_at = v_utc, schedule_local = p_args ->> 'schedule_local',
    timezone = coalesce(v_tz, timezone), schedule_fold = v_fold,
    version = version + 1
  where id = p_campaign returning * into v_c;

  if v_mode = 'immediate' then
    v_created := marketing_campaign_activate(p_tenant, p_campaign);
  end if;

  insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign, 'approved', v_c.status, v_label,
          case when v_mode = 'immediate' then 'launched immediately'
               else 'scheduled for ' || (p_args ->> 'schedule_local') || ' ' || v_tz end);
  insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
  values (p_tenant, v_label,
          case when v_mode = 'immediate' then 'marketing.campaign.launched'
               else 'marketing.campaign.scheduled' end,
          'marketing_campaign', p_campaign::text, 'ok',
          jsonb_build_object('snapshot', v_conf.snapshot_id, 'mode', v_mode,
                             'scheduled_at_utc', v_utc, 'dispatches', v_created));
  perform marketing_event_append(p_tenant,
    case when v_mode = 'immediate' then 'marketing.campaign.launched'
         else 'marketing.campaign.scheduled' end,
    'marketing_campaign', p_campaign, 'marketing-campaigns',
    jsonb_build_object('k', 'launch:' || v_request, 'mode', v_mode,
                       'actor', v_label, 'at', now()));

  return jsonb_build_object('id', p_campaign, 'status', v_c.status, 'version', v_c.version,
    'snapshot_id', v_conf.snapshot_id, 'dispatches_created', v_created,
    'scheduled_at_utc', v_utc, 'idempotent', false);
end $$;

-- ── SCHEDULER DISCOVERY: activate due campaigns (never sends anything) ──────
create or replace function marketing_broadcast_due(p_limit int default 20)
returns table (tenant_id uuid, campaign_id uuid, dispatches_created int)
language plpgsql
as $$
declare r record; v_n int;
begin
  for r in
    select c.tenant_id as t, c.id as cid from marketing_campaigns c
     where c.status = 'scheduled' and c.schedule_at is not null and c.schedule_at <= now()
     order by c.schedule_at
     for update skip locked
     limit greatest(1, least(100, p_limit))
  loop
    update marketing_campaigns set status = 'active', version = version + 1
     where id = r.cid;
    v_n := marketing_campaign_activate(r.t, r.cid);
    insert into marketing_campaign_events (tenant_id, campaign_id, from_status, to_status, actor, detail)
    values (r.t, r.cid, 'scheduled', 'active', 'scheduler', 'scheduled time reached');
    perform marketing_event_append(r.t, 'marketing.campaign.launched',
      'marketing_campaign', r.cid, 'marketing-broadcast-scheduler',
      jsonb_build_object('k', 'due:' || r.cid, 'at', now()));
    tenant_id := r.t; campaign_id := r.cid; dispatches_created := v_n;
    return next;
  end loop;
end $$;

-- ── COMPLETION: derived from recipient facts, never invented. Unknown
--    results BLOCK a clean completion until explicitly resolved. Called from
--    every path that moves a dispatch to a terminal state. ──────────────────
create or replace function marketing_broadcast_check_completion(p_tenant uuid, p_campaign uuid)
returns boolean
language plpgsql
as $$
declare v_c marketing_campaigns%rowtype;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant for update;
  if not found or v_c.status <> 'active' or v_c.active_snapshot_id is null then
    return false;
  end if;
  if exists (select 1 from marketing_broadcast_dispatches d
              where d.tenant_id = p_tenant and d.campaign_id = p_campaign
                and d.snapshot_id = v_c.active_snapshot_id
                and d.status in ('pending', 'preparing', 'queued', 'executing', 'unknown')) then
    return false;
  end if;
  update marketing_campaigns
     set status = 'completed', completed_at = now(), version = version + 1
   where id = p_campaign;
  insert into marketing_campaign_events
    (tenant_id, campaign_id, from_status, to_status, actor, detail)
  values (p_tenant, p_campaign, 'active', 'completed', 'reconciler',
          'all recipients reached a terminal state');
  perform marketing_event_append(p_tenant, 'marketing.campaign.completed',
    'marketing_campaign', p_campaign, 'marketing-delivery-sync',
    jsonb_build_object('k', 'completed:' || p_campaign, 'at', now()));
  return true;
end $$;

-- ── QUIET HOURS: sends defer inside the tenant's configured local window ────
create or replace function marketing_broadcast_in_quiet_hours(p_tenant uuid)
returns boolean
language plpgsql
stable
as $$
declare v_s marketing_settings%rowtype; v_hour int;
begin
  select * into v_s from marketing_settings where tenant_id = p_tenant;
  if not found or v_s.quiet_hours_start is null or v_s.quiet_hours_end is null then
    return false;
  end if;
  v_hour := extract(hour from now() at time zone coalesce(v_s.timezone, 'UTC'))::int;
  if v_s.quiet_hours_start = v_s.quiet_hours_end then
    return false;  -- zero-length window
  elsif v_s.quiet_hours_start < v_s.quiet_hours_end then
    return v_hour >= v_s.quiet_hours_start and v_hour < v_s.quiet_hours_end;
  else
    return v_hour >= v_s.quiet_hours_start or v_hour < v_s.quiet_hours_end;
  end if;
end $$;

-- ── WORKER: lease a small deterministic batch (SKIP LOCKED; lease recovery) ─
create or replace function marketing_broadcast_claim_batch(
  p_tenant uuid, p_worker text, p_limit int default 10, p_lease_seconds int default 120
) returns setof marketing_broadcast_dispatches
language plpgsql
as $$
begin
  if p_tenant is null or coalesce(p_worker, '') = '' then
    raise exception 'tenant and worker required' using errcode = '22023';
  end if;
  if marketing_broadcast_in_quiet_hours(p_tenant) then
    return;  -- quiet hours DEFER preparation; the scheduler re-drives later
  end if;
  return query
  with claimable as (
    select d.id from marketing_broadcast_dispatches d
     join marketing_campaigns c
       on c.id = d.campaign_id and c.tenant_id = d.tenant_id
    where d.tenant_id = p_tenant
      and c.status = 'active'
      and (d.status = 'pending'
           or (d.status = 'preparing' and d.lease_expires_at < now()))
    order by d.created_at, d.id
    for update of d skip locked
    limit greatest(1, least(25, p_limit))
  )
  update marketing_broadcast_dispatches d
     set status = 'preparing', lease_worker = p_worker,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(600, p_lease_seconds)))
    from claimable
   where d.id = claimable.id
  returning d.*;
end $$;

-- ── WORKER: the frozen render bundle + a freshly minted unsubscribe token ───
create or replace function marketing_broadcast_recipient_bundle(
  p_tenant uuid, p_dispatch uuid, p_worker text
) returns jsonb
language plpgsql
as $$
declare
  v_d marketing_broadcast_dispatches%rowtype;
  v_c marketing_campaigns%rowtype;
  v_m marketing_audience_members%rowtype;
  v_rev marketing_campaign_revisions%rowtype;
  v_sender marketing_sender_profiles%rowtype;
  v_appr marketing_campaign_approvals%rowtype;
  v_verdict jsonb;
  v_token text;
  v_token_id uuid := gen_random_uuid();
begin
  select * into v_d from marketing_broadcast_dispatches
   where id = p_dispatch and tenant_id = p_tenant for update;
  if not found then
    raise exception 'dispatch not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.status <> 'preparing' or v_d.lease_worker is distinct from p_worker
     or v_d.lease_expires_at < now() then
    raise exception 'dispatch is not leased by this worker' using errcode = 'MK423';
  end if;
  -- idempotent: already prepared by an earlier crash-interrupted run
  if v_d.delivery_id is not null then
    return jsonb_build_object('already_prepared', true,
      'delivery_id', v_d.delivery_id, 'intent_id', v_d.automation_intent_id);
  end if;
  select * into v_c from marketing_campaigns
   where id = v_d.campaign_id and tenant_id = p_tenant;
  select * into v_m from marketing_audience_members
   where id = v_d.member_id and tenant_id = p_tenant;

  -- RACE CLOSURE (check 2 of 3): full canonical authority BEFORE any intent
  v_verdict := marketing_broadcast_authority_core(
    p_tenant, v_d.campaign_id, v_c.current_revision_id, v_d.snapshot_id,
    v_d.member_id, v_d.person_id, v_d.contact_point_id, v_m.destination);
  if not (v_verdict ->> 'allowed')::boolean then
    if (v_verdict ->> 'code') in ('campaign_not_active', 'campaign_missing') then
      -- a CANCELLED campaign will never claim this recipient again: leaving it
      -- 'pending' would report work that can never happen. A pause/schedule
      -- pause genuinely defers, so only cancellation is terminal here.
      if v_c.status = 'cancelled' then
        update marketing_broadcast_dispatches
           set status = 'cancelled', lease_worker = null, lease_expires_at = null,
               finished_at = now()
         where id = p_dispatch;
        return jsonb_build_object('cancelled', true, 'code', v_verdict ->> 'code');
      end if;
      -- pause mid-batch: release the lease, prepare nothing
      update marketing_broadcast_dispatches
         set status = 'pending', lease_worker = null, lease_expires_at = null
       where id = p_dispatch;
      return jsonb_build_object('deferred', true, 'code', v_verdict ->> 'code');
    end if;
    update marketing_broadcast_dispatches
       set status = 'skipped', skip_reason = 'policy_' || (v_verdict ->> 'code'),
           finished_at = now()
     where id = p_dispatch;
    perform marketing_event_append(p_tenant, 'marketing.broadcast.recipient_skipped',
      'marketing_dispatch', p_dispatch, 'marketing-broadcast-worker',
      jsonb_build_object('k', 'skip:' || p_dispatch, 'reason', v_verdict ->> 'code',
                         'campaign', v_d.campaign_id, 'at', now()));
    perform marketing_broadcast_check_completion(p_tenant, v_d.campaign_id);
    return jsonb_build_object('skipped', true, 'code', v_verdict ->> 'code');
  end if;

  select * into v_rev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  select * into v_sender from marketing_sender_profiles
   where tenant_id = p_tenant and id = v_rev.sender_profile_id;
  select * into v_appr from marketing_campaign_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_d.campaign_id
     and a.revision_id = v_rev.id and a.decision = 'approved'
   order by a.created_at desc limit 1;

  -- mint the recipient's opaque unsubscribe token: digest stored, plaintext
  -- returned ONCE for the frozen envelope. Any prior unused token for this
  -- dispatch is revoked so exactly one can ever be live.
  update marketing_unsubscribe_tokens set revoked_at = now()
   where tenant_id = p_tenant and dispatch_id = p_dispatch
     and used_at is null and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into marketing_unsubscribe_tokens
    (id, tenant_id, token_digest, campaign_id, dispatch_id, person_id,
     contact_point_id, destination, expires_at)
  values
    (v_token_id, p_tenant, encode(extensions.digest(v_token, 'sha256'), 'hex'),
     v_d.campaign_id, p_dispatch, v_d.person_id, v_d.contact_point_id,
     v_m.destination, now() + interval '180 days');

  return jsonb_build_object(
    'dispatch_id', p_dispatch, 'generation', v_d.generation,
    'campaign_id', v_d.campaign_id, 'campaign_name', v_c.name,
    'revision_id', v_rev.id, 'revision_hash', v_rev.content_hash,
    'snapshot_id', v_d.snapshot_id, 'member_id', v_d.member_id,
    'person_id', v_d.person_id, 'contact_point_id', v_d.contact_point_id,
    'destination', v_m.destination,
    'personalisation', v_m.personalisation,
    'subject', v_rev.subject, 'preview_text', v_rev.preview_text,
    'body_authored', v_rev.body_authored,
    'tokens_required', to_jsonb(v_rev.tokens_required),
    'token_fallbacks', v_rev.token_fallbacks,
    'sender_profile_id', v_sender.id, 'mailbox_address', v_sender.mailbox_address,
    'from_name', v_sender.from_name, 'reply_to', v_sender.reply_to,
    'signature_text', v_sender.signature_text,
    'approver_profile_id', v_appr.approver_profile_id,
    'campaign_approval_id', v_appr.id,
    'public_base_url', v_c.launch_public_base_url,
    'unsubscribe_footer', coalesce((select ms.unsubscribe_footer from marketing_settings ms
                                     where ms.tenant_id = p_tenant), '{}'::jsonb),
    'unsubscribe_token_id', v_token_id, 'unsubscribe_token', v_token);
end $$;

-- ── WORKER: create the complete governed lineage for ONE recipient ──────────
create or replace function marketing_broadcast_create_lineage(
  p_tenant uuid, p_dispatch uuid, p_worker text, p_args jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_d marketing_broadcast_dispatches%rowtype;
  v_c marketing_campaigns%rowtype;
  v_m marketing_audience_members%rowtype;
  v_rev marketing_campaign_revisions%rowtype;
  v_sender marketing_sender_profiles%rowtype;
  v_appr marketing_campaign_approvals%rowtype;
  v_tok marketing_unsubscribe_tokens%rowtype;
  v_verdict jsonb;
  v_key text;
  v_subject text;
  v_body text;
  v_html text;
  v_preview text;
  v_unsub_url text;
  v_url_token text;
  v_request text;
  v_hash text;
  v_fp text;
  v_action uuid := gen_random_uuid();
  v_decision uuid := gen_random_uuid();
  v_intent uuid := gen_random_uuid();
  v_delivery uuid := gen_random_uuid();
  v_correlation uuid := gen_random_uuid();
  v_existing marketing_deliveries%rowtype;
  v_mode text;
  v_pkg jsonb;
  v_params jsonb;
begin
  select * into v_d from marketing_broadcast_dispatches
   where id = p_dispatch and tenant_id = p_tenant for update;
  if not found then
    raise exception 'dispatch not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.status <> 'preparing' or v_d.lease_worker is distinct from p_worker
     or v_d.lease_expires_at < now() then
    raise exception 'dispatch is not leased by this worker' using errcode = 'MK423';
  end if;
  if v_d.delivery_id is not null then
    return jsonb_build_object('delivery_id', v_d.delivery_id,
      'intent_id', v_d.automation_intent_id, 'idempotent', true);
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then
    raise exception 'args must be an object' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_args) loop
    if v_key not in ('subject', 'body_text', 'body_html', 'preview_text', 'unsubscribe_url') then
      raise exception 'unknown lineage argument %', v_key using errcode = '22023';
    end if;
  end loop;

  select * into v_c from marketing_campaigns
   where id = v_d.campaign_id and tenant_id = p_tenant;
  select * into v_m from marketing_audience_members
   where id = v_d.member_id and tenant_id = p_tenant;
  select * into v_rev from marketing_campaign_revisions
   where tenant_id = p_tenant and id = v_c.current_revision_id;
  select * into v_sender from marketing_sender_profiles
   where tenant_id = p_tenant and id = v_rev.sender_profile_id;
  select * into v_appr from marketing_campaign_approvals a
   where a.tenant_id = p_tenant and a.campaign_id = v_d.campaign_id
     and a.revision_id = v_rev.id and a.decision = 'approved'
   order by a.created_at desc limit 1;

  -- RACE CLOSURE (still check 2 of 3): authority immediately before lineage
  v_verdict := marketing_broadcast_authority_core(
    p_tenant, v_d.campaign_id, v_c.current_revision_id, v_d.snapshot_id,
    v_d.member_id, v_d.person_id, v_d.contact_point_id, v_m.destination);
  if not (v_verdict ->> 'allowed')::boolean then
    if (v_verdict ->> 'code') in ('campaign_not_active', 'campaign_missing') then
      if v_c.status = 'cancelled' then
        update marketing_broadcast_dispatches
           set status = 'cancelled', lease_worker = null, lease_expires_at = null,
               finished_at = now()
         where id = p_dispatch;
        return jsonb_build_object('cancelled', true, 'code', v_verdict ->> 'code');
      end if;
      update marketing_broadcast_dispatches
         set status = 'pending', lease_worker = null, lease_expires_at = null
       where id = p_dispatch;
      return jsonb_build_object('deferred', true, 'code', v_verdict ->> 'code');
    end if;
    update marketing_broadcast_dispatches
       set status = 'skipped', skip_reason = 'policy_' || (v_verdict ->> 'code'),
           finished_at = now()
     where id = p_dispatch;
    perform marketing_event_append(p_tenant, 'marketing.broadcast.recipient_skipped',
      'marketing_dispatch', p_dispatch, 'marketing-broadcast-worker',
      jsonb_build_object('k', 'skip:' || p_dispatch, 'reason', v_verdict ->> 'code',
                         'campaign', v_d.campaign_id, 'at', now()));
    perform marketing_broadcast_check_completion(p_tenant, v_d.campaign_id);
    return jsonb_build_object('skipped', true, 'code', v_verdict ->> 'code');
  end if;

  -- ── rendered artifacts: shape-validated; the render INPUTS are the frozen
  --    member context + immutable revision (renderer determinism is proven by
  --    the pure suite) ──
  v_subject := p_args ->> 'subject';
  v_body := p_args ->> 'body_text';
  v_html := p_args ->> 'body_html';
  v_preview := nullif(p_args ->> 'preview_text', '');
  v_unsub_url := p_args ->> 'unsubscribe_url';
  if v_subject is null or length(v_subject) < 1 or length(v_subject) > 300
     or v_subject ~ '[[:cntrl:]]' then
    raise exception 'rendered subject invalid' using errcode = '22023';
  end if;
  if v_body is null or length(v_body) < 1 or length(v_body) > 30000 then
    raise exception 'rendered body invalid' using errcode = '22023';
  end if;
  if v_html is null or length(v_html) < 1 or length(v_html) > 100000 then
    raise exception 'rendered html invalid' using errcode = '22023';
  end if;
  if v_preview is not null and (length(v_preview) > 150 or v_preview ~ '[[:cntrl:]]') then
    raise exception 'rendered preview invalid' using errcode = '22023';
  end if;
  -- the unsubscribe URL must be the frozen public base + THIS dispatch's live
  -- minted token (digest-verified), and must appear in BOTH rendered bodies
  if v_unsub_url is null
     or position(v_c.launch_public_base_url in v_unsub_url) <> 1 then
    raise exception 'unsubscribe url must use the frozen public base url' using errcode = '22023';
  end if;
  v_url_token := substring(v_unsub_url from 't=([0-9a-f]{48})');
  if v_url_token is null then
    raise exception 'unsubscribe url carries no token' using errcode = '22023';
  end if;
  select * into v_tok from marketing_unsubscribe_tokens
   where tenant_id = p_tenant and dispatch_id = p_dispatch
     and used_at is null and revoked_at is null
   order by created_at desc limit 1;
  if v_tok.id is null
     or v_tok.token_digest <> encode(extensions.digest(v_url_token, 'sha256'), 'hex') then
    raise exception 'unsubscribe token does not match the minted token' using errcode = '22023';
  end if;
  if position(v_unsub_url in v_body) = 0 or position(v_unsub_url in v_html) = 0 then
    raise exception 'the visible unsubscribe link must appear in both bodies'
      using errcode = '22023';
  end if;

  -- deterministic idempotency: campaign member + generation
  v_request := 'bc-' || replace(v_d.member_id::text, '-', '') || '-g' || v_d.generation;
  select * into v_existing from marketing_deliveries
   where tenant_id = p_tenant and request_id = v_request;
  if found then
    -- converge: bind the dispatch to the existing lineage
    update marketing_broadcast_dispatches
       set status = 'queued', delivery_id = v_existing.id,
           automation_intent_id = v_existing.automation_intent_id, prepared_at = now()
     where id = p_dispatch;
    return jsonb_build_object('delivery_id', v_existing.id,
      'intent_id', v_existing.automation_intent_id, 'idempotent', true);
  end if;

  v_hash := encode(extensions.digest(jsonb_build_object(
    'sender', v_sender.id, 'mailbox', v_sender.mailbox_address,
    'recipient', v_m.destination, 'subject', v_subject, 'body', v_body,
    'html', v_html, 'preview', v_preview, 'from_name', v_sender.from_name,
    'reply_to', v_sender.reply_to, 'signature', v_sender.signature_text,
    'purpose', 'broadcast', 'content_version', '1',
    'revision_hash', v_rev.content_hash, 'member', v_d.member_id,
    'unsubscribe_url', v_unsub_url)::text, 'sha256'), 'hex');
  v_fp := marketing_request_fingerprint(v_request, v_appr.approver_profile_id,
                                        v_sender.id, v_d.person_id, v_hash);

  select coalesce(
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id = p_tenant and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1),
    (select e.value #>> '{}' from operating_profile_entries e
      where e.tenant_id is null and e.namespace = 'operational_mode' and e.key = 'current'
      limit 1)) into v_mode;

  insert into intelligence_objects (id, tenant_id, domain, object_type, object_class,
                                    subject, status)
  values (v_action, p_tenant, 'core', 'Action', 'action',
          'Broadcast "' || left(v_c.name, 60) || '" to ' || v_m.destination, 'ready');

  -- HONEST approval-requiring package: tenant review IS required — and it was
  -- genuinely given by the recorded owner/admin launch approver, whose
  -- append-only automation_approvals row is created below.
  v_pkg := jsonb_build_object(
    'id', v_decision,
    'tenantId', p_tenant,
    'supersedes', null,
    'intelligenceObjectId', v_action,
    'intelligenceObjectType', 'Action',
    'objectClass', 'action',
    'domainPackKeys', jsonb_build_array(),
    'decision', 'AUTOMATION_REQUIRES_APPROVAL',
    'nextDecisionOwner', jsonb_build_object('kind', 'automation'),
    'rationale', jsonb_build_object(
      'summary', 'Approved broadcast campaign recipient — tenant-senior launch approval recorded',
      'reasonCodes', jsonb_build_array('campaign_launch_approved'),
      'policyMatches', jsonb_build_array('marketing.campaigns.launch'),
      'rejectedAlternatives', jsonb_build_array(),
      'missingConfiguration', jsonb_build_array()),
    'confidence', jsonb_build_object('score', 1, 'threshold', 0,
                                     'ambiguityScore', 0, 'evidenceQuality', 1),
    'authority', jsonb_build_object(
      'requiredAuthority', 'tenant_senior',
      'resolvedAuthorityHolder', v_appr.approver_profile_id::text,
      'delegatedLimit', null, 'requestedValue', null,
      'withinDelegatedAuthority', true),
    'risk', jsonb_build_object('level', 'medium', 'score', 0.4,
                               'categories', jsonb_build_array('customer')),
    'reversibility', jsonb_build_object('level', 'irreversible',
                                        'compensationAvailable', false),
    'impact', jsonb_build_object('level', 'medium', 'categories', jsonb_build_array('customer')),
    'ownership', jsonb_build_object('responsible', null, 'accountable', null,
      'approver', v_appr.approver_profile_id::text, 'waitingOn', null,
      'consulted', jsonb_build_array(), 'informed', jsonb_build_array()),
    'proposedAction', null,
    'automationIntent', jsonb_build_object('intentType', 'send_marketing_broadcast_email',
      'payload', jsonb_build_object('content_hash', v_hash), 'requiresApproval', true),
    'routing', jsonb_build_object('reviewRequired', true, 'openfolkRequired', false,
      'tenantReviewRequired', true, 'customerApprovalRequired', false,
      'waitCondition', null),
    'versions', jsonb_build_object('engineVersion', 'marketing-broadcast.v1',
      'operatingProfileVersion', null,
      'policyVersionIds', jsonb_build_array(),
      'learningVersionIds', jsonb_build_array()),
    'audit', jsonb_build_object('correlationId', v_correlation,
      'inputHash', v_hash, 'outputHash', v_hash));

  insert into decision_log
    (id, tenant_id, object_id, object_snapshot, effective_profile_hash,
     policy_version_ids, matched_rules, outputs, input_hash,
     decision, operational_mode, next_owner_kind, engine_version,
     operating_profile_version, learning_version_ids, reason_codes,
     correlation_id, output_hash, supersedes, decision_package)
  values
    (v_decision, p_tenant, v_action,
     jsonb_build_object('kind', 'marketing_broadcast_send', 'campaign', v_d.campaign_id,
                        'revision', v_rev.id, 'snapshot', v_d.snapshot_id,
                        'member', v_d.member_id, 'content_hash', v_hash,
                        'campaign_approval', v_appr.id,
                        'authority_basis', 'marketing.campaigns.launch'),
     v_hash, '{}', '[]'::jsonb,
     jsonb_build_object('decision', 'AUTOMATION_REQUIRES_APPROVAL',
                        'reason_codes', jsonb_build_array('campaign_launch_approved')),
     v_hash, 'AUTOMATION_REQUIRES_APPROVAL', v_mode, 'automation',
     'marketing-broadcast.v1', null, '{}', array['campaign_launch_approved'],
     v_correlation, v_hash, null, v_pkg);

  v_params := jsonb_build_object(
    'sender_profile_id', v_sender.id,
    'source_kind', v_sender.source_kind,
    'mailbox_address', v_sender.mailbox_address,
    'recipient_profile_id', null,
    'recipient_email', v_m.destination,
    'subject', v_subject,
    'body_text', v_body,
    'body_html', v_html,
    'preview_text', v_preview,
    'from_name', v_sender.from_name,
    'reply_to', v_sender.reply_to,
    'signature_text', v_sender.signature_text,
    'purpose', 'broadcast',
    'content_version', '1',
    'content_hash', v_hash,
    'actor_profile_id', v_appr.approver_profile_id,
    'request_id', v_request,
    'delivery_id', v_delivery,
    'campaign_id', v_d.campaign_id,
    'campaign_revision_id', v_rev.id,
    'campaign_approval_id', v_appr.id,
    'revision_hash', v_rev.content_hash,
    'audience_snapshot_id', v_d.snapshot_id,
    'audience_member_id', v_d.member_id,
    'dispatch_id', p_dispatch,
    'dispatch_generation', v_d.generation,
    'person_id', v_d.person_id,
    'contact_point_id', v_d.contact_point_id,
    'unsubscribe_token_id', v_tok.id,
    'unsubscribe_url', v_unsub_url);

  insert into automation_intents
    (id, tenant_id, action_object_id, intent_type, parameters, status,
     connector_id, capability_key, decision_id, correlation_id,
     expires_at, max_attempts, schema_version)
  values
    (v_intent, p_tenant, v_action, 'send_marketing_broadcast_email', v_params, 'pending',
     'google-gmail', 'email.send_marketing', v_decision, v_correlation,
     now() + interval '1 hour', 3, '1');
  update automation_intents
     set approved_payload_hash = automation_intent_envelope_hash(p_tenant, v_intent)
   where id = v_intent;

  -- the REAL append-only approval: the genuine tenant-senior launch actor
  insert into automation_approvals
    (tenant_id, automation_intent_id, decision_id, approver_kind, approver_ref,
     authority_basis, decision, expires_at, evidence, correlation_id)
  values
    (p_tenant, v_intent, v_decision, 'tenant_senior',
     v_appr.approver_profile_id::text, 'marketing.campaigns.launch', 'approved',
     now() + interval '30 days',
     jsonb_build_object('campaign_id', v_d.campaign_id,
                        'campaign_approval_id', v_appr.id,
                        'revision_id', v_rev.id, 'revision_hash', v_rev.content_hash,
                        'snapshot_id', v_d.snapshot_id, 'snapshot_member_id', v_d.member_id,
                        'dispatch_id', p_dispatch, 'content_hash', v_hash),
     v_correlation);

  insert into marketing_deliveries
    (id, tenant_id, sender_profile_id, purpose, actor_profile_id, recipient_email,
     person_id, automation_intent_id, request_id, request_fingerprint, correlation_id,
     subject, body_text, from_name, reply_to, signature_text, content_version,
     content_hash, status, campaign_id, campaign_revision_id, audience_snapshot_id,
     audience_member_id, dispatch_id, contact_point_id, unsubscribe_token_id,
     body_html, preview_text, dispatch_generation)
  values
    (v_delivery, p_tenant, v_sender.id, 'broadcast', v_appr.approver_profile_id,
     v_m.destination, v_d.person_id, v_intent, v_request, v_fp, v_correlation,
     v_subject, v_body, v_sender.from_name, v_sender.reply_to, v_sender.signature_text,
     '1', v_hash, 'queued', v_d.campaign_id, v_rev.id, v_d.snapshot_id, v_d.member_id,
     p_dispatch, v_d.contact_point_id, v_tok.id, v_html, v_preview, v_d.generation);
  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail)
  values (p_tenant, v_delivery, v_intent, null, 'queued', 'broadcast recipient queued');

  update marketing_broadcast_dispatches
     set status = 'queued', delivery_id = v_delivery,
         automation_intent_id = v_intent, prepared_at = now()
   where id = p_dispatch;

  perform marketing_event_append(p_tenant, 'marketing.broadcast.recipient_queued',
    'marketing_dispatch', p_dispatch, 'marketing-broadcast-worker',
    jsonb_build_object('k', 'queued:' || p_dispatch, 'campaign', v_d.campaign_id,
                       'delivery', v_delivery, 'at', now()));

  return jsonb_build_object('delivery_id', v_delivery, 'intent_id', v_intent,
    'correlation_id', v_correlation, 'idempotent', false);
end $$;

-- ============================================================================
-- PUBLIC UNSUBSCRIBE — idempotent, non-enumerating. The caller (public Edge
-- function) receives {ok:true} for EVERY input shape: invalid, expired,
-- revoked and replayed tokens are indistinguishable from success outside.
-- ============================================================================
create or replace function marketing_unsubscribe_apply(p_token text)
returns jsonb
language plpgsql
as $$
declare
  v_tok marketing_unsubscribe_tokens%rowtype;
  v_first_use boolean := false;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return jsonb_build_object('ok', true);
  end if;
  select * into v_tok from marketing_unsubscribe_tokens
   where token_digest = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found or v_tok.revoked_at is not null or v_tok.expires_at < now() then
    return jsonb_build_object('ok', true);
  end if;

  if v_tok.used_at is null then
    v_first_use := true;
    update marketing_unsubscribe_tokens set used_at = now() where id = v_tok.id;
  end if;

  -- CONVERGE, never duplicate: one effective preference fact…
  if v_first_use or not exists (
       select 1 from communication_preferences pr
        where pr.tenant_id = v_tok.tenant_id and pr.person_id = v_tok.person_id
          and pr.channel = 'email' and pr.state = 'unsubscribed'
          and pr.source = 'unsubscribe_link'
          and pr.evidence ->> 'unsubscribe_token_id' = v_tok.id::text) then
    if v_first_use then
      insert into communication_preferences
        (tenant_id, person_id, contact_point_id, channel, state, source, evidence)
      values (v_tok.tenant_id, v_tok.person_id, v_tok.contact_point_id, 'email',
              'unsubscribed', 'unsubscribe_link',
              jsonb_build_object('campaign_id', v_tok.campaign_id,
                                 'dispatch_id', v_tok.dispatch_id,
                                 'unsubscribe_token_id', v_tok.id));
    end if;
  end if;
  -- …one ACTIVE hard suppression (count-guarded: ON CONFLICT cannot target the
  -- partial unique indexes, a proven repo gotcha)…
  if not exists (select 1 from contact_suppressions s
                  where s.tenant_id = v_tok.tenant_id and s.active
                    and s.channel = 'email' and s.normalized_value = v_tok.destination) then
    insert into contact_suppressions
      (tenant_id, person_id, contact_point_id, channel, normalized_value, reason,
       active, source, evidence)
    values (v_tok.tenant_id, v_tok.person_id, v_tok.contact_point_id, 'email',
            v_tok.destination, 'unsubscribe', true, 'unsubscribe_link',
            jsonb_build_object('campaign_id', v_tok.campaign_id,
                               'unsubscribe_token_id', v_tok.id));
  end if;
  -- …and one controlled fact/event + audit, on the FIRST use only.
  if v_first_use then
    perform marketing_event_append(v_tok.tenant_id, 'marketing.unsubscribe.recorded',
      'person', v_tok.person_id, 'marketing-unsubscribe',
      jsonb_build_object('k', 'unsub:' || v_tok.id, 'campaign', v_tok.campaign_id,
                         'at', now()));
    insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
    values (v_tok.tenant_id, 'public-unsubscribe', 'marketing.unsubscribe.recorded',
            'person', v_tok.person_id::text, 'ok',
            jsonb_build_object('campaign_id', v_tok.campaign_id,
                               'token_id', v_tok.id));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- BOUNDED READS — list, detail, report, recipient drill-down, health
-- ============================================================================
create or replace function marketing_campaign_list(p_tenant uuid, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_limit int := 25;
  v_rows jsonb;
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 100);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'description', c.description,
           'status', c.status, 'version', c.version,
           'owner_id', c.owner_id,
           'owner_email', (select pr.email from profiles pr where pr.id = c.owner_id),
           'sender_profile_id', r.sender_profile_id,
           'sender_mailbox', (select sp.mailbox_address from marketing_sender_profiles sp
                               where sp.id = r.sender_profile_id),
           'segment_id', r.segment_id,
           'segment_name', (select s.name from marketing_segments s where s.id = r.segment_id),
           'revision_number', r.revision_number,
           'current_revision_id', c.current_revision_id,
           'schedule_local', c.schedule_local, 'timezone', c.timezone,
           'schedule_at', c.schedule_at,
           'snapshot', (select jsonb_build_object('id', s.id, 'included', s.included_count,
                                                  'excluded', s.excluded_count,
                                                  'created_at', s.created_at)
                          from marketing_audience_snapshots s
                         where s.tenant_id = p_tenant and s.id = c.active_snapshot_id),
           'dispatch_counts', (select coalesce(jsonb_object_agg(d.status, d.n), '{}'::jsonb)
                                 from (select status, count(*) n
                                         from marketing_broadcast_dispatches
                                        where tenant_id = p_tenant and campaign_id = c.id
                                        group by status) d),
           'updated_at', c.updated_at, 'created_at', c.created_at
         ) order by c.updated_at desc), '[]'::jsonb)
    into v_rows
    from (select * from marketing_campaigns
           where tenant_id = p_tenant and campaign_type = 'broadcast'
           order by updated_at desc limit v_limit) c
    left join marketing_campaign_revisions r
           on r.tenant_id = p_tenant and r.id = c.current_revision_id;
  return jsonb_build_object('campaigns', v_rows);
end $$;

create or replace function marketing_campaign_detail(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c marketing_campaigns%rowtype;
  v_out jsonb;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'id', v_c.id, 'name', v_c.name, 'description', v_c.description,
    'status', v_c.status, 'version', v_c.version, 'owner_id', v_c.owner_id,
    'schedule_local', v_c.schedule_local, 'timezone', v_c.timezone,
    'schedule_at', v_c.schedule_at, 'schedule_fold', v_c.schedule_fold,
    'launched_at', v_c.launched_at, 'approved_at', v_c.approved_at,
    'completed_at', v_c.completed_at, 'cancelled_at', v_c.cancelled_at,
    'active_snapshot_id', v_c.active_snapshot_id,
    'revision', (select to_jsonb(r) - 'tenant_id'
                   from marketing_campaign_revisions r
                  where r.tenant_id = p_tenant and r.id = v_c.current_revision_id),
    'revisions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', r.id, 'revision_number', r.revision_number,
                     'subject', r.subject, 'created_at', r.created_at,
                     'created_by', r.created_by, 'content_hash', r.content_hash)
                     order by r.revision_number desc), '[]'::jsonb)
                    from marketing_campaign_revisions r
                   where r.tenant_id = p_tenant and r.campaign_id = p_campaign),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', a.id, 'decision', a.decision, 'revision_id', a.revision_id,
                     'approver', (select pr.email from profiles pr
                                   where pr.id = a.approver_profile_id),
                     'note', a.note, 'created_at', a.created_at)
                     order by a.created_at desc), '[]'::jsonb)
                    from marketing_campaign_approvals a
                   where a.tenant_id = p_tenant and a.campaign_id = p_campaign),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                  'seq', e.seq, 'from', e.from_status, 'to', e.to_status,
                  'actor', e.actor, 'detail', e.detail, 'at', e.created_at)
                  order by e.seq), '[]'::jsonb)
                 from marketing_campaign_events e
                where e.tenant_id = p_tenant and e.campaign_id = p_campaign),
    'snapshot', (select jsonb_build_object('id', s.id, 'created_at', s.created_at,
                    'candidate_count', s.candidate_count, 'included_count', s.included_count,
                    'excluded_count', s.excluded_count,
                    'exclusion_breakdown', s.exclusion_breakdown,
                    'snapshot_hash', s.snapshot_hash, 'settings_version', s.settings_version,
                    'segment_version', s.segment_version)
                   from marketing_audience_snapshots s
                  where s.tenant_id = p_tenant and s.id = v_c.active_snapshot_id))
    into v_out;
  return v_out;
end $$;

create or replace function marketing_campaign_report(p_tenant uuid, p_campaign uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_c marketing_campaigns%rowtype;
begin
  select * into v_c from marketing_campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'campaign not found for tenant' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'campaign_id', v_c.id, 'status', v_c.status,
    'snapshot', (select jsonb_build_object('candidate', s.candidate_count,
                    'included', s.included_count, 'excluded', s.excluded_count,
                    'exclusion_breakdown', s.exclusion_breakdown)
                   from marketing_audience_snapshots s
                  where s.tenant_id = p_tenant and s.id = v_c.active_snapshot_id),
    'dispatch', (select coalesce(jsonb_object_agg(d.status, d.n), '{}'::jsonb)
                   from (select status, count(*) n from marketing_broadcast_dispatches
                          where tenant_id = p_tenant and campaign_id = p_campaign
                          group by status) d),
    'unsubscribed', (select count(*) from marketing_unsubscribe_tokens t
                      where t.tenant_id = p_tenant and t.campaign_id = p_campaign
                        and t.used_at is not null),
    -- HONEST: no evidence pipeline exists for these — unavailable, never zero
    'clicked', null,
    'delivered', null, 'opened', null, 'replied', null, 'bounced', null,
    'tracking', jsonb_build_object(
      'enabled', coalesce((select ms.tracking_enabled from marketing_settings ms
                            where ms.tenant_id = p_tenant), false),
      'state', 'unavailable',
      'note', 'Click tracking is not implemented in this phase — no redirect endpoint exists and no click is ever fabricated'),
    'submitted_meaning', 'accepted by Gmail — NOT delivered');
end $$;

create or replace function marketing_campaign_recipient_page(
  p_tenant uuid, p_campaign uuid, p_args jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_limit int := 25;
  v_cur jsonb;
  v_cur_at timestamptz;
  v_cur_id uuid;
  v_rows jsonb;
  v_next jsonb;
begin
  if p_tenant is null or p_campaign is null then
    raise exception 'tenant and campaign required' using errcode = '22023';
  end if;
  if p_args ? 'limit' then
    if jsonb_typeof(p_args -> 'limit') <> 'number' or (p_args ->> 'limit') ~ '[.eE]' then
      raise exception 'limit must be an integer' using errcode = '22023';
    end if;
    v_limit := least(greatest((p_args ->> 'limit')::int, 1), 50);
  end if;
  if p_args ? 'cursor' and jsonb_typeof(p_args -> 'cursor') <> 'null' then
    v_cur := p_args -> 'cursor';
    if jsonb_typeof(v_cur) <> 'object'
       or jsonb_typeof(v_cur -> 'at') <> 'string'
       or jsonb_typeof(v_cur -> 'id') <> 'string'
       or (select count(*) from jsonb_object_keys(v_cur)) <> 2 then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
    begin
      v_cur_at := (v_cur ->> 'at')::timestamptz;
      v_cur_id := (v_cur ->> 'id')::uuid;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
  end if;

  select coalesce(jsonb_agg(row_j order by created_at, id), '[]'::jsonb) into v_rows from (
    select d.created_at, d.id, jsonb_build_object(
      'dispatch_id', d.id, 'status', d.status, 'generation', d.generation,
      'person_id', d.person_id,
      'display_name', (select p.display_name from people p where p.id = d.person_id),
      'destination', (select m.destination from marketing_audience_members m
                       where m.id = d.member_id),
      'skip_reason', d.skip_reason, 'failure_class', d.failure_class,
      'delivery_id', d.delivery_id,
      'delivery_status', (select del.status from marketing_deliveries del
                           where del.id = d.delivery_id),
      'provider_message_id', (select del.provider_message_id from marketing_deliveries del
                               where del.id = d.delivery_id),
      'submitted_at', (select del.submitted_at from marketing_deliveries del
                        where del.id = d.delivery_id),
      'prepared_at', d.prepared_at, 'finished_at', d.finished_at,
      'created_at', d.created_at) as row_j
      from marketing_broadcast_dispatches d
     where d.tenant_id = p_tenant and d.campaign_id = p_campaign
       and (v_cur_at is null or (d.created_at, d.id) > (v_cur_at, v_cur_id))
     order by d.created_at, d.id
     limit v_limit + 1
  ) page;

  if jsonb_array_length(v_rows) > v_limit then
    v_next := jsonb_build_object(
      'at', (v_rows -> (v_limit - 1)) ->> 'created_at',
      'id', (v_rows -> (v_limit - 1)) ->> 'dispatch_id');
    v_rows := (select coalesce(jsonb_agg(t.e order by t.i), '[]'::jsonb)
                 from jsonb_array_elements(v_rows) with ordinality t(e, i)
                where t.i <= v_limit);
  end if;
  return jsonb_build_object('recipients', v_rows, 'next_cursor', v_next);
end $$;

create or replace function marketing_broadcast_health(p_tenant uuid)
returns jsonb
language plpgsql
stable
as $$
begin
  if p_tenant is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'campaigns', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb)
                    from (select status, count(*) n from marketing_campaigns
                           where tenant_id = p_tenant and campaign_type = 'broadcast'
                           group by status) c),
    'queue_depth', (select count(*) from marketing_broadcast_dispatches d
                     join marketing_campaigns c on c.id = d.campaign_id
                    where d.tenant_id = p_tenant and c.status = 'active'
                      and d.status in ('pending', 'preparing')),
    'oldest_pending_seconds', (select extract(epoch from (now() - min(d.created_at)))::int
                                 from marketing_broadcast_dispatches d
                                 join marketing_campaigns c on c.id = d.campaign_id
                                where d.tenant_id = p_tenant and c.status = 'active'
                                  and d.status = 'pending'),
    'active_leases', (select count(*) from marketing_broadcast_dispatches
                       where tenant_id = p_tenant and status = 'preparing'
                         and lease_expires_at >= now()),
    'expired_leases', (select count(*) from marketing_broadcast_dispatches
                        where tenant_id = p_tenant and status = 'preparing'
                          and lease_expires_at < now()),
    'dispatch_totals', (select coalesce(jsonb_object_agg(d.status, d.n), '{}'::jsonb)
                          from (select status, count(*) n from marketing_broadcast_dispatches
                                 where tenant_id = p_tenant group by status) d),
    'unknown_needing_review', (select count(*) from marketing_broadcast_dispatches
                                where tenant_id = p_tenant and status = 'unknown'),
    'next_scheduled', (select min(schedule_at) from marketing_campaigns
                        where tenant_id = p_tenant and status = 'scheduled'),
    'in_quiet_hours', marketing_broadcast_in_quiet_hours(p_tenant),
    'sender_health', marketing_sender_health(p_tenant));
end $$;

-- ============================================================================
-- RECONCILER — REPLACED with a superset. The Phase-4 test-send behaviour is
-- byte-compatible; broadcast deliveries additionally: map intent 'cancelled'
-- to delivery 'cancelled' and engine-recorded POLICY refusals to 'skipped',
-- keep the dispatch row in sync, stamp campaign/person provenance on the
-- canonical email row, and derive campaign COMPLETION from recipient facts
-- (unknown results prevent a falsely clean completion).
-- ============================================================================
create or replace function marketing_delivery_reconcile(p_tenant uuid, p_delivery uuid)
returns jsonb
language plpgsql
as $$
declare
  v_d marketing_deliveries%rowtype;
  v_intent automation_intents%rowtype;
  v_attempt automation_execution_attempts%rowtype;
  v_new_status text;
  v_failure text;
  v_msg_id text;
  v_thread_id text;
  v_submitted timestamptz;
  v_disp marketing_broadcast_dispatches%rowtype;
  v_campaign marketing_campaigns%rowtype;
begin
  if p_tenant is null or p_delivery is null then
    raise exception 'tenant and delivery required' using errcode = '22023';
  end if;
  select * into v_d from marketing_deliveries
   where id = p_delivery and tenant_id = p_tenant for update;
  if not found then
    raise exception 'delivery not found for tenant' using errcode = 'P0002';
  end if;
  if v_d.status in ('submitted', 'failed', 'skipped', 'cancelled') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false);
  end if;

  select * into v_intent from automation_intents
   where id = v_d.automation_intent_id and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false, 'note', 'intent missing');
  end if;
  select * into v_attempt from automation_execution_attempts a
   where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
   order by a.completed_at desc nulls last, a.started_at desc nulls last,
            a.created_at desc, a.id desc limit 1;

  v_new_status := case v_intent.status
    when 'succeeded' then 'submitted'
    when 'executing' then 'executing'
    when 'claimed'   then 'executing'
    when 'unknown'   then 'unknown'
    when 'expired'   then 'failed'
    when 'cancelled' then case when v_d.purpose = 'broadcast' then 'cancelled' else 'failed' end
    when 'rejected'  then 'failed'
    when 'failed'    then case
      when v_d.purpose = 'broadcast' and v_attempt.id is not null
           and v_attempt.status = 'failed_permanent'
           and v_attempt.error_code ~ '^policy_' then 'skipped'
      when v_intent.attempts >= v_intent.max_attempts then 'failed'
      when v_attempt.id is not null and v_attempt.status = 'failed_permanent' then 'failed'
      else 'queued' end
    else 'queued' end;

  if v_new_status = v_d.status then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false);
  end if;
  if v_d.status = 'unknown' and v_new_status not in ('submitted', 'failed') then
    return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
                              'changed', false, 'note', 'unknown awaits reconciliation');
  end if;

  -- a SUCCEEDED intent is projected from its SUCCEEDED attempt specifically —
  -- never from whichever superseded row happens to sort adjacent
  if v_new_status = 'submitted' and (v_attempt.id is null or v_attempt.status <> 'succeeded') then
    select * into v_attempt from automation_execution_attempts a
     where a.tenant_id = p_tenant and a.automation_intent_id = v_intent.id
       and a.status = 'succeeded'
     order by a.completed_at desc nulls last, a.created_at desc, a.id desc limit 1;
  end if;

  if v_new_status = 'submitted' then
    v_msg_id := v_attempt.external_reference;
    v_thread_id := nullif(v_attempt.result ->> 'thread_id', '');
    v_submitted := coalesce(v_attempt.completed_at, now());
    if v_msg_id is null then
      return jsonb_build_object('delivery_id', v_d.id, 'status', v_d.status,
        'changed', false, 'note', 'succeeded attempt has no provider reference');
    end if;
    update marketing_deliveries set
      status = 'submitted',
      provider_message_id = coalesce(provider_message_id, v_msg_id),
      provider_thread_id = coalesce(provider_thread_id, v_thread_id),
      submitted_at = coalesce(submitted_at, v_submitted),
      execution_attempt_id = v_attempt.id,
      failure_class = null
    where id = v_d.id;

    -- canonical outbound source row — broadcast bodies are ALREADY fully
    -- composed (signature + unsubscribe footer rendered in); the Phase-4
    -- test composition stays byte-identical
    insert into email_messages
      (tenant_id, provider, provider_message_id, provider_thread_id,
       from_email, from_name, to_emails, subject, body_text, sent_at,
       direction, origin, origin_delivery_id, origin_automation_intent_id,
       origin_campaign_id, origin_person_id)
    values
      (p_tenant, 'gmail', v_msg_id, v_thread_id,
       coalesce(v_intent.parameters ->> 'mailbox_address', ''),
       v_d.from_name,
       jsonb_build_array(v_d.recipient_email),
       v_d.subject,
       case when v_d.purpose = 'broadcast' then v_d.body_text
            else v_d.body_text || case when v_d.signature_text is not null
                                       then e'\n\n--\n' || v_d.signature_text else '' end end,
       v_submitted,
       'outbound', 'marketing_delivery', v_d.id, v_intent.id,
       v_d.campaign_id, v_d.person_id)
    on conflict (tenant_id, provider, provider_message_id) do update
      set origin = coalesce(email_messages.origin, excluded.origin),
          origin_delivery_id = coalesce(email_messages.origin_delivery_id,
                                        excluded.origin_delivery_id),
          origin_automation_intent_id = coalesce(email_messages.origin_automation_intent_id,
                                                 excluded.origin_automation_intent_id),
          origin_campaign_id = coalesce(email_messages.origin_campaign_id,
                                        excluded.origin_campaign_id),
          origin_person_id = coalesce(email_messages.origin_person_id,
                                      excluded.origin_person_id);

    insert into platform_jobs
      (tenant_id, module_id, job_type, job_key, status, priority, max_attempts, payload)
    values
      (p_tenant, 'core.interactions', 'interactions.sync',
       'interactions.sync:' || p_tenant || ':all', 'queued', 100, 5, '{}'::jsonb)
    on conflict (tenant_id, job_key)
      where job_key is not null and status in ('queued', 'running', 'retrying')
      do nothing;
  elsif v_new_status in ('failed', 'unknown', 'skipped') then
    v_failure := left(coalesce(v_attempt.error_class, v_attempt.error_code,
                               case when v_intent.status = 'expired' then 'expired' end,
                               'unclassified'), 120);
    if v_new_status = 'skipped' then
      v_failure := left(v_attempt.error_code, 120);  -- the policy_* code, verbatim
    end if;
    update marketing_deliveries set
      status = v_new_status,
      failure_class = v_failure,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  elsif v_new_status = 'cancelled' then
    update marketing_deliveries set status = 'cancelled'
    where id = v_d.id;
  else
    update marketing_deliveries set
      status = v_new_status,
      execution_attempt_id = coalesce(v_attempt.id, execution_attempt_id)
    where id = v_d.id;
  end if;

  insert into marketing_delivery_events
    (tenant_id, delivery_id, automation_intent_id, from_status, to_status, detail,
     execution_attempt_id)
  values (p_tenant, v_d.id, v_d.automation_intent_id, v_d.status, v_new_status,
          left(coalesce(v_failure, 'reconciled from execution attempt'), 300),
          v_attempt.id);

  -- ── broadcast: keep the DISPATCH row factual + derive campaign completion ──
  if v_d.purpose = 'broadcast' and v_d.dispatch_id is not null then
    select * into v_disp from marketing_broadcast_dispatches
     where id = v_d.dispatch_id and tenant_id = p_tenant for update;
    if found and v_disp.status not in ('submitted', 'failed', 'skipped', 'cancelled') then
      if v_new_status = 'executing' and v_disp.status = 'queued' then
        update marketing_broadcast_dispatches set status = 'executing'
         where id = v_disp.id;
      elsif v_new_status in ('submitted', 'failed', 'unknown', 'skipped', 'cancelled')
            and v_disp.status in ('queued', 'executing', 'unknown') then
        update marketing_broadcast_dispatches set
          status = v_new_status,
          skip_reason = case when v_new_status = 'skipped' then v_failure else skip_reason end,
          failure_class = case when v_new_status = 'failed' then v_failure else failure_class end,
          finished_at = case when v_new_status in ('submitted', 'failed', 'skipped', 'cancelled')
                             then now() else finished_at end
        where id = v_disp.id;
      end if;
    end if;
    if v_new_status in ('submitted', 'failed', 'unknown') then
      perform marketing_event_append(p_tenant, 'marketing.message.' || v_new_status,
        'marketing_delivery', v_d.id, 'marketing-delivery-sync',
        jsonb_build_object('k', v_new_status || ':' || v_d.id,
                           'campaign', v_d.campaign_id, 'at', now()));
    end if;
    -- COMPLETION is derived from recipient facts; unknown results block it
    perform marketing_broadcast_check_completion(p_tenant, v_d.campaign_id);
  end if;

  return jsonb_build_object('delivery_id', v_d.id, 'status', v_new_status,
    'changed', true, 'provider_message_id', v_msg_id);
end $$;

-- ============================================================================
-- SCHEDULER — one added definition; every existing schedule is preserved.
-- Adding this row does NOT install cron anywhere: installation happens only
-- when an operator explicitly runs serviceos_schedule_all() on a deployed
-- environment with MARKETING_BROADCAST_SECRET configured.
-- ============================================================================
create or replace function serviceos_schedule_defs()
returns table (job text, fn text, secret text, sched text)
language sql immutable as $$
  select * from (values
    ('serviceos-worker',              'platform-worker',                         'WORKER_SECRET',                   '* * * * *'),
    ('serviceos-phone-sync',          'phone-scheduled-sync',                    'PHONE_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-phone-processing',    'phone-processing-scheduled-sync',         'PHONE_PROCESSING_SECRET',         '*/2 * * * *'),
    ('serviceos-email-sync',          'email-scheduled-sync',                    'EMAIL_SCHEDULE_SECRET',           '*/5 * * * *'),
    ('serviceos-email-workspace',     'email-workspace-scheduled-sync',          'EMAIL_WORKSPACE_SCHEDULE_SECRET', '*/5 * * * *'),
    ('serviceos-email-wksp-backfill', 'email-workspace-backfill-scheduled-sync', 'EMAIL_WORKSPACE_BACKFILL_SECRET', '*/15 * * * *'),
    ('serviceos-interactions',        'interactions-scheduled-sync',             'SIGNAL_SYNC_SECRET',              '*/5 * * * *'),
    ('serviceos-identity',            'identity-scheduled-sync',                 'IDENTITY_SYNC_SECRET',            '*/5 * * * *'),
    ('serviceos-business-graph',      'business-graph-scheduled-sync',           'GRAPH_SYNC_SECRET',               '*/5 * * * *'),
    ('serviceos-customer-cards',      'customer-card-scheduled-sync',            'CARD_SYNC_SECRET',                '*/5 * * * *'),
    ('serviceos-recommendations',     'recommendation-scheduled-sync',           'RECOMMENDATION_SYNC_SECRET',      '*/5 * * * *'),
    ('serviceos-intelligence-ingest', 'intelligence-ingestion-scheduled-sync',   'INTELLIGENCE_INGEST_SECRET',      '*/5 * * * *'),
    ('serviceos-marketing-broadcast', 'marketing-broadcast-scheduled-sync',      'MARKETING_BROADCAST_SECRET',      '* * * * *')
  ) as t(job, fn, secret, sched);
$$;

-- ============================================================================
-- Grants — every Phase-5 RPC is SERVICE-ROLE ONLY.
-- ============================================================================
do $$
declare sig text;
begin
  foreach sig in array array[
    'marketing_require_launch_actor(uuid, uuid)',
    'marketing_require_draft_actor(uuid, uuid)',
    'marketing_broadcast_resolve_endpoint(uuid, uuid)',
    'marketing_broadcast_authority_core(uuid, uuid, uuid, uuid, uuid, uuid, uuid, text)',
    'marketing_broadcast_send_authority(uuid, uuid)',
    'marketing_campaign_validate_content(text, text, text, jsonb)',
    'marketing_campaign_revision_hash(uuid, uuid, int, text, text, text, text[], jsonb)',
    'marketing_campaign_seed_event_chain(uuid, uuid, text)',
    'marketing_campaign_create(uuid, uuid, jsonb)',
    'marketing_campaign_revise(uuid, uuid, uuid, jsonb, int)',
    'marketing_campaign_duplicate(uuid, uuid, uuid)',
    'marketing_campaign_activate(uuid, uuid)',
    'marketing_campaign_transition(uuid, uuid, uuid, text, int, jsonb)',
    'marketing_campaign_preview_audience(uuid, uuid, uuid)',
    'marketing_campaign_preflight(uuid, uuid, uuid, int, text)',
    'marketing_campaign_launch(uuid, uuid, uuid, jsonb)',
    'marketing_broadcast_due(int)',
    'marketing_broadcast_check_completion(uuid, uuid)',
    'marketing_broadcast_in_quiet_hours(uuid)',
    'marketing_broadcast_claim_batch(uuid, text, int, int)',
    'marketing_broadcast_recipient_bundle(uuid, uuid, text)',
    'marketing_broadcast_create_lineage(uuid, uuid, text, jsonb)',
    'marketing_unsubscribe_apply(text)',
    'marketing_campaign_list(uuid, jsonb)',
    'marketing_campaign_detail(uuid, uuid)',
    'marketing_campaign_report(uuid, uuid)',
    'marketing_campaign_recipient_page(uuid, uuid, jsonb)',
    'marketing_broadcast_health(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', sig);
    execute format('grant execute on function %s to service_role;', sig);
  end loop;
end $$;
