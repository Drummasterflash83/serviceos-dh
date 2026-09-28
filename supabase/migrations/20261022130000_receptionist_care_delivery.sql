-- Durable, bounded work. This migration installs no scheduler and enables no tenant.
begin;
alter table public.receptionist_review_settings add column daily_review_limit integer not null default 100 check(daily_review_limit between 1 and 1000);
alter table public.receptionist_review_settings add column care_notifications_enabled boolean not null default false;
alter table public.receptionist_review_settings add column scan_lease_id uuid;
alter table public.receptionist_review_settings add column scan_lease_until timestamptz;
alter table public.receptionist_review_settings add column scan_available_at timestamptz not null default now();
alter table public.receptionist_review_settings add column scan_error text;
alter table public.receptionist_review_settings add column last_scan_count integer;
alter table public.receptionist_review_settings add column scan_attempted_at timestamptz;
alter table public.receptionist_review_settings add column scan_pending_windows jsonb;
alter table public.receptionist_review_settings add column scan_cutoff timestamptz;
alter table public.receptionist_review_settings add column scan_pending_count integer not null default 0 check(scan_pending_count>=0);

create function public.care_claim_scans(p_limit integer default 1,p_lease_seconds integer default 180)
returns table(tenant_id uuid,lease_id uuid,last_scan_at timestamptz,approved_rules text,version integer,scan_pending_windows jsonb,scan_cutoff timestamptz,scan_pending_count integer)
language plpgsql security definer set search_path='' as $$
declare s public.receptionist_review_settings;
begin
 if p_limit is null or p_lease_seconds is null or p_limit not between 1 and 20 or p_lease_seconds not between 30 and 600 then raise exception 'Invalid lease'; end if;
 for s in select * from public.receptionist_review_settings r where enabled and scan_available_at<=now()
 and (scan_lease_until is null or scan_lease_until<=now()) order by r.scan_available_at,r.tenant_id limit p_limit for update skip locked loop
  update public.receptionist_review_settings r set scan_lease_id=gen_random_uuid(),scan_lease_until=now()+make_interval(secs=>p_lease_seconds),
  scan_state='scanning',scan_attempted_at=now(),scan_error=null where r.tenant_id=s.tenant_id returning r.* into s;
  tenant_id:=s.tenant_id;lease_id:=s.scan_lease_id;last_scan_at:=s.last_scan_at;approved_rules:=s.approved_rules;version:=s.version;
  scan_pending_windows:=s.scan_pending_windows;scan_cutoff:=s.scan_cutoff;scan_pending_count:=s.scan_pending_count;return next;
 end loop;
