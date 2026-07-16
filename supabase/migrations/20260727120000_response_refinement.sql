-- ServiceOS — Human refinement before approval (response proposal + revisions).
--
-- Lets a reviewer inspect and MODIFY a proposed customer response before approving the
-- automation intent, WITHOUT touching the frozen Automation Engine and WITHOUT removing
-- any approval gate. The reviewed body is what executes; the original AI draft is kept
-- immutably; every human change is an attributable, append-only fact.
--
-- The audit trail this supports:
--   AI proposal (response_proposals, immutable)
--     → human changes (response_revisions, append-only)
--       → approved artifact (automation_approvals.evidence records which version)
--         → execution attempt (automation_execution_attempts — the frozen engine)
--
-- The reviewed body reaches execution through the intent's OWN parameters while it is
-- still `pending` (the Automation Engine already freezes an intent's business fields once
-- it leaves pending — HARDENING 1 in the automation-engine migration). Nothing here
-- changes that engine; it only records provenance and stages the reviewed version.
-- All additive + idempotent. Nothing is seeded for any tenant.

-- ── 1) The IMMUTABLE original AI proposal (one per automation intent) ─────────
create table if not exists response_proposals (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  automation_intent_id uuid not null references automation_intents(id) on delete cascade,
  action_object_id     uuid references intelligence_objects(id) on delete set null,
  decision_id          uuid,                                   -- soft ref to decision_log
  channel              text not null default 'email',
  source_interaction   text,
  draft_version        text,                                   -- e.g. response-draft/1
  proposal_version     text not null default 'response-proposal/1',
  original_body        text not null,                          -- the AI draft, frozen
  provenance           jsonb not null default '[]'::jsonb,     -- context that informed it
  generated_by         text not null default 'response-assistant',
  generated_at         timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (automation_intent_id)                                -- exactly one proposal / intent
);
create index if not exists response_proposals_intent on response_proposals (tenant_id, automation_intent_id);

-- Immutable: the original proposal is never edited or deleted (reuse the engine's guard).
drop trigger if exists response_proposals_no_update on response_proposals;
create trigger response_proposals_no_update before update on response_proposals
  for each row execute function automation_append_only();
drop trigger if exists response_proposals_no_delete on response_proposals;
create trigger response_proposals_no_delete before delete on response_proposals
  for each row execute function automation_append_only();

-- ── 2) Append-only human refinements (each edit is its own immutable fact) ────
create table if not exists response_revisions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  response_proposal_id uuid not null references response_proposals(id) on delete cascade,
  automation_intent_id uuid not null references automation_intents(id) on delete cascade,
  revision_number      int  not null,
  revised_body         text not null,
  editor_ref           text not null,                          -- who made the change
  editor_kind          text not null default 'tenant_operator',
  change_reason        text,
  based_on             text not null default 'ai_proposal'
                         check (based_on in ('ai_proposal','revision')),
  based_on_ref         uuid,                                   -- prior revision, when chained
  created_at           timestamptz not null default now(),
  unique (automation_intent_id, revision_number)
);
create index if not exists response_revisions_intent
  on response_revisions (tenant_id, automation_intent_id, revision_number);

drop trigger if exists response_revisions_no_update on response_revisions;
create trigger response_revisions_no_update before update on response_revisions
  for each row execute function automation_append_only();
drop trigger if exists response_revisions_no_delete on response_revisions;
create trigger response_revisions_no_delete before delete on response_revisions
  for each row execute function automation_append_only();

