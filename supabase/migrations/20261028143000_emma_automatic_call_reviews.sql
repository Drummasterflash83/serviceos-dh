-- Continuous evidence review. Activation is an explicit, separately audited
-- operator decision; this migration neither enables a client nor schedules cron.
begin;
alter table public.receptionist_review_settings
 add column if not exists capture_started_at timestamptz,
 add column if not exists scan_window_start timestamptz,
 add column if not exists scan_window_end timestamptz,
 add column if not exists scan_before timestamptz,
 add column if not exists scan_lease uuid,
 add column if not exists scan_lease_until timestamptz;

create table public.receptionist_auto_review_queue (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 call_id uuid not null,
 reviewer_version text not null check(length(reviewer_version) between 1 and 200),
 call_kind text not null check(call_kind in ('live','practice')),
 practice_session_id uuid references public.receptionist_practice_sessions(id),
 call_created_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','running','awaiting_evidence','reviewed','needs_review')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_id uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 safe_error text,
 evidence_hash text,
 rules_version integer,
 model text,
 slack_state text not null default 'not_required' check(slack_state in ('not_required','pending','sending','sent','needs_review')),
 slack_receipt jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,call_id,reviewer_version),
 check((call_kind='practice')=(practice_session_id is not null))
);
create index receptionist_auto_review_pending on public.receptionist_auto_review_queue(state,next_attempt_at,call_created_at);
create table public.receptionist_auto_review_attempts (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 queue_id uuid not null references public.receptionist_auto_review_queue(id),
 lease_id uuid not null,
 created_at timestamptz not null default now(),
 unique(queue_id,lease_id)
);
create index receptionist_auto_review_daily on public.receptionist_auto_review_attempts(tenant_id,created_at);
alter table public.receptionist_auto_review_queue enable row level security;
alter table public.receptionist_auto_review_attempts enable row level security;
revoke all on public.receptionist_auto_review_queue,public.receptionist_auto_review_attempts from public,anon,authenticated;
grant all on public.receptionist_auto_review_queue,public.receptionist_auto_review_attempts to service_role;

-- A single scanner owns a frozen, paginated time window. A full page never
-- advances the completed cursor. A 24-hour overlap reconciles delayed listings.
create function public.care_auto_scan_claim(p_tenant uuid)
returns setof public.receptionist_review_settings language plpgsql security definer set search_path='' as $$
begin
 return query update public.receptionist_review_settings s set
  capture_started_at=coalesce(s.capture_started_at,now()-interval '24 hours'),
  scan_window_start=coalesce(s.scan_window_start,greatest(coalesce(s.capture_started_at,now()-interval '24 hours'),coalesce(s.last_scan_at,now())-interval '24 hours')),
  scan_window_end=coalesce(s.scan_window_end,now()),
  scan_lease=gen_random_uuid(),scan_lease_until=now()+interval '3 minutes',scan_state='scanning'
 where s.tenant_id=p_tenant and s.enabled and (s.scan_lease_until is null or s.scan_lease_until<now()) returning s.*;
end $$;

-- Claim without spending: calls whose transcript is still arriving wait safely.
create function public.care_auto_review_claim()
returns setof public.receptionist_auto_review_queue language plpgsql security definer set search_path='' as $$
declare chosen uuid;
begin
 update public.receptionist_auto_review_queue q set state='needs_review',safe_error='Review retry limit reached',lease_id=null,lease_until=null,updated_at=now()
 where q.state='running' and q.lease_until<now() and q.attempts>=3;
 select q.id into chosen from public.receptionist_auto_review_queue q
 join public.receptionist_review_settings s on s.tenant_id=q.tenant_id and s.enabled
 where (q.state in ('pending','awaiting_evidence') or (q.state='running' and q.lease_until<now()))
 and q.next_attempt_at<=now() and q.attempts<3
 order by q.call_created_at,q.id for update of q skip locked limit 1;
 if chosen is null then return; end if;
 return query update public.receptionist_auto_review_queue q set state='running',lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes',updated_at=now() where q.id=chosen returning q.*;
end $$;

-- The per-tenant lock prevents parallel invocations exceeding 100 paid review
-- attempts in a rolling 24 hours. A replay of the same lease is never charged twice.
create function public.care_auto_review_reserve_ai(p_id uuid,p_lease uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.receptionist_auto_review_queue;
begin
 select * into r from public.receptionist_auto_review_queue where id=p_id for update;
 if not found or r.state<>'running' or r.lease_id is distinct from p_lease or r.lease_until<=now() or r.attempts>=3 then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('emma-auto-review:'||r.tenant_id::text,0));
 if not exists(select 1 from public.receptionist_review_settings where tenant_id=r.tenant_id and enabled) then return false; end if;
 if exists(select 1 from public.receptionist_auto_review_attempts where queue_id=p_id and lease_id=p_lease) then return false; end if;
 if (select count(*) from public.receptionist_auto_review_attempts where tenant_id=r.tenant_id and created_at>now()-interval '24 hours')>=100 then return false; end if;
 insert into public.receptionist_auto_review_attempts(tenant_id,queue_id,lease_id) values(r.tenant_id,p_id,p_lease);
 update public.receptionist_auto_review_queue set attempts=attempts+1,updated_at=now() where id=p_id;
 return true;
end $$;
create function public.care_auto_enqueue_practice(p_tenant uuid,p_from timestamptz,p_until timestamptz,p_reviewer text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_from is null or p_until is null or p_until<p_from or p_until>now() or p_reviewer is null or length(p_reviewer)>200 then raise exception 'Invalid practice scan window'; end if;
 if not exists(select 1 from public.receptionist_review_settings where tenant_id=p_tenant and enabled and p_from=scan_window_start and p_until=scan_window_end) then raise exception 'Practice scan is not the reserved workspace window'; end if;
 insert into public.receptionist_auto_review_queue(tenant_id,call_id,reviewer_version,call_kind,practice_session_id,call_created_at)
 select s.tenant_id,s.call_id,p_reviewer,'practice',s.id,s.created_at
 from public.receptionist_practice_sessions s where s.tenant_id=p_tenant and s.call_id is not null and s.created_at>=p_from and s.created_at<p_until
 on conflict(tenant_id,call_id,reviewer_version) do nothing;
end $$;
revoke all on function public.care_auto_scan_claim(uuid),public.care_auto_review_claim(),public.care_auto_review_reserve_ai(uuid,uuid),public.care_auto_enqueue_practice(uuid,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.care_auto_scan_claim(uuid),public.care_auto_review_claim(),public.care_auto_review_reserve_ai(uuid,uuid),public.care_auto_enqueue_practice(uuid,timestamptz,timestamptz,text) to service_role;
commit;
