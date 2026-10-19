-- First shared Commusoft in-flight lease slice. The source worker uses the
-- existing credential-fingerprint gate; manual queue guards remain unchanged.
-- Installation creates no request, changes no flag, and contacts no provider.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.learn_business_input_request_gates
 add column lease_owner_kind text,
 add column lease_owner_id text,
 add column lease_expires_at timestamptz,
 add column manual_waiter_id text,
 add column manual_waiter_expires_at timestamptz,
 add constraint commusoft_lease_owner_complete check (
  (lease_owner_kind is null and lease_owner_id is null and lease_expires_at is null) or
  (lease_owner_kind is not null and lease_owner_id is not null and lease_expires_at is not null)),
 add constraint commusoft_waiter_complete check (
  (manual_waiter_id is null and manual_waiter_expires_at is null) or
  (manual_waiter_id is not null and manual_waiter_expires_at is not null));
create unique index commusoft_lease_owner_unique on public.learn_business_input_request_gates
 (lease_owner_kind,lease_owner_id) where lease_owner_kind is not null;

-- A provider read can start only after this atomic reservation. A page GET has
-- a five-second send window and a maximum thirty-second HTTP timeout; forty
-- seconds covers both with margin. A stale completion cannot clear a new owner.
create function public.learn_commusoft_shared_lease_acquire(
 p_fingerprint text,p_kind text,p_owner text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare g public.learn_business_input_request_gates%rowtype;now_at timestamptz:=clock_timestamp();wait_until timestamptz;
begin
 if auth.role() is distinct from 'service_role' or p_fingerprint !~ '^[0-9a-f]{64}$'
  or p_kind not in ('source_page','job_detail','opportunity','verification')
  or length(p_owner) not between 1 and 100 or p_owner !~ '^[0-9a-f:-]+$' then
  raise exception 'commusoft_lease_invalid' using errcode='22023';end if;
 insert into public.learn_business_input_request_gates(credential_fingerprint,next_allowed_at)
  values(p_fingerprint,now_at) on conflict do nothing;
 select * into g from public.learn_business_input_request_gates
  where credential_fingerprint=p_fingerprint for update;
 now_at:=clock_timestamp();
 if g.lease_expires_at>now_at or g.next_allowed_at>now_at
  or (p_kind='source_page' and g.manual_waiter_expires_at>now_at)
  or (p_kind<>'source_page' and g.manual_waiter_expires_at>now_at
   and g.manual_waiter_id is distinct from p_owner) then
  if p_kind<>'source_page' and (g.manual_waiter_expires_at is null or g.manual_waiter_expires_at<=now_at) then
   update public.learn_business_input_request_gates
    set manual_waiter_id=p_owner,manual_waiter_expires_at=now_at+interval '60 seconds'
    where credential_fingerprint=p_fingerprint;
  end if;
  wait_until:=greatest(g.next_allowed_at,coalesce(g.lease_expires_at,now_at),
   case when g.manual_waiter_id is distinct from p_owner then coalesce(g.manual_waiter_expires_at,now_at) else now_at end);
  return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from wait_until)*1000)::bigint);
 end if;
 update public.learn_business_input_request_gates set
  next_allowed_at=now_at+interval '1250 milliseconds',
  lease_owner_kind=p_kind,lease_owner_id=p_owner,
  lease_expires_at=now_at+interval '40 seconds',
  manual_waiter_id=case when manual_waiter_id=p_owner or manual_waiter_expires_at<=now_at then null else manual_waiter_id end,
  manual_waiter_expires_at=case when manual_waiter_id=p_owner or manual_waiter_expires_at<=now_at then null else manual_waiter_expires_at end
 where credential_fingerprint=p_fingerprint;
 return jsonb_build_object('state','ready');
end $$;

create function public.learn_commusoft_shared_lease_release(p_kind text,p_owner text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_kind not in ('source_page','job_detail','opportunity','verification') or p_owner is null then
  raise exception 'commusoft_lease_invalid' using errcode='22023';end if;
 update public.learn_business_input_request_gates set lease_owner_kind=null,
  lease_owner_id=null,lease_expires_at=null
 where lease_owner_kind=p_kind and lease_owner_id=p_owner;
 return found;
end $$;
revoke all on function public.learn_commusoft_shared_lease_acquire(text,text,text),
 public.learn_commusoft_shared_lease_release(text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_shared_lease_acquire(text,text,text),
 public.learn_commusoft_shared_lease_release(text,text) to service_role;

-- Replace only the already reviewed source-page reservation block. Existing
-- authority, checkpoint, one-per-attempt permit and response shape stay intact.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 old:=$old$  insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
  select next_allowed_at into next_at from public.learn_business_input_request_gates
    where credential_fingerprint=fingerprint for update;
  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
  if next_at>clock_timestamp() then
    return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);
  end if;
  -- 48 reservations/minute leaves room below the documented 60/minute ceiling.
  update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
    where credential_fingerprint=fingerprint;$old$;
 replacement:=$new$  if j.lease_expires_at<=clock_timestamp() or (cfg->>'expiresAt')::timestamptz<=clock_timestamp() then return null; end if;
  lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'source_page',p_job_id::text||':'||p_attempt_count::text);
  if lease->>'state'='wait' then return lease;end if;
  if lease->>'state'<>'ready' then return null;end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1
  or (length(d)-length(replace(d,'secret text; fingerprint text; next_at timestamptz; permit_id uuid;','')))
    /length('secret text; fingerprint text; next_at timestamptz; permit_id uuid;')<>1 then
  raise exception 'commusoft_source_lease_contract_changed';end if;
 d:=replace(d,'secret text; fingerprint text; next_at timestamptz; permit_id uuid;',
  'secret text; fingerprint text; next_at timestamptz; permit_id uuid; lease jsonb;');
 execute replace(d,old,replacement);
end $patch$;

-- The page insert is part of the same transaction as its immutable retention.
-- A failed commit rolls the lease release back with it. A failed/settled worker
-- releases after the HTTP path has returned; an abandoned worker uses expiry.
create function public.learn_commusoft_source_lease_release()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_table_name='learn_business_input_pages' then
  perform public.learn_commusoft_shared_lease_release('source_page',
   new.job_id::text||':'||(select attempt_count::text from public.learn_business_input_request_permits where id=new.permit_id));
 elsif tg_table_name='platform_jobs' and old.job_type='commusoft.source_sync'
  and old.status='running' and new.status<>'running' then
  perform public.learn_commusoft_shared_lease_release('source_page',old.id::text||':'||old.attempt_count::text);
 end if;
 return new;
end $$;
create trigger commusoft_source_page_lease_release after insert on public.learn_business_input_pages
 for each row execute function public.learn_commusoft_source_lease_release();
create trigger commusoft_source_job_lease_release after update of status on public.platform_jobs
 for each row execute function public.learn_commusoft_source_lease_release();
revoke all on function public.learn_commusoft_source_lease_release() from public,anon,authenticated,service_role;
commit;
