-- Additive Microsoft source journal. No credentials, capture activation, queue
-- scheduling, projection writes or existing email modifications. Local until released.
begin;
create table public.learn_microsoft_mailbox_bindings (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 email_account_id uuid not null, microsoft_tenant_id uuid not null, mailbox_id uuid not null,
 enabled boolean not null default false, created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,email_account_id,id,mailbox_id),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict
);
create unique index learn_microsoft_one_enabled_binding on public.learn_microsoft_mailbox_bindings(tenant_id,email_account_id) where enabled;
create table public.learn_microsoft_capture_streams (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, email_account_id uuid not null,
 binding_id uuid not null, mailbox_id uuid not null, kind text not null check(kind in ('folders','messages')),
 folder_id text not null, revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 checkpoint jsonb not null check(jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=16777216),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 check((kind='folders' and folder_id='') or (kind='messages' and length(folder_id) between 1 and 2048 and folder_id~'^[A-Za-z0-9+/_=-]+$')),
 unique(tenant_id,email_account_id,binding_id,kind,folder_id), unique(tenant_id,id),
 foreign key(tenant_id,email_account_id,binding_id,mailbox_id) references public.learn_microsoft_mailbox_bindings(tenant_id,email_account_id,id,mailbox_id) on delete restrict
);
create table public.learn_microsoft_source_pages (
 id uuid primary key, tenant_id uuid not null, stream_id uuid not null, job_id uuid not null references public.platform_jobs(id) on delete restrict,
 revision bigint not null check(revision between 1 and 9007199254740991),
 before_checkpoint jsonb not null, source_page jsonb not null, after_checkpoint jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(stream_id,revision), foreign key(tenant_id,stream_id) references public.learn_microsoft_capture_streams(tenant_id,id) on delete restrict
);
alter table public.learn_microsoft_mailbox_bindings enable row level security;
alter table public.learn_microsoft_capture_streams enable row level security;
alter table public.learn_microsoft_source_pages enable row level security;
revoke all on public.learn_microsoft_mailbox_bindings,public.learn_microsoft_capture_streams,public.learn_microsoft_source_pages from public,anon,authenticated,service_role;

create function public.learn_microsoft_journal_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$begin raise exception 'learn_microsoft_retained_evidence_immutable' using errcode='42501';end $$;
create trigger learn_microsoft_pages_immutable before update or delete on public.learn_microsoft_source_pages for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_pages_no_truncate before truncate on public.learn_microsoft_source_pages for each statement execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_streams_no_delete before delete on public.learn_microsoft_capture_streams for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_streams_no_truncate before truncate on public.learn_microsoft_capture_streams for each statement execute function public.learn_microsoft_journal_immutable();
create function public.learn_microsoft_binding_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'learn_microsoft_binding_identity_immutable' using errcode='42501';end if;
 return new;
end $$;
create trigger learn_microsoft_binding_identity before update on public.learn_microsoft_mailbox_bindings for each row execute function public.learn_microsoft_binding_guard();
create trigger learn_microsoft_bindings_no_delete before delete on public.learn_microsoft_mailbox_bindings for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_bindings_no_truncate before truncate on public.learn_microsoft_mailbox_bindings for each statement execute function public.learn_microsoft_journal_immutable();

-- Internal shape check. Full Graph semantics remain the resource readers' job.
-- A journal receipt proves atomic storage, never provider authenticity or coverage.
create function public.learn_microsoft_checkpoint_valid(p jsonb,t uuid,a uuid,m uuid,k text,f text) returns boolean
language sql immutable set search_path=pg_catalog as $$ select coalesce(
 jsonb_typeof(p)='object' and octet_length(p::text)<=16777216
 and p->'scope'=jsonb_build_object('tenantId',t,'accountId',a,'mailboxId',m)||case when k='messages' then jsonb_build_object('folderId',f) else '{}'::jsonb end
 and jsonb_typeof(p->'pageSize')='number' and (p->>'pageSize')~'^[1-9][0-9]{0,2}$' and (p->>'pageSize')::integer between 1 and 100
 and case when k='folders' then
  p->>'contract'='microsoft-folder-discovery/1' and jsonb_typeof(p->'pending')='array'
  and jsonb_typeof(p->'completedParents')='array' and jsonb_typeof(p->'visitedRequests')='array' and jsonb_typeof(p->'folders')='array'
  and jsonb_array_length(p->'folders')<=10000 and jsonb_array_length(p->'visitedRequests')<=10000
 when k='messages' then p->>'contract'='microsoft-message-checkpoint/1'
  and (p->'continuation'='null'::jsonb or (jsonb_typeof(p->'continuation')='object'
   and p->'continuation'->>'kind' in ('next','delta') and jsonb_typeof(p->'continuation'->'url')='string'
   and length(p->'continuation'->>'url') between 1 and 32768)) else false end,false) $$;