end $$;
create function public.care_complete_scan(p_tenant uuid,p_lease uuid,p_cutoff timestamptz,p_count integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_cutoff is null or p_cutoff>now() or p_count is null or p_count<0 then raise exception 'Invalid scan receipt'; end if;
 update public.receptionist_review_settings set last_scan_at=p_cutoff,last_scan_count=p_count,scan_state='complete',scan_error=null,
 scan_lease_id=null,scan_lease_until=null,scan_available_at=now()+interval '1 minute',scan_pending_windows=null,scan_cutoff=null,scan_pending_count=0
 where tenant_id=p_tenant and scan_lease_id=p_lease and scan_lease_until>now() and (last_scan_at is null or last_scan_at<=p_cutoff)
 and (scan_cutoff is null or scan_cutoff=p_cutoff) and scan_pending_count<=p_count;
 get diagnostics n=row_count;return n=1;
end $$;
create function public.care_pause_scan(p_tenant uuid,p_lease uuid,p_cutoff timestamptz,p_windows jsonb,p_count integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare w jsonb; n integer;
begin
 if p_cutoff is null or p_cutoff>now() or p_count is null or p_count<0 or p_windows is null or jsonb_typeof(p_windows)<>'array'
 or jsonb_array_length(p_windows) not between 1 and 1000 or octet_length(p_windows::text)>200000 then raise exception 'Invalid scan continuation'; end if;
 for w in select value from jsonb_array_elements(p_windows) loop
  if jsonb_typeof(w)<>'object' or not (w ? 'from' and w ? 'to') or (w->>'from')::timestamptz is null or (w->>'to')::timestamptz is null
  or (w->>'from')::timestamptz>(w->>'to')::timestamptz or (w->>'to')::timestamptz>p_cutoff then raise exception 'Invalid continuation window'; end if;
 end loop;
 update public.receptionist_review_settings set scan_pending_windows=p_windows,scan_cutoff=p_cutoff,scan_pending_count=p_count,
 scan_state='backfilling',scan_error=null,scan_lease_id=null,scan_lease_until=null,scan_available_at=now()+interval '1 minute'
 where tenant_id=p_tenant and scan_lease_id=p_lease and scan_lease_until>now() and (last_scan_at is null or last_scan_at<=p_cutoff)
 and (scan_cutoff is null or scan_cutoff=p_cutoff) and scan_pending_count<=p_count;
 get diagnostics n=row_count;return n=1;
end $$;
create function public.care_fail_scan(p_tenant uuid,p_lease uuid,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_error is null or p_error !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'Invalid safe failure'; end if;
 update public.receptionist_review_settings set scan_state='failed',scan_error=p_error,scan_lease_id=null,scan_lease_until=null,scan_available_at=now()+interval '5 minutes'
 where tenant_id=p_tenant and scan_lease_id=p_lease and scan_lease_until>now();
 get diagnostics n=row_count;return n=1;
end $$;

create table public.receptionist_review_observations (
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 call_id uuid not null, observation_key text not null check(length(observation_key) between 1 and 240),
 source text not null check(source in ('provider','practice','feedback','mirror','manual','rules')),
 observed_at timestamptz not null, received_at timestamptz not null default now(),
 primary key(tenant_id,call_id,observation_key)
);
create table public.receptionist_review_queue (
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id), call_id uuid not null,
 state text not null default 'queued' check(state in ('queued','leased','retry','reviewed','dead_letter')),
 generation integer not null default 1, completed_generation integer not null default 0,
 leased_generation integer, lease_id uuid, lease_until timestamptz,settings_version integer,
 attempts integer not null default 0, available_at timestamptz not null default now(),
 latest_observed_at timestamptz not null, last_error text,
 reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(tenant_id,call_id),
 check((state='leased')=(lease_id is not null and lease_until is not null and leased_generation is not null)),
 check(completed_generation<=generation)
);
create index care_review_available on public.receptionist_review_queue(state,available_at,created_at);
create table public.receptionist_review_budgets (
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id), day date not null,
 reserved integer not null default 0 check(reserved>=0), primary key(tenant_id,day)
);
-- Records which evidence was covered, including attempts that never produced a review.
create table public.receptionist_review_attempts (
 id uuid primary key, tenant_id uuid not null, call_id uuid not null, generation integer not null,
 state text not null check(state in ('leased','reviewed','retry','dead_letter','lease_expired')),
 safe_error text, evidence_hash text, reviewer_version text,
 started_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(tenant_id,call_id) references public.receptionist_review_queue(tenant_id,call_id)
);

create function public.care_enqueue_review(p_tenant uuid,p_call uuid,p_observation_key text,p_observed_at timestamptz,p_source text default 'provider')
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_call is null or p_observation_key is null or length(p_observation_key) not between 1 and 240
 or p_observation_key !~ '^[A-Za-z0-9:_./-]+$' or p_observed_at is null or p_observed_at>clock_timestamp()+interval '5 minutes' then raise exception 'Invalid observation'; end if;
 insert into public.receptionist_review_observations(tenant_id,call_id,observation_key,observed_at,source)
 values(p_tenant,p_call,p_observation_key,p_observed_at,p_source) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return false; end if;
 insert into public.receptionist_review_queue(tenant_id,call_id,latest_observed_at) values(p_tenant,p_call,p_observed_at)
 on conflict(tenant_id,call_id) do update set generation=public.receptionist_review_queue.generation+1,
 latest_observed_at=greatest(public.receptionist_review_queue.latest_observed_at,excluded.latest_observed_at),
 state=case when public.receptionist_review_queue.state='leased' then 'leased' else 'queued' end,
 attempts=case when public.receptionist_review_queue.state='leased' then public.receptionist_review_queue.attempts else 0 end,
 available_at=now(),last_error=null,updated_at=now();
 return true;
end $$;

create function public.care_enqueue_reviews_batch(p_tenant uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare item jsonb; added integer:=0;
begin
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 or octet_length(p_items::text)>100000 then raise exception 'Invalid observation batch'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid batch observation'; end if;
  if public.care_enqueue_review(p_tenant,(item->>'call_id')::uuid,item->>'observation_key',(item->>'observed_at')::timestamptz,coalesce(item->>'source','provider')) then added:=added+1; end if;
 end loop;
 return added;
end $$;

create function public.care_claim_reviews(p_limit integer default 5,p_lease_seconds integer default 180)
returns setof public.receptionist_review_queue language plpgsql security definer set search_path='' as $$
declare r public.receptionist_review_queue; daily integer; used integer; d date:=(now() at time zone 'UTC')::date; claimed integer:=0;
begin
 if p_limit is null or p_lease_seconds is null or p_limit not between 1 and 20 or p_lease_seconds not between 30 and 600 then raise exception 'Invalid lease'; end if;
 -- A timeout is never evidence of a completed review. Expired attempts remain visible.
 for r in select * from public.receptionist_review_queue where state='leased' and lease_until<=now() for update skip locked loop
  update public.receptionist_review_attempts set state='lease_expired',safe_error='lease_expired',finished_at=now() where id=r.lease_id and state='leased';
  update public.receptionist_review_queue set state=case when attempts>=8 and generation=leased_generation then 'dead_letter' else 'retry' end,
  attempts=case when generation>leased_generation then 0 else attempts end,
  lease_id=null,lease_until=null,leased_generation=null,last_error='lease_expired',available_at=now(),updated_at=now()
  where tenant_id=r.tenant_id and call_id=r.call_id;
 end loop;
 for r in select q.* from public.receptionist_review_queue q join public.receptionist_review_settings s using(tenant_id)
 left join public.receptionist_review_budgets b on b.tenant_id=q.tenant_id and b.day=d
 join (select tenant_id,call_id,row_number() over(partition by tenant_id order by available_at,created_at,call_id) as tenant_rank
 from public.receptionist_review_queue where state in ('queued','retry') and available_at<=now()) fair on fair.tenant_id=q.tenant_id and fair.call_id=q.call_id
 where s.enabled and q.state in ('queued','retry') and q.available_at<=now() and coalesce(b.reserved,0)<s.daily_review_limit
 order by fair.tenant_rank,q.available_at,q.created_at,q.tenant_id,q.call_id loop
  -- Lock one candidate at a time. A FOR-query's cursor can prefetch and lock
  -- other tenants even if the caller requested only one lease.
  select q.* into r from public.receptionist_review_queue q where q.tenant_id=r.tenant_id and q.call_id=r.call_id
  and q.state in ('queued','retry') and q.available_at<=now() for update skip locked;
  if not found then continue; end if;
  -- Do not wait holding queue locks on another worker's tenant budget.
  if not pg_try_advisory_xact_lock(hashtextextended(r.tenant_id::text,22130000)) then continue; end if;
  select daily_review_limit into daily from public.receptionist_review_settings where tenant_id=r.tenant_id and enabled;
  if daily is null then continue; end if;
  insert into public.receptionist_review_budgets(tenant_id,day) values(r.tenant_id,d) on conflict do nothing;
  select reserved into used from public.receptionist_review_budgets where tenant_id=r.tenant_id and day=d for update;
  if used>=daily then continue; end if;
  update public.receptionist_review_budgets set reserved=reserved+1 where tenant_id=r.tenant_id and day=d;
  update public.receptionist_review_queue set state='leased',lease_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>p_lease_seconds),
  leased_generation=generation,settings_version=(select version from public.receptionist_review_settings where tenant_id=r.tenant_id),attempts=attempts+1,last_error=null,updated_at=now() where tenant_id=r.tenant_id and call_id=r.call_id returning * into r;
  insert into public.receptionist_review_attempts(id,tenant_id,call_id,generation,state) values(r.lease_id,r.tenant_id,r.call_id,r.leased_generation,'leased');
  return next r; claimed:=claimed+1; if claimed>=p_limit then exit; end if;
 end loop;
end $$;

create function public.care_complete_review(p_tenant uuid,p_call uuid,p_lease uuid,p_hash text,p_reviewer text,p_assessment jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.receptionist_review_queue;
begin
 select * into r from public.receptionist_review_queue where tenant_id=p_tenant and call_id=p_call for update;
 if not found or r.state<>'leased' or r.lease_id is distinct from p_lease or r.lease_until<=now() then return false; end if;
 if not exists(select 1 from public.receptionist_review_settings where tenant_id=p_tenant and enabled and version=r.settings_version) then
  perform public.care_fail_review(p_tenant,p_call,p_lease,'review_settings_changed',true,60);return false;
 end if;
 perform public.care_store_review(p_tenant,p_call,p_hash,p_reviewer,p_assessment);
 update public.receptionist_review_attempts set state='reviewed',finished_at=now(),evidence_hash=p_hash,reviewer_version=p_reviewer where id=p_lease;
 update public.receptionist_review_queue set completed_generation=r.leased_generation,
 state=case when generation>r.leased_generation then 'queued' else 'reviewed' end,
 lease_id=null,lease_until=null,leased_generation=null,attempts=0,last_error=null,reviewed_at=now(),updated_at=now(),available_at=now()
 where tenant_id=p_tenant and call_id=p_call;
 return true;
end $$;

create function public.care_fail_review(p_tenant uuid,p_call uuid,p_lease uuid,p_error text,p_retryable boolean default true,p_delay_seconds integer default 60)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.receptionist_review_queue; target text;
begin
 if p_error is null or p_error !~ '^[a-z][a-z0-9_]{0,79}$' or p_delay_seconds is null or p_delay_seconds not between 1 and 3600 or p_retryable is null then raise exception 'Invalid safe failure'; end if;
 select * into r from public.receptionist_review_queue where tenant_id=p_tenant and call_id=p_call for update;
 if not found or r.state<>'leased' or r.lease_id is distinct from p_lease or r.lease_until<=now() then return false; end if;
 target:=case when r.generation>r.leased_generation then 'queued' when not p_retryable or r.attempts>=8 then 'dead_letter' else 'retry' end;
 update public.receptionist_review_attempts set state=case when target='dead_letter' then 'dead_letter' else 'retry' end,safe_error=p_error,finished_at=now() where id=p_lease;
 update public.receptionist_review_queue set state=target,lease_id=null,lease_until=null,leased_generation=null,last_error=p_error,
 attempts=case when target='queued' then 0 else attempts end,
 available_at=case when p_error='review_credit_required' then (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')+interval '1 day'
 else now()+make_interval(secs=>least(3600,greatest(p_delay_seconds,30*power(2,least(r.attempts-1,7))::integer))) end,updated_at=now()
 where tenant_id=p_tenant and call_id=p_call;
 return true;
end $$;

create function public.care_rules_observed() returns trigger language plpgsql security definer set search_path='' as $$
declare q record;
begin
 if new.version is distinct from old.version and new.enabled then
  for q in select call_id from public.receptionist_review_queue where tenant_id=new.tenant_id order by call_id loop
   perform public.care_enqueue_review(new.tenant_id,q.call_id,'rules:'||new.version,now(),'rules');
  end loop;
 end if;return new;
end $$;
create trigger care_rules_queue after update of version on public.receptionist_review_settings for each row execute function public.care_rules_observed();

create function public.care_practice_observed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.call_id is not null then perform public.care_enqueue_review(new.tenant_id,new.call_id,'practice:'||new.id||':'||new.state||':'||new.call_id,now(),'practice'); end if;
 return new;
end $$;
create trigger care_practice_queue after insert or update of call_id,state on public.receptionist_practice_sessions for each row execute function public.care_practice_observed();
create function public.care_feedback_observed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.call_id is not null then perform public.care_enqueue_review(new.tenant_id,new.call_id,'feedback:'||new.id,now(),'feedback'); end if;
 return new;
end $$;
create trigger care_feedback_queue after insert on public.receptionist_feedback for each row execute function public.care_feedback_observed();
-- Not all phone mirrors are Vapi. Never treat Simwood IDs as Vapi call IDs.
create function public.care_phone_observed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if lower(new.provider)='vapi' and new.provider_call_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and exists(select 1 from public.receptionist_workspaces where tenant_id=new.tenant_id) then
 perform public.care_enqueue_review(new.tenant_id,new.provider_call_id::uuid,'mirror:'||new.id||':'||md5(coalesce(new.outcome,'')||coalesce(new.duration_seconds::text,'')),now(),'mirror');
 end if; return new;
end $$;
create trigger care_phone_queue after insert or update of outcome,duration_seconds on public.phone_calls for each row execute function public.care_phone_observed();

-- Existing practice calls can use temporary assistants and therefore are not in
-- the main assistant's provider listing. Their persisted binding is authoritative.
select public.care_enqueue_review(tenant_id,call_id,'practice:'||id||':'||state||':'||call_id,least(created_at,now()),'practice')
from public.receptionist_practice_sessions where call_id is not null;
select public.care_enqueue_review(tenant_id,call_id,'feedback:'||id,least(created_at,now()),'feedback')
from public.receptionist_feedback where call_id is not null;
select public.care_enqueue_review(c.tenant_id,c.provider_call_id::uuid,'mirror:'||c.id||':'||md5(coalesce(c.outcome,'')||coalesce(c.duration_seconds::text,'')),least(c.updated_at,now()),'mirror')
from public.phone_calls c join public.receptionist_workspaces w on w.tenant_id=c.tenant_id
where lower(c.provider)='vapi' and c.provider_call_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create table public.receptionist_alert_outbox (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, issue_id uuid not null,
 kind text not null check(kind in ('updates','attention','urgent')),
 reason text not null check(reason in ('event','unowned','overdue')),
 dedup_key text not null, issue_version integer not null,
 state text not null default 'queued' check(state in ('queued','sending','retry','sent','dead_letter','delivery_unknown','superseded')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_id uuid,lease_until timestamptz,team_id text,channel_id text,receipt_ts text,
 client_msg_id uuid not null default gen_random_uuid(),last_error text,
 sent_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id),
 unique(tenant_id,dedup_key), unique(client_msg_id),
 check((state='sending')=(lease_id is not null and lease_until is not null)),
 check(state<>'sent' or (receipt_ts is not null and channel_id is not null and sent_at is not null))
);
create index care_alert_available on public.receptionist_alert_outbox(state,available_at,created_at);
create function public.care_event_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues;
begin
 select * into strict i from public.receptionist_care_issues where tenant_id=new.tenant_id and id=new.issue_id;
 insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version)
 values(new.tenant_id,new.issue_id,case when new.action in ('received','automated_finding','reopen') then case when i.priority='urgent' then 'urgent' else 'attention' end else 'updates' end,
 'event','event:'||new.id,new.version) on conflict do nothing;
 return new;
end $$;
create trigger care_event_delivery after insert on public.receptionist_care_events for each row execute function public.care_event_alert();
-- One initial receipt per existing issue; old histories are not replayed as notifications.
insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version)
select tenant_id,id,case when priority='urgent' then 'urgent' else 'attention' end,'event','initial:'||id,version from public.receptionist_care_issues where stage<>'resolved';

create function public.care_schedule_escalations() returns integer language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues; reason text; bucket bigint; n integer; total integer:=0;
begin
 for i in select * from public.receptionist_care_issues where stage<>'resolved' and
 ((priority='urgent' and owner_id is null and created_at<=now()-interval '15 minutes') or (owner_id is not null and due_at<=now())) for update skip locked loop
  if (select count(*) from public.receptionist_alert_outbox o where o.issue_id=i.id and o.reason in ('unowned','overdue') and o.created_at>now()-interval '24 hours')>=24 then continue; end if;
  reason:=case when i.owner_id is null then 'unowned' else 'overdue' end;
  bucket:=floor(extract(epoch from now())/case when reason='unowned' then 900 else 3600 end);
  insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version)
  values(i.tenant_id,i.id,'urgent',reason,'escalate:'||i.id||':'||reason||':'||bucket,i.version) on conflict do nothing;
  get diagnostics n=row_count; total:=total+n;
 end loop;
 return total;
