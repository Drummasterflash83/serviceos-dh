-- Private voicemail intake. No routes, capture activation, user grants or source rows seeded.
begin;
create table public.receptionist_voicemail_email_routes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 mailbox_id uuid not null, email_account_id uuid not null references public.email_accounts(id),
 recipient_email text not null check(recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
 signing_domain text not null check(signing_domain ~ '^[a-z0-9.-]+$'),
 owner_user_id uuid references auth.users(id), access_mode text not null check(access_mode in ('owner','managers_only')),
 received_from timestamptz not null, received_until timestamptz,
 binding_evidence text not null check(length(btrim(binding_evidence)) between 1 and 1000),
 verified_by uuid not null references auth.users(id), verified_at timestamptz not null default clock_timestamp(),
 enabled boolean not null default false,
 unique(tenant_id,id), foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id),
 check((access_mode='owner')=(owner_user_id is not null)),
 check(received_until is null or received_until>received_from)
);
create table public.receptionist_voicemail_intakes (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 mailbox_id uuid not null, route_id uuid not null, provider_reference uuid not null,
 owner_user_id uuid references auth.users(id), candidate jsonb not null,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 audio_sha256 text not null check(audio_sha256 ~ '^[a-f0-9]{64}$'),
 audio_bytes integer not null check(audio_bytes between 1 and 26214400),
 state text not null default 'prepared' check(state in ('prepared','published')),
 created_at timestamptz not null default clock_timestamp(), published_at timestamptz,
 unique(tenant_id,id), unique(tenant_id,mailbox_id,provider_reference),
 foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id),
 check((state='published')=(published_at is not null))
);
create table public.receptionist_voicemail_sources (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, intake_id uuid not null,
 route_id uuid not null, email_account_id uuid not null references public.email_accounts(id),
 provider_email_id text not null check(provider_email_id ~ '^[a-f0-9]{1,64}$'),
 received_at timestamptz not null,
 raw_sha256 text not null check(raw_sha256 ~ '^[a-f0-9]{64}$'), raw_bytes integer not null check(raw_bytes between 1 and 1048576),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,email_account_id,provider_email_id), unique(tenant_id,id),
 foreign key(tenant_id,intake_id) references public.receptionist_voicemail_intakes(tenant_id,id),
 foreign key(tenant_id,route_id) references public.receptionist_voicemail_email_routes(tenant_id,id)
);
-- These records include private communication evidence. No owner/operator browser access.
alter table public.receptionist_voicemail_email_routes enable row level security;
alter table public.receptionist_voicemail_intakes enable row level security;
alter table public.receptionist_voicemail_sources enable row level security;
revoke all on public.receptionist_voicemail_email_routes,public.receptionist_voicemail_intakes,public.receptionist_voicemail_sources from public,anon,authenticated;
grant select,insert,update on public.receptionist_voicemail_email_routes,public.receptionist_voicemail_intakes,public.receptionist_voicemail_sources to service_role;

create function public.voicemail_intake_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception 'voicemail_evidence_immutable' using errcode='22023';end if;
 if tg_table_name='receptionist_voicemail_email_routes' and (to_jsonb(new)-'enabled')=(to_jsonb(old)-'enabled') then return new;end if;
 if tg_table_name='receptionist_voicemail_intakes' then
  if old.state='prepared' and new.state='published'
   and new.published_at is not null and (to_jsonb(new)-array['state','published_at'])=(to_jsonb(old)-array['state','published_at']) then return new;end if;
 end if;
 raise exception 'voicemail_evidence_immutable' using errcode='22023';
end $$;
create trigger voicemail_routes_immutable before update or delete on public.receptionist_voicemail_email_routes for each row execute function public.voicemail_intake_immutable();
create trigger voicemail_intakes_immutable before update or delete on public.receptionist_voicemail_intakes for each row execute function public.voicemail_intake_immutable();
create trigger voicemail_sources_immutable before update or delete on public.receptionist_voicemail_sources for each row execute function public.voicemail_intake_immutable();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('learn-voicemail-sources','learn-voicemail-sources',false,1048576,array['message/rfc822'])
on conflict(id) do nothing;
do $$begin if exists(select 1 from storage.buckets where id in ('learn-voicemail-sources','receptionist-voicemails') and public)
 then raise exception 'voicemail_bucket_not_private';end if;end $$;
create policy voicemail_source_no_direct_storage_access on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'learn-voicemail-sources') with check(bucket_id<>'learn-voicemail-sources');

