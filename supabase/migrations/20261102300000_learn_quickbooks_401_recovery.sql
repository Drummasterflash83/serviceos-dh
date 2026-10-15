-- A provider 401 can arrive before the stated OAuth expiry. Permit exactly one
-- refresh and new read reservation at the same checkpoint; a second 401 remains
-- a hard stop. Existing observations, source versions and approvals are kept.
begin;

create or replace function public.learn_quickbooks_import_fail(p_run uuid,p_permit uuid,p_code text,p_retry_seconds integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_imports%rowtype;prior jsonb;retry boolean;next_state text;refresh_once boolean;begin
 if auth.role() is distinct from 'service_role' then raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 select * into r from public.learn_quickbooks_imports where id=p_run for update;
 select checkpoint_after into prior from public.learn_quickbooks_pages where run_id=p_run and permit_id=p_permit;
 if found then return prior;end if;
 if r.id is null or r.lease_id is distinct from p_permit or p_permit is null or r.state<>'running' then return jsonb_build_object('state','unconfirmed');end if;
 if p_code is null or p_code not in ('authentication_required','access_denied','rate_limited','provider_unavailable','provider_rejected','invalid_response','response_too_large','transport_unavailable','authority_unavailable','reservation_unavailable','persistence_unconfirmed')
  or p_retry_seconds is null or p_retry_seconds not between 0 and 31536000 then raise exception 'quickbooks_failure_invalid' using errcode='22023';end if;
 -- Import acquisition never issues a read with a locally expired token. A first
 -- 401 therefore gets one refresh. A repeated 401 at this checkpoint, or any
 -- uncertain refresh lease, is held for human review instead.
 refresh_once:=p_code='authentication_required' and r.attempts_at_position=1
  and r.requests_used<r.max_requests and r.expires_at>clock_timestamp()
  and exists(select 1 from public.learn_quickbooks_connections c where c.id=r.connection_id
   and c.tenant_id=r.tenant_id and c.revision=r.connection_revision and c.status='active'
   and c.refresh_lease is null and c.token_secret_id is not null
   and c.refresh_expires_at>clock_timestamp() and c.refresh_hard_expires_at>clock_timestamp());
 retry:=(p_code in ('rate_limited','provider_unavailable','transport_unavailable','persistence_unconfirmed') and r.attempts_at_position<5
  or refresh_once) and r.requests_used<r.max_requests and r.expires_at>clock_timestamp();
 next_state:=case when retry then 'queued' when r.requests_used>=r.max_requests then 'limit_reached' else 'failed' end;
 update public.learn_quickbooks_imports set state=next_state,lease_id=null,lease_until=null,last_error=p_code,
  next_at=clock_timestamp()+make_interval(secs=>case when refresh_once then 2 else greatest(p_retry_seconds,60) end),
  updated_at=clock_timestamp() where id=r.id;
 if p_code='rate_limited' then
  update public.learn_quickbooks_request_gates set next_at=greatest(next_at,clock_timestamp()+make_interval(secs=>greatest(p_retry_seconds,60))) where environment=r.environment and realm_id=r.realm_id;
 end if;
 if refresh_once then
  update public.learn_quickbooks_connections set access_expires_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=r.connection_id and revision=r.connection_revision;
 elsif not retry then
  update public.learn_quickbooks_connections set status=case when p_code='authentication_required' then 'authentication_required' else 'paused' end,updated_at=clock_timestamp()
   where id=r.connection_id and revision=r.connection_revision;
 end if;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(r.tenant_id,r.connection_id,r.actor_id,'import_attention',jsonb_build_object('runId',r.id,'code',p_code,'state',next_state,'refreshOnce',refresh_once));
 return jsonb_build_object('runId',r.id,'state',next_state);
end $$;

-- Operations recovery for an already-held 401 from the earlier worker. The
-- failed run and its pages remain intact; no request or token exchange occurs
-- in this function. The next worker tick uses the existing refresh lease path.
create function public.learn_quickbooks_resume_first_401(
 p_tenant uuid,p_connection uuid,p_run uuid,p_revision bigint,p_generation bigint,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.learn_quickbooks_connections%rowtype;r public.learn_quickbooks_imports%rowtype;s public.learn_quickbooks_recurring%rowtype;begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'quickbooks_forbidden' using errcode='42501';end if;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 500 then
  raise exception 'quickbooks_recovery_invalid' using errcode='22023';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'quickbooks_recovery_unavailable' using errcode='PT409';end if;
 select * into c from public.learn_quickbooks_connections where id=p_connection and tenant_id=p_tenant for update;
 select * into r from public.learn_quickbooks_imports where id=p_run and connection_id=p_connection and tenant_id=p_tenant for update;
 select * into s from public.learn_quickbooks_recurring where connection_id=p_connection and tenant_id=p_tenant for update;
 if c.id is null or r.id is null or s.connection_id is null or not s.enabled or s.current_run<>r.id
  or c.revision is distinct from p_revision or c.token_generation is distinct from p_generation
  or c.status<>'authentication_required' or c.refresh_lease is not null or c.token_secret_id is null
  or c.refresh_expires_at is null or c.refresh_expires_at<=clock_timestamp()
  or c.refresh_hard_expires_at is null or c.refresh_hard_expires_at<=clock_timestamp()
  or r.state<>'failed' or r.last_error<>'authentication_required' or r.connection_revision<>c.revision
  or r.attempts_at_position<>1 or r.requests_used<>r.pages_saved+1
  or r.requests_used>=r.max_requests or r.expires_at<=clock_timestamp()
  or exists(select 1 from public.learn_quickbooks_pages p where p.run_id=r.id and p.permit_id=r.lease_id) then
  raise exception 'quickbooks_recovery_unavailable' using errcode='PT409';end if;
 update public.learn_quickbooks_connections set status='active',access_expires_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 update public.learn_quickbooks_imports set state='queued',last_error='authentication_required',next_at=clock_timestamp()+interval '2 seconds',updated_at=clock_timestamp() where id=r.id;
 insert into public.learn_quickbooks_events(tenant_id,connection_id,actor_id,event,detail)
  values(p_tenant,c.id,r.actor_id,'first_401_recovery',jsonb_build_object('runId',r.id,'generation',c.token_generation,'reason',btrim(p_reason)));
 return jsonb_build_object('runId',r.id,'state','queued','generation',c.token_generation,'refreshRequired',true);
end $$;

revoke all on function public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text) to service_role;
commit;