end $$;

create function public.care_claim_alerts(p_limit integer default 10,p_lease_seconds integer default 180)
returns setof public.receptionist_alert_outbox language plpgsql security definer set search_path='' as $$
declare r public.receptionist_alert_outbox; route public.module_alert_routes; count_claimed integer:=0;
begin
 if p_limit is null or p_lease_seconds is null or p_limit not between 1 and 50 or p_lease_seconds not between 30 and 600 then raise exception 'Invalid lease'; end if;
 -- A timed-out send may have reached Slack. Hold for receipt reconciliation, not blind retry.
 update public.receptionist_alert_outbox set state='delivery_unknown',lease_id=null,lease_until=null,last_error='delivery_receipt_unknown',updated_at=now() where state='sending' and lease_until<=now();
 update public.receptionist_alert_outbox o set state='superseded',updated_at=now()
 from public.receptionist_care_issues i where o.issue_id=i.id and o.state in ('queued','retry') and
 ((o.reason='unowned' and (i.owner_id is not null or i.stage='resolved')) or
 (o.reason='overdue' and (i.stage='resolved' or i.due_at is null or i.due_at>now())));
 for r in select o.* from public.receptionist_alert_outbox o join public.module_alert_routes a on a.tenant_id=o.tenant_id and a.module='receptionist' and a.kind=o.kind
 join public.receptionist_review_settings s on s.tenant_id=o.tenant_id
 where s.care_notifications_enabled and o.state in ('queued','retry') and o.available_at<=now() and a.enabled and a.verified_at is not null
 order by case when o.kind='urgent' then 0 when o.kind='attention' then 1 else 2 end,o.available_at,o.created_at,o.id loop
  select o.* into r from public.receptionist_alert_outbox o where o.id=r.id and o.state in ('queued','retry') and o.available_at<=now() for update skip locked;
  if not found then continue; end if;
  select * into route from public.module_alert_routes where tenant_id=r.tenant_id and module='receptionist' and kind=r.kind and enabled and verified_at is not null for share;
  if not found then continue; end if;
  update public.receptionist_alert_outbox set state='sending',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>p_lease_seconds),
  team_id=route.team_id,channel_id=route.channel_id,last_error=null,updated_at=now() where id=r.id returning * into r;
  return next r; count_claimed:=count_claimed+1; if count_claimed>=p_limit then exit; end if;
 end loop;