-- Lock order: capture switch, queue job, account, binding, stream. Recheck the
-- queue lease after writes so an overlong transaction cannot settle stale work.
create function public.learn_microsoft_journal_guard(t uuid,a uuid,m uuid,b uuid,k text,f text,j uuid,w text,c integer) returns void
language plpgsql security definer set search_path=pg_catalog as $$declare q public.platform_jobs%rowtype;begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||t::text,0));
 if not public.learn_capture_allowed(t,'email') then raise exception 'learn_microsoft_capture_paused' using errcode='PT409';end if;
 select * into q from public.platform_jobs where tenant_id=t and id=j for update;
 if not found or q.status<>'running' or q.claimed_by is distinct from w or nullif(w,'') is null or c is null or c<1 or q.attempt_count is distinct from c
  or q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp() then raise exception 'learn_microsoft_lease_invalid' using errcode='PT409';end if;
 if q.connector_id is distinct from 'microsoft-365' or q.module_id is distinct from 'communications.email'
  or q.job_type is distinct from (case when k='folders' then 'email.microsoft_discovery' else 'email.microsoft_sync' end)
  or q.payload is distinct from jsonb_build_object('email_account_id',a,'mailbox_id',m,'binding_id',b,'kind',k,'folder_id',f)
 then raise exception 'learn_microsoft_job_identity_invalid' using errcode='PT409';end if;
 perform 1 from public.email_accounts where tenant_id=t and id=a and provider='microsoft_365' and status='active' and auth_state='ok' for share;
 if not found then raise exception 'learn_microsoft_account_ineligible' using errcode='PT409';end if;
 perform 1 from public.learn_microsoft_mailbox_bindings where tenant_id=t and email_account_id=a and id=b and mailbox_id=m and enabled for share;
 if not found then raise exception 'learn_microsoft_binding_ineligible' using errcode='PT409';end if;
end $$;