-- Locks match the operator master/input switch transaction. Routes are explicitly
-- enabled only after provider-account, recipient and historical access verification.
create function public.voicemail_intake_route(p_tenant uuid,p_route uuid,p_received timestamptz)
returns public.receptionist_voicemail_email_routes language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.receptionist_voicemail_email_routes%rowtype;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'voicemail_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.receptionist_voicemail_email_routes where id=p_route and tenant_id=p_tenant for share;
 if not found or not r.enabled or p_received is null or p_received<r.received_from or (r.received_until is not null and p_received>=r.received_until)
  then raise exception 'voicemail_route_unverified' using errcode='22023';end if;
 if not public.learn_capture_allowed(p_tenant,'email') or not public.learn_capture_allowed(p_tenant,'phone') then
  raise exception 'voicemail_capture_paused' using errcode='55000';end if;
 if not exists(select 1 from public.email_accounts a where a.id=r.email_account_id and a.tenant_id=p_tenant
  and a.provider='gmail' and a.status='active_dwd' and lower(a.email_address)=lower(r.recipient_email)) then
  raise exception 'voicemail_email_binding_changed' using errcode='22023';end if;
 return r;
end $$;

-- The trusted server has already verified the original signature, recipient,
-- parser and decoded audio. JSON contains no caller-supplied owner or storage path.
create function public.voicemail_intake_prepare(p_tenant uuid,p_route uuid,p_source jsonb,p_candidate jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r public.receptionist_voicemail_email_routes%rowtype;i public.receptionist_voicemail_intakes%rowtype;
 s public.receptionist_voicemail_sources%rowtype;received timestamptz;reference uuid;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_candidate) is distinct from 'object'
  or octet_length(p_candidate::text)>100000 or octet_length(p_source::text)>4000
  or not p_source ?& array['email_id','received_at','raw_sha256','raw_bytes','content_sha256','audio_sha256','audio_bytes','signing_domain']
  or (p_source-array['email_id','received_at','raw_sha256','raw_bytes','content_sha256','audio_sha256','audio_bytes','signing_domain'])<>'{}'::jsonb
  or not p_candidate ?& array['version','system_reference','extension','caller_number','caller_name','duration_seconds','transcript']
  or (p_candidate-array['version','system_reference','extension','caller_number','caller_name','duration_seconds','transcript'])<>'{}'::jsonb
  or p_candidate->>'version' is distinct from 'birchills-voicemail-email/1'
  or p_candidate->>'extension'!~'^[0-9]{3}$'
  or p_source->>'email_id'!~'^[a-f0-9]{1,64}$'
  or coalesce(p_source->>'raw_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'audio_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'content_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(p_source->>'audio_bytes','')!~'^[0-9]+$' or coalesce(p_source->>'raw_bytes','')!~'^[0-9]+$'
  or coalesce(p_candidate->>'duration_seconds','')!~'^[0-9]+$'
  or (p_candidate->>'duration_seconds')::bigint not between 0 and 7200
  or jsonb_typeof(p_candidate->'transcript') not in ('string','null')
  or jsonb_typeof(p_candidate->'caller_number') not in ('string','null')
  or jsonb_typeof(p_candidate->'caller_name') not in ('string','null')
  or length(coalesce(p_candidate->>'caller_number',''))>30 or length(coalesce(p_candidate->>'caller_name',''))>200
  or length(coalesce(p_candidate->>'transcript',''))>50000 then
  raise exception 'voicemail_source_invalid' using errcode='22023';end if;
 received:=(p_source->>'received_at')::timestamptz; reference:=(p_candidate->>'system_reference')::uuid;
 if reference is null or not isfinite(received) then raise exception 'voicemail_source_invalid' using errcode='22023';end if;
 r:=public.voicemail_intake_route(p_tenant,p_route,received);
 if p_source->>'signing_domain' is distinct from r.signing_domain or not exists(select 1 from public.receptionist_mailboxes
  where tenant_id=p_tenant and id=r.mailbox_id and provider='birchills' and extension=p_candidate->>'extension') then
  raise exception 'voicemail_provider_binding_changed' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('voicemail-intake:'||p_tenant::text||':'||r.mailbox_id::text||':'||reference::text,0));
 select * into i from public.receptionist_voicemail_intakes where tenant_id=p_tenant and mailbox_id=r.mailbox_id and provider_reference=reference for update;
 if found then
  if i.candidate<>p_candidate or i.content_sha256<>p_source->>'content_sha256' or i.audio_sha256<>p_source->>'audio_sha256'
   or i.audio_bytes<>(p_source->>'audio_bytes')::integer or i.owner_user_id is distinct from r.owner_user_id then
   raise exception 'voicemail_duplicate_conflict' using errcode='PT409';end if;
 else
  insert into public.receptionist_voicemail_intakes(tenant_id,mailbox_id,route_id,provider_reference,owner_user_id,candidate,content_sha256,audio_sha256,audio_bytes)
  values(p_tenant,r.mailbox_id,r.id,reference,r.owner_user_id,p_candidate,p_source->>'content_sha256',p_source->>'audio_sha256',(p_source->>'audio_bytes')::integer) returning * into i;
 end if;
 insert into public.receptionist_voicemail_sources(tenant_id,intake_id,route_id,email_account_id,provider_email_id,received_at,raw_sha256,raw_bytes)
 values(p_tenant,i.id,r.id,r.email_account_id,p_source->>'email_id',received,p_source->>'raw_sha256',(p_source->>'raw_bytes')::integer)
 on conflict(tenant_id,email_account_id,provider_email_id) do nothing;
 select * into s from public.receptionist_voicemail_sources where tenant_id=p_tenant and email_account_id=r.email_account_id and provider_email_id=p_source->>'email_id';
 if s.intake_id<>i.id or s.route_id<>r.id or s.received_at<>received or s.raw_sha256<>p_source->>'raw_sha256' or s.raw_bytes<>(p_source->>'raw_bytes')::integer then
  raise exception 'voicemail_email_replay_conflict' using errcode='PT409';end if;
 return jsonb_build_object('intake_id',i.id,'source_id',s.id,'state',i.state,'audio_path',p_tenant::text||'/'||r.mailbox_id::text||'/'||i.id::text,
  'source_path',p_tenant::text||'/'||i.id::text||'/'||s.id::text||'.eml');
