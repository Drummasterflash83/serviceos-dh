-- Durable requests for the existing v2 email ingestion protocol. No provider
-- calls, source edits, credentials, switches or schedules are seeded.
begin;
create table public.learn_email_transition_requests (
 id uuid primary key,tenant_id uuid not null,email_account_id uuid not null,
 stream text not null check(stream in ('recent','historical')),attempt_id uuid not null,
 document jsonb not null check(jsonb_typeof(document)='object'),
 check(document @> jsonb_build_object('transitionId',id,'tenantId',tenant_id,'accountId',email_account_id,'stream',stream,'attemptId',attempt_id)),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
create index learn_email_transition_attempt on public.learn_email_transition_requests(tenant_id,email_account_id,stream,attempt_id,created_at,id);
create table public.learn_email_transition_settlements (
 request_id uuid primary key references public.learn_email_transition_requests(id) on delete restrict,
 result jsonb not null check(jsonb_typeof(result)='object'),
 check(result @> jsonb_build_object('contract_version',2,'transition_id',request_id)),
 check((result->>'disposition'=any(array['applied','replayed','conflict','denied'])) is true),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_email_transition_requests enable row level security;
alter table public.learn_email_transition_settlements enable row level security;
revoke all on public.learn_email_transition_requests,public.learn_email_transition_settlements from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_transition_requests,public.learn_email_transition_settlements to service_role;
create function public.learn_email_transition_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 raise exception 'learn_email_transition_immutable' using errcode='42501';end $$;
revoke all on function public.learn_email_transition_immutable() from public,anon,authenticated,service_role;
create trigger learn_email_request_immutable before update or delete on public.learn_email_transition_requests
 for each row execute function public.learn_email_transition_immutable();
create trigger learn_email_settlement_immutable before update or delete on public.learn_email_transition_settlements
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_transition_prepare(p_document jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;account uuid;attempt uuid;request uuid;stream text;prior public.learn_email_transition_requests%rowtype;run public.email_sync_runs%rowtype; k text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>65536
  or not p_document ?& array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload']
  or (p_document-array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload'])<>'{}'::jsonb then
  raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 foreach k in array array['tenantId','accountId','attemptId','transitionId'] loop
  if jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 foreach k in array array['expectedGeneration','expectedOwner'] loop
  if p_document->k<>'null'::jsonb and (jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 if p_document->'expectedRevision'<>'null'::jsonb then
  if jsonb_typeof(p_document->'expectedRevision') is distinct from 'string' or not coalesce(p_document->>'expectedRevision'~'^(0|[1-9][0-9]{0,18})$',false) then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
  if (p_document->>'expectedRevision')::numeric>9223372036854775807 then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end if;
 if (p_document->'expectedGeneration'='null'::jsonb) is distinct from (p_document->'expectedRevision'='null'::jsonb)
  or (p_document->'expectedGeneration'='null'::jsonb and p_document->'expectedOwner'<>'null'::jsonb)
  or jsonb_typeof(p_document->'payload') is distinct from 'object'
  or not coalesce(p_document->>'stream'=any(array['recent','historical']),false)
  or not coalesce(p_document->>'operation'=any(array['claim','initialize_traversal','checkpoint','release','block','finish_attempt','takeover','restart']),false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 tenant:=(p_document->>'tenantId')::uuid;account:=(p_document->>'accountId')::uuid;
 attempt:=(p_document->>'attemptId')::uuid;request:=(p_document->>'transitionId')::uuid;stream:=p_document->>'stream';
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||attempt::text,0));
 select * into prior from public.learn_email_transition_requests where id=request;
 if found then
  if prior.document<>p_document then raise exception 'learn_email_outbox_request_changed' using errcode='PT409';end if;
  return prior.document;
 end if;
 select * into run from public.email_sync_runs where tenant_id=tenant and id=attempt;
 if not found or run.provider<>'gmail' or run.status<>'running' or jsonb_typeof(run.metadata->'email_account_id') is distinct from 'string'
  or not coalesce(run.metadata->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if (run.metadata->>'email_account_id')::uuid<>account
  or (stream='recent' and run.sync_type not in ('messages','workspace_messages')) or (stream='historical' and run.sync_type<>'workspace_backfill') then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if exists(select 1 from public.learn_email_transition_requests r where r.attempt_id=attempt and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id)) then
  raise exception 'learn_email_outbox_pending_request' using errcode='PT409';end if;
 insert into public.learn_email_transition_requests(id,tenant_id,email_account_id,stream,attempt_id,document) values(request,tenant,account,stream,attempt,p_document);
 return p_document;
end $$;

create function public.learn_email_transition_pending(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select r.document into answer from public.learn_email_transition_requests r
 where r.tenant_id=p_tenant and r.email_account_id=p_account and r.stream=p_stream and r.attempt_id=p_attempt
 and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id) order by r.created_at,r.id limit 1;
 return answer;
end $$;

create function public.learn_email_transition_apply(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid,p_request uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare r public.learn_email_transition_requests%rowtype; prior jsonb;answer jsonb;d jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_request is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select * into r from public.learn_email_transition_requests where id=p_request and tenant_id=p_tenant and email_account_id=p_account and stream=p_stream and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_outbox_request_missing' using errcode='42501';end if;
 select result into prior from public.learn_email_transition_settlements where request_id=r.id;
 -- A refused request has a final decision. It cannot apply later simply because
 -- account eligibility or checkpoint state changes; a new reviewed request is needed.
 if found and prior->>'disposition' in ('conflict','denied') then return prior;end if;
 d:=r.document;
 answer:=public.email_ingestion_transition_v2(r.tenant_id,r.email_account_id,r.stream,r.attempt_id,r.id,
  d->>'operation',(d->>'expectedGeneration')::uuid,(d->>'expectedRevision')::bigint,(d->>'expectedOwner')::uuid,d->'payload');
 if prior is null then
  insert into public.learn_email_transition_settlements(request_id,result) values(r.id,answer);
 end if;
 -- Replaying the protocol reads today's checkpoint alongside its historical
 -- receipt. Never return a cached successful response as current ownership.
 return answer;
end $$;
revoke all on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) to service_role;
commit;