-- ── 3) The IMMUTABLE approved artifact snapshot (exactly one per intent) ──────
-- The "approved final artifact" node of the lineage chain. It records the EXACT body a
-- human approved (the original AI draft or a specific revision) plus its provenance —
-- decoupled from the mutable intent parameters AND from the frozen engine's
-- automation_approvals execution gate. Its existence is the authoritative LOCK: it
-- rejects any later revision and any duplicate approval (an approved intent stays
-- `pending` until the engine claims it, so status alone cannot lock it). One per intent.
create table if not exists response_approval_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  automation_intent_id uuid not null references automation_intents(id) on delete cascade,
  response_proposal_id uuid not null references response_proposals(id) on delete cascade,
  approved_revision_id uuid references response_revisions(id) on delete set null,
  source               text not null check (source in ('ai_proposal','revision')),
  approved_body        text not null,                          -- the exact body approved
  provenance           jsonb not null default '[]'::jsonb,     -- original + human marker
  draft_version        text,
  approver_ref         text not null,
  approver_kind        text not null,
  approved_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (automation_intent_id)                                -- exactly one approval / intent
);
create index if not exists response_approval_snapshots_intent
  on response_approval_snapshots (tenant_id, automation_intent_id);

drop trigger if exists response_approval_snapshots_no_update on response_approval_snapshots;
create trigger response_approval_snapshots_no_update before update on response_approval_snapshots
  for each row execute function automation_append_only();
drop trigger if exists response_approval_snapshots_no_delete on response_approval_snapshots;
create trigger response_approval_snapshots_no_delete before delete on response_approval_snapshots
  for each row execute function automation_append_only();

-- ── 4) RLS: tenant-scoped read + OpenFolk provider read (writes are service-role) ─
do $$
declare t text;
begin
  foreach t in array array['response_proposals','response_revisions','response_approval_snapshots']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_select', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id = current_tenant_id() or is_openfolk())', t||'_select', t);
  end loop;
end $$;

-- ── 5) The full audit trail, in one queryable place (read-only) ───────────────
-- AI proposal → human changes → approved snapshot → engine approval → execution attempt.
-- security_invoker so the caller's RLS applies (underlying tables are already tenant-scoped).
create or replace view response_refinement_trail
with (security_invoker = true) as
select
  p.tenant_id,
  p.automation_intent_id,
  p.id                 as proposal_id,
  p.channel,
  p.source_interaction,
  p.original_body,
  p.provenance,
  p.proposal_version,
  p.draft_version,
  p.generated_by,
  p.generated_at,
  coalesce(r.revisions, '[]'::jsonb)  as revisions,
  snap.approval_snapshot,
  coalesce(a.approvals, '[]'::jsonb)  as approvals,
  att.latest_attempt
from response_proposals p
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'id', rr.id,
           'revision_number', rr.revision_number,
           'revised_body', rr.revised_body,
           'editor_ref', rr.editor_ref,
           'editor_kind', rr.editor_kind,
           'change_reason', rr.change_reason,
           'created_at', rr.created_at
         ) order by rr.revision_number) as revisions
  from response_revisions rr
  where rr.automation_intent_id = p.automation_intent_id
) r on true
left join lateral (
  select jsonb_build_object(
           'id', s.id,
           'source', s.source,
           'approved_revision_id', s.approved_revision_id,
           'approved_body', s.approved_body,
           'provenance', s.provenance,
           'approver_ref', s.approver_ref,
           'approver_kind', s.approver_kind,
           'approved_at', s.approved_at
         ) as approval_snapshot
  from response_approval_snapshots s
  where s.automation_intent_id = p.automation_intent_id
) snap on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
           'id', aa.id,
           'decision', aa.decision,
           'approver_kind', aa.approver_kind,
           'approver_ref', aa.approver_ref,
           'granted_at', aa.granted_at,
           'evidence', aa.evidence
         ) order by aa.granted_at) as approvals
  from automation_approvals aa
  where aa.automation_intent_id = p.automation_intent_id
) a on true
left join lateral (
  select jsonb_build_object(
           'id', ea.id,
           'status', ea.status,
           'result', ea.result,
           'external_reference', ea.external_reference,
           'completed_at', ea.completed_at
         ) as latest_attempt
  from automation_execution_attempts ea
  where ea.automation_intent_id = p.automation_intent_id
  order by ea.started_at desc
  limit 1
) att on true;