end $$;

create function public.care_ack_alert(p_id uuid,p_lease uuid,p_channel text,p_ts text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_ts is null or p_ts !~ '^[0-9]{10,}\.[0-9]{6}$' or p_channel is null then raise exception 'Slack receipt required'; end if;
 update public.receptionist_alert_outbox set state='sent',receipt_ts=p_ts,sent_at=now(),lease_id=null,lease_until=null,last_error=null,updated_at=now()
 where id=p_id and state='sending' and lease_id=p_lease and lease_until>now() and channel_id=p_channel;
 get diagnostics n=row_count; return n=1;
end $$;

create function public.care_fail_alert(p_id uuid,p_lease uuid,p_error text,p_uncertain boolean default false,p_delay_seconds integer default 60)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_error is null or p_error !~ '^[a-z][a-z0-9_]{0,79}$' or p_uncertain is null or p_delay_seconds is null or p_delay_seconds not between 1 and 3600 then raise exception 'Invalid safe failure'; end if;
 update public.receptionist_alert_outbox set state=case when p_uncertain then 'delivery_unknown' when attempts>=8 then 'dead_letter' else 'retry' end,
 lease_id=null,lease_until=null,last_error=p_error,available_at=now()+make_interval(secs=>least(3600,greatest(p_delay_seconds,30*power(2,least(attempts-1,7))::integer))),updated_at=now()
 where id=p_id and state='sending' and lease_id=p_lease and lease_until>now();
 get diagnostics n=row_count; return n=1;
end $$;

-- Unknown delivery can be resolved only by a server which checked Slack history
-- for this row's stable client_msg_id and leased destination. An explicit absence
-- after a completed history lookup is needed before retrying; lookup failure is not absence.
create function public.care_reconcile_alert(p_id uuid,p_channel text,p_ts text,p_checked_absent boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.receptionist_alert_outbox;
begin
 select * into r from public.receptionist_alert_outbox where id=p_id for update;
 if not found or r.state<>'delivery_unknown' or r.channel_id is distinct from p_channel then return false; end if;
 if p_ts is not null then
  if p_ts !~ '^[0-9]{10,}\.[0-9]{6}$' or p_checked_absent then raise exception 'Invalid reconciliation receipt'; end if;
  update public.receptionist_alert_outbox set state='sent',receipt_ts=p_ts,sent_at=now(),last_error=null,updated_at=now() where id=p_id;
 elsif p_checked_absent then
  update public.receptionist_alert_outbox set state=case when attempts>=8 then 'dead_letter' else 'retry' end,available_at=now()+interval '1 minute',last_error='receipt_checked_absent',updated_at=now() where id=p_id;
 else raise exception 'A verified receipt or completed absence check is required'; end if;
 return true;
end $$;

-- Operator overview distinguishes observed population, successful reviews, backlog,
-- disabled rules and delivery uncertainty. None of these counters implies audio QA.
create function public.care_delivery_health(p_tenant uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.current_user_is_openfolk_operator() then raise exception 'OpenFolk operator required' using errcode='42501'; end if;
 select jsonb_build_object('observedCalls',count(*),'reviewedCalls',count(*) filter(where state='reviewed' and completed_generation=generation),
 'pendingCalls',count(*) filter(where state in ('queued','leased','retry')),'failedCalls',count(*) filter(where state='dead_letter'),
 'oldestPendingAt',min(created_at) filter(where state in ('queued','leased','retry')),
 'reviewEnabled',coalesce((select enabled from public.receptionist_review_settings where tenant_id=p_tenant),false),
 'dailyLimit',(select daily_review_limit from public.receptionist_review_settings where tenant_id=p_tenant),
 'reservedToday',coalesce((select reserved from public.receptionist_review_budgets where tenant_id=p_tenant and day=(now() at time zone 'UTC')::date),0),
 'pendingAlerts',(select count(*) from public.receptionist_alert_outbox where tenant_id=p_tenant and state in ('queued','retry','sending')),
 'uncertainAlerts',(select count(*) from public.receptionist_alert_outbox where tenant_id=p_tenant and state='delivery_unknown'),
 'failedAlerts',(select count(*) from public.receptionist_alert_outbox where tenant_id=p_tenant and state='dead_letter'),
 'scope','locally_observed_calls_not_provider_population') into result from public.receptionist_review_queue where tenant_id=p_tenant;
 result:=result||jsonb_build_object('noEvidenceCalls',(select count(*) from public.receptionist_review_queue where tenant_id=p_tenant and last_error in ('awaiting_evidence','awaiting_transcript','awaiting_completed_call')),
 'lastScanAt',(select last_scan_at from public.receptionist_review_settings where tenant_id=p_tenant),
 'scanState',(select scan_state from public.receptionist_review_settings where tenant_id=p_tenant),
 'scanError',(select scan_error from public.receptionist_review_settings where tenant_id=p_tenant),
 'scanLeaseUntil',(select scan_lease_until from public.receptionist_review_settings where tenant_id=p_tenant),
 'lastScanCount',(select last_scan_count from public.receptionist_review_settings where tenant_id=p_tenant),
 'completedPracticeCalls',(select count(*) from public.receptionist_practice_sessions where tenant_id=p_tenant and state='ended'));
 return result;
end $$;

create function public.care_operating_summary(p_tenant uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.care_delivery_health(p_tenant); -- Reuse operator-only authorization.
 result:=jsonb_build_object(
 'monitoring',coalesce((select jsonb_build_object('enabled',enabled,'care_notifications_enabled',care_notifications_enabled,'last_scan_at',last_scan_at,'scan_state',scan_state,'scan_error',scan_error,'scan_lease_until',scan_lease_until,'last_scan_count',last_scan_count,'scan_pending_count',scan_pending_count,'scan_cutoff',scan_cutoff,'daily_limit',daily_review_limit) from public.receptionist_review_settings where tenant_id=p_tenant),'{"enabled":false,"scan_state":"not_started"}'::jsonb),
 'reviews',(select jsonb_build_object('observed',count(*),'reviewed',count(*) filter(where state='reviewed' and generation=completed_generation),
 'queued',count(*) filter(where state in ('queued','retry')),'processing',count(*) filter(where state='leased'),
 'failed',count(*) filter(where state='dead_letter'),'awaiting_evidence',count(*) filter(where last_error in ('awaiting_evidence','awaiting_transcript','awaiting_completed_call')),
 'oldest_pending_at',min(created_at) filter(where state in ('queued','retry','leased')),'scope','locally_observed_calls') from public.receptionist_review_queue where tenant_id=p_tenant),
 'alerts',(select jsonb_build_object('pending',count(*) filter(where state in ('queued','retry','sending')),
 'failed',count(*) filter(where state='dead_letter'),'delivery_unknown',count(*) filter(where state='delivery_unknown'),'sent',count(*) filter(where state='sent')) from public.receptionist_alert_outbox where tenant_id=p_tenant),
 'practice',(select jsonb_build_object('total',count(*),'completed',count(*) filter(where state='ended'),'with_feedback',count(*) filter(where exists(select 1 from public.receptionist_feedback f where f.tenant_id=s.tenant_id and f.practice_session_id=s.id))) from public.receptionist_practice_sessions s where s.tenant_id=p_tenant));
 return result;
end $$;

do $$declare t text; f regprocedure;begin
 foreach t in array array['receptionist_review_observations','receptionist_review_queue','receptionist_review_budgets','receptionist_review_attempts','receptionist_alert_outbox'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy care_delivery_operator on public.%I for select to authenticated using(public.current_user_is_openfolk_operator())',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('care_claim_scans','care_complete_scan','care_pause_scan','care_fail_scan','care_enqueue_review','care_enqueue_reviews_batch','care_claim_reviews','care_complete_review','care_fail_review','care_rules_observed','care_practice_observed','care_feedback_observed','care_phone_observed','care_event_alert','care_schedule_escalations','care_claim_alerts','care_ack_alert','care_fail_alert','care_reconcile_alert','care_delivery_health','care_operating_summary') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
grant execute on function public.care_delivery_health(uuid) to authenticated;
grant execute on function public.care_operating_summary(uuid) to authenticated;
commit;