end $$;

-- Service must read back each uploaded object's actual bytes and verify both
-- digests before calling. Storage metadata alone does NOT establish integrity.
create function public.voicemail_intake_publish(p_tenant uuid,p_intake uuid,p_source uuid,p_raw_sha256 text,p_audio_sha256 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare i public.receptionist_voicemail_intakes%rowtype;s public.receptionist_voicemail_sources%rowtype;
 r public.receptionist_voicemail_email_routes%rowtype; audio_path text;source_path text;begin
 if current_user<>'service_role' then raise exception 'voicemail_intake_forbidden' using errcode='42501';end if;
 select * into i from public.receptionist_voicemail_intakes where id=p_intake and tenant_id=p_tenant for update;
 select * into s from public.receptionist_voicemail_sources where id=p_source and tenant_id=p_tenant and intake_id=p_intake;
 if i.id is null or s.id is null or p_raw_sha256 is distinct from s.raw_sha256 or p_audio_sha256 is distinct from i.audio_sha256 then
  raise exception 'voicemail_upload_unverified' using errcode='22023';end if;
 audio_path:=p_tenant::text||'/'||i.mailbox_id::text||'/'||i.id::text;
 source_path:=p_tenant::text||'/'||i.id::text||'/'||s.id::text||'.eml';
 if exists(select 1 from storage.buckets where id in ('learn-voicemail-sources','receptionist-voicemails') and public)
  or not exists(select 1 from storage.objects where bucket_id='receptionist-voicemails' and name=audio_path
   and metadata->>'size'=i.audio_bytes::text and metadata->>'mimetype'='audio/mpeg')
  or not exists(select 1 from storage.objects where bucket_id='learn-voicemail-sources' and name=source_path
   and metadata->>'size'=s.raw_bytes::text and metadata->>'mimetype'='message/rfc822') then
  raise exception 'voicemail_upload_incomplete' using errcode='55000';end if;
 if i.state='published' then
  if not exists(select 1 from public.receptionist_voicemails where id=i.id and tenant_id=p_tenant and mailbox_id=i.mailbox_id
   and owner_user_id is not distinct from i.owner_user_id and provider_message_id=i.provider_reference::text and recording_path=audio_path) then
   raise exception 'voicemail_publication_changed' using errcode='PT409';end if;
  return jsonb_build_object('state','published','message_id',i.id);
 end if;
 r:=public.voicemail_intake_route(p_tenant,s.route_id,s.received_at);
 if r.owner_user_id is distinct from i.owner_user_id or r.mailbox_id<>i.mailbox_id then raise exception 'voicemail_route_changed' using errcode='PT409';end if;
 insert into public.receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,owner_user_id,received_at,
  caller_number,caller_name,duration_seconds,transcript,recording_path)
 values(i.id,p_tenant,i.mailbox_id,i.provider_reference::text,i.owner_user_id,s.received_at,
  i.candidate->>'caller_number',i.candidate->>'caller_name',(i.candidate->>'duration_seconds')::integer,i.candidate->>'transcript',audio_path);
 update public.receptionist_voicemail_intakes set state='published',published_at=clock_timestamp() where id=i.id;
 return jsonb_build_object('state','published','message_id',i.id);
end $$;
revoke all on function public.voicemail_intake_immutable(),public.voicemail_intake_route(uuid,uuid,timestamptz),
 public.voicemail_intake_prepare(uuid,uuid,jsonb,jsonb),public.voicemail_intake_publish(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.voicemail_intake_route(uuid,uuid,timestamptz),public.voicemail_intake_prepare(uuid,uuid,jsonb,jsonb),
 public.voicemail_intake_publish(uuid,uuid,uuid,text,text) to service_role;
commit;