create function public.learn_microsoft_journal_open(p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,p_initial jsonb,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare s public.learn_microsoft_capture_streams%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_mailbox is null or p_binding is null or p_kind is null or p_folder is null
  or not public.learn_microsoft_checkpoint_valid(p_initial,p_tenant,p_account,p_mailbox,p_kind,p_folder)
  or (p_kind='messages' and p_initial->'continuation' is distinct from 'null'::jsonb)
  or (p_kind='folders' and (p_initial->'pending' is distinct from '[{"parentFolderId":null,"nextUrl":null}]'::jsonb
   or p_initial->'completedParents' is distinct from '[]'::jsonb or p_initial->'visitedRequests' is distinct from '[]'::jsonb or p_initial->'folders' is distinct from '[]'::jsonb))
 then raise exception 'learn_microsoft_initial_invalid' using errcode='22023';end if;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 insert into public.learn_microsoft_capture_streams(tenant_id,email_account_id,binding_id,mailbox_id,kind,folder_id,checkpoint)
 values(p_tenant,p_account,p_binding,p_mailbox,p_kind,p_folder,p_initial)
 on conflict(tenant_id,email_account_id,binding_id,kind,folder_id) do nothing;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and email_account_id=p_account and binding_id=p_binding and kind=p_kind and folder_id=p_folder for update;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-journal-stream/1','tenantId',s.tenant_id,'streamId',s.id,'revision',s.revision::text,'checkpoint',s.checkpoint);
end $$;

create function public.learn_microsoft_journal_commit(p_tenant uuid,p_stream uuid,p_request uuid,p_revision bigint,p_before jsonb,p_page jsonb,p_after jsonb,p_job uuid,p_worker text,p_claim integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare s public.learn_microsoft_capture_streams%rowtype;r public.learn_microsoft_source_pages%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_journal_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_stream is null or p_request is null or p_revision is null or p_revision<0 or p_revision>=9007199254740991
  or p_job is null or p_before is null or p_after is null or p_page is null then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 select * into s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p_stream;
 if not found then raise exception 'learn_microsoft_stream_unavailable' using errcode='PT409';end if;
 -- An exact stored receipt can be recovered after lease expiry/pause. This branch
 -- returns metadata only and cannot authorize further reads or advance progress.
 select * into r from public.learn_microsoft_source_pages where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.stream_id<>p_stream or r.job_id<>p_job or r.revision<>p_revision+1 or r.before_checkpoint is distinct from p_before
   or r.source_page is distinct from p_page or r.after_checkpoint is distinct from p_after then raise exception 'learn_microsoft_request_conflict' using errcode='PT409';end if;
  return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
 end if;
 perform public.learn_microsoft_journal_guard(s.tenant_id,s.email_account_id,s.mailbox_id,s.binding_id,s.kind,s.folder_id,p_job,p_worker,p_claim);
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p_stream for update;
 -- A competing exact submission may have committed while this request waited.
 select * into r from public.learn_microsoft_source_pages where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.stream_id<>p_stream or r.job_id<>p_job or r.revision<>p_revision+1 or r.before_checkpoint is distinct from p_before
   or r.source_page is distinct from p_page or r.after_checkpoint is distinct from p_after then raise exception 'learn_microsoft_request_conflict' using errcode='PT409';end if;
  return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
 end if;
 if s.revision<>p_revision or s.checkpoint is distinct from p_before then raise exception 'learn_microsoft_checkpoint_changed' using errcode='PT409';end if;
 if not public.learn_microsoft_checkpoint_valid(p_after,s.tenant_id,s.email_account_id,s.mailbox_id,s.kind,s.folder_id)
  or p_after->'pageSize' is distinct from p_before->'pageSize' or jsonb_typeof(p_page) is distinct from 'object' or octet_length(p_page::text)>33554432
  or p_page->'scope' is distinct from p_before->'scope' or p_page->>'persistence' is distinct from 'not_attempted'
  or jsonb_typeof(p_page->'requestUrl') is distinct from 'string' or length(p_page->>'requestUrl') not between 1 and 32768
  or jsonb_typeof(p_page->'fetchedAt') is distinct from 'string'
 then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 if s.kind='messages' then
  if p_page->>'contract' is distinct from 'microsoft-mail-page/1' or jsonb_typeof(p_page->'events') is distinct from 'array'
   or jsonb_array_length(p_page->'events')>1000 or p_after->'continuation' is distinct from p_page->'continuation'
   or (p_before->'continuation'<>'null'::jsonb and p_page->'requestUrl' is distinct from p_before->'continuation'->'url')
  then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 else
  if p_page->>'contract' is distinct from 'microsoft-folder-page/1' or jsonb_typeof(p_page->'folders') is distinct from 'array'
   or jsonb_array_length(p_page->'folders')>1000 or jsonb_array_length(p_before->'pending')=0
   or p_page->'parentFolderId' is distinct from p_before->'pending'->0->'parentFolderId'
   or (p_before->'pending'->0->'nextUrl'<>'null'::jsonb and p_page->'requestUrl' is distinct from p_before->'pending'->0->'nextUrl')
   or p_after->'visitedRequests' is distinct from (p_before->'visitedRequests'||jsonb_build_array(p_page->'requestUrl'))
  then raise exception 'learn_microsoft_page_invalid' using errcode='22023';end if;
 end if;
 insert into public.learn_microsoft_source_pages(id,tenant_id,stream_id,job_id,revision,before_checkpoint,source_page,after_checkpoint)
 values(p_request,p_tenant,p_stream,p_job,p_revision+1,p_before,p_page,p_after) returning * into r;
 update public.learn_microsoft_capture_streams set revision=r.revision,checkpoint=p_after,updated_at=r.recorded_at where id=s.id;
 perform public.learn_microsoft_journal_guard(s.tenant_id,s.email_account_id,s.mailbox_id,s.binding_id,s.kind,s.folder_id,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-journal-receipt/1','tenantId',p_tenant,'streamId',p_stream,'requestId',p_request,'revision',r.revision::text,'recordedAt',r.recorded_at);
end $$;
revoke all on function public.learn_microsoft_journal_immutable(),public.learn_microsoft_binding_guard(),public.learn_microsoft_checkpoint_valid(jsonb,uuid,uuid,uuid,text,text),public.learn_microsoft_journal_guard(uuid,uuid,uuid,uuid,text,text,uuid,text,integer),public.learn_microsoft_journal_open(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,integer),public.learn_microsoft_journal_commit(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_journal_open(uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,integer),public.learn_microsoft_journal_commit(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,uuid,text,integer) to service_role;
commit;
