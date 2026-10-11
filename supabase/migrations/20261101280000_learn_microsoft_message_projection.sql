-- Publish complete retained Microsoft observations into the common email store.
-- Does not acquire credentials, activate capture, discard source pages or infer
-- deletion from a folder removal. Sparse/ambiguous observations remain held.
begin;
create table public.learn_microsoft_projection_receipts (
 page_id uuid primary key references public.learn_microsoft_source_pages(id) on delete restrict,
 tenant_id uuid not null, result jsonb not null, recorded_at timestamptz not null default clock_timestamp()
);
alter table public.learn_microsoft_projection_receipts enable row level security;
revoke all on public.learn_microsoft_projection_receipts from public,anon,authenticated,service_role;
create trigger learn_microsoft_projection_immutable before update or delete on public.learn_microsoft_projection_receipts
 for each row execute function public.learn_microsoft_journal_immutable();
create trigger learn_microsoft_projection_no_truncate before truncate on public.learn_microsoft_projection_receipts
 for each statement execute function public.learn_microsoft_journal_immutable();

-- Lexically comparable UTC value retains Graph's seventh fractional digit.
-- Casting the full value to PostgreSQL first would round away that ordering.
create function public.learn_microsoft_projection_time(v text) returns text
language plpgsql immutable set search_path=pg_catalog as $$declare base timestamptz;fraction text;begin
 if v is null or v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,7})?Z$' then return null;end if;
 begin base:=(left(v,19)||'Z')::timestamptz;exception when others then return null;end;
 if to_char(base at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS')<>left(v,19) then return null;end if;
 fraction:=case when substr(v,20,1)='.' then substr(v,21,length(v)-21) else '' end;
 return left(v,19)||'.'||rpad(fraction,7,'0')||'Z';
end $$;

create function public.learn_microsoft_projection_fields_valid(f jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$declare k text;r jsonb;begin
 if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['changeKey','conversationId','subject','body','bodyPreview','from','toRecipients','ccRecipients','sentDateTime','receivedDateTime','lastModifiedDateTime','isDraft','hasAttachments'])
  or jsonb_typeof(f->'isDraft') is distinct from 'boolean' or jsonb_typeof(f->'hasAttachments') is distinct from 'boolean'
  or jsonb_typeof(f->'changeKey') is distinct from 'string' or length(f->>'changeKey') not between 1 and 2048
  or (f->>'changeKey')!~'^[A-Za-z0-9+/_=-]+$'
  or public.learn_microsoft_projection_time(f->>'lastModifiedDateTime') is null then return false;end if;
 foreach k in array array['subject','bodyPreview','conversationId'] loop
  if jsonb_typeof(f->k) not in ('string','null') or length(f->>k)>65536 then return false;end if;
 end loop;
 if f->'conversationId'<>'null'::jsonb and (length(f->>'conversationId') not between 1 and 2048 or (f->>'conversationId')!~'^[A-Za-z0-9+/_=-]+$') then return false;end if;
 foreach k in array array['sentDateTime','receivedDateTime'] loop
  if f->k<>'null'::jsonb and public.learn_microsoft_projection_time(f->>k) is null then return false;end if;
 end loop;
 if f->'sentDateTime'='null'::jsonb and f->'receivedDateTime'='null'::jsonb then return false;end if;
 if jsonb_typeof(f->'body') is distinct from 'object' or coalesce(f->'body'->>'contentType','') not in ('text','html')
  or jsonb_typeof(f->'body'->'content') is distinct from 'string' or octet_length(f->'body'->>'content')>16777216 then return false;end if;
 if f->'from'<>'null'::jsonb then
  r:=f->'from'->'emailAddress';
  if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'address') is distinct from 'string'
   or length(r->>'address') not between 1 and 2048 or (r ? 'name' and jsonb_typeof(r->'name') not in ('string','null')) then return false;end if;
 end if;
 foreach k in array array['toRecipients','ccRecipients'] loop
  if jsonb_typeof(f->k) is distinct from 'array' or jsonb_array_length(f->k)>2000 then return false;end if;
  for r in select value->'emailAddress' from jsonb_array_elements(f->k) loop
   if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'address') is distinct from 'string'
    or length(r->>'address') not between 1 and 2048 then return false;end if;
  end loop;
 end loop;
 return true;
end $$;

create function public.learn_microsoft_page_project(p_tenant uuid,p_page uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare p public.learn_microsoft_source_pages%rowtype;s public.learn_microsoft_capture_streams%rowtype;
 b public.learn_microsoft_mailbox_bindings%rowtype;old public.email_messages%rowtype;
 receipt public.learn_microsoft_projection_receipts%rowtype;mailbox text;e jsonb;f jsonb;row_data jsonb;meta jsonb;
 message_key text;thread_key text;namespace text;version_time text;old_time text;observed_time timestamptz;
 published integer:=0;unchanged integer:=0;held integer:=0;drafts integer:=0;removed integer:=0;older integer:=0;
 result jsonb;participants jsonb;source_identity jsonb;message_id uuid;interaction_id uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_projection_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_microsoft_snapshot_invalid' using errcode='22023';end if;
 select * into p from public.learn_microsoft_source_pages where tenant_id=p_tenant and id=p_page;
 if not found then raise exception 'learn_microsoft_source_page_unavailable' using errcode='PT409';end if;
 select * into strict s from public.learn_microsoft_capture_streams where tenant_id=p_tenant and id=p.stream_id;
 if s.kind<>'messages' or p.source_page->>'contract' is distinct from 'microsoft-mail-page/1' then raise exception 'learn_microsoft_message_page_required' using errcode='22023';end if;
 select * into strict b from public.learn_microsoft_mailbox_bindings where tenant_id=p_tenant and id=s.binding_id;
 namespace:=b.microsoft_tenant_id::text||':'||b.mailbox_id::text||':';
 -- Serialize all folders/bindings for this real mailbox; provider timestamps, not
 -- fetch order, decide which complete observation becomes the current record.
 perform pg_advisory_xact_lock(hashtextextended('microsoft-project:'||p_tenant::text||':'||namespace,0));
 select * into receipt from public.learn_microsoft_projection_receipts where page_id=p_page;
 if found then
  if receipt.tenant_id<>p_tenant then raise exception 'learn_microsoft_projection_conflict' using errcode='PT409';end if;
  return receipt.result;
 end if;
 select lower(email_address) into mailbox from public.email_accounts where tenant_id=p_tenant and id=s.email_account_id and provider='microsoft_365';
 if not found then raise exception 'learn_microsoft_account_unavailable' using errcode='PT409';end if;
 for e in select value from jsonb_array_elements(p.source_page->'events') loop
  if jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 2048 or (e->>'id')!~'^[A-Za-z0-9+/_=-]+$' then held:=held+1;continue;end if;
  if e->>'kind'='removed_from_folder' then removed:=removed+1;continue;end if;
  f:=e->'fields';
  if e->>'kind' is distinct from 'observed' or not public.learn_microsoft_projection_fields_valid(f) then held:=held+1;continue;end if;
  if (f->>'isDraft')::boolean then drafts:=drafts+1;continue;end if;
  message_key:=namespace||(e->>'id');
  thread_key:=case when f->>'conversationId' is not null then namespace||(f->>'conversationId') end;
  version_time:=public.learn_microsoft_projection_time(f->>'lastModifiedDateTime');
  source_identity:=jsonb_build_object('directory_id',b.microsoft_tenant_id,'mailbox_id',b.mailbox_id,'message_id',e->>'id');
  meta:=jsonb_build_object('microsoft_source',source_identity||jsonb_build_object('source_page_id',p.id,'source_folder_id',s.folder_id,
   'change_key',f->>'changeKey','last_modified',version_time,'attachments_captured',false,'has_attachments',(f->>'hasAttachments')::boolean));
  row_data:=jsonb_build_object('provider_thread_id',thread_key,'from_email',lower(f->'from'->'emailAddress'->>'address'),
   'from_name',f->'from'->'emailAddress'->>'name',
   'to_emails',(select coalesce(jsonb_agg(lower(value->'emailAddress'->>'address') order by ord),'[]') from jsonb_array_elements(f->'toRecipients') with ordinality r(value,ord)),
   'cc_emails',(select coalesce(jsonb_agg(lower(value->'emailAddress'->>'address') order by ord),'[]') from jsonb_array_elements(f->'ccRecipients') with ordinality r(value,ord)),
   'subject',f->>'subject','snippet',f->>'bodyPreview',
   'body_text',case when f->'body'->>'contentType'='text' then f->'body'->>'content' end,
   'body_html',case when f->'body'->>'contentType'='html' then f->'body'->>'content' end,
   'sent_at',(f->>'sentDateTime')::timestamptz,'received_at',(f->>'receivedDateTime')::timestamptz,
   'direction',case when nullif(mailbox,'') is not null and lower(f->'from'->'emailAddress'->>'address')=mailbox then 'outbound'
    when nullif(mailbox,'') is not null and exists(select 1 from jsonb_array_elements((f->'toRecipients')||(f->'ccRecipients')) r where lower(r->'emailAddress'->>'address')=mailbox) then 'inbound' end);
  meta:=jsonb_set(meta,'{microsoft_source,content_hash}',to_jsonb(md5(row_data::text)));
  select * into old from public.email_messages where tenant_id=p_tenant and provider='microsoft_365' and provider_message_id=message_key for update;
  if found then
   if (old.raw_payload->'microsoft_source'->'directory_id') is distinct from source_identity->'directory_id'
    or (old.raw_payload->'microsoft_source'->'mailbox_id') is distinct from source_identity->'mailbox_id'
    or (old.raw_payload->'microsoft_source'->'message_id') is distinct from source_identity->'message_id'
    or public.learn_microsoft_projection_time(old.raw_payload->'microsoft_source'->>'last_modified') is null then held:=held+1;continue;end if;
   old_time:=old.raw_payload->'microsoft_source'->>'last_modified';
   if version_time<old_time then older:=older+1;continue;end if;
   if version_time=old_time then
    if old.raw_payload->'microsoft_source'->>'change_key'=f->>'changeKey'
     and (select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(old)) where key in(select jsonb_object_keys(row_data)))=row_data
     and old.raw_payload->'microsoft_source'->'has_attachments'=f->'hasAttachments'
    then unchanged:=unchanged+1;else held:=held+1;end if;
    continue;
   end if;
  end if;
  insert into public.email_messages(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
   select p_tenant,'microsoft_365',message_key,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,meta
   from jsonb_populate_record(null::public.email_messages,row_data)x
   on conflict(tenant_id,provider,provider_message_id) do update set provider_thread_id=excluded.provider_thread_id,
    from_email=excluded.from_email,from_name=excluded.from_name,to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,
    subject=excluded.subject,snippet=excluded.snippet,body_text=excluded.body_text,body_html=excluded.body_html,
    sent_at=excluded.sent_at,received_at=excluded.received_at,direction=excluded.direction,
    raw_payload=public.email_messages.raw_payload||excluded.raw_payload returning id into message_id;
  insert into public.interactions as i(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,
   interaction_type,direction,occurred_at,subject,body_preview,from_address,from_name,to_addresses,cc_addresses,
   related_thread_id,processing_status,metadata)
  values(p_tenant,'microsoft-365','email','email_messages',message_id,message_key,'email_message',coalesce(row_data->>'direction','unknown'),
   coalesce((f->>'receivedDateTime')::timestamptz,(f->>'sentDateTime')::timestamptz),f->>'subject',f->>'bodyPreview',
   row_data->>'from_email',row_data->>'from_name',array(select jsonb_array_elements_text(row_data->'to_emails')),array(select jsonb_array_elements_text(row_data->'cc_emails')),thread_key,'pending',
   jsonb_build_object('connector','microsoft-365','provider_thread_id',thread_key)||meta)
  on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,
   source_external_id=excluded.source_external_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
   subject=excluded.subject,body_preview=excluded.body_preview,from_address=excluded.from_address,from_name=excluded.from_name,
   to_addresses=excluded.to_addresses,cc_addresses=excluded.cc_addresses,related_thread_id=excluded.related_thread_id,
   processing_status=case when i.metadata->'microsoft_source'->>'content_hash' is distinct from excluded.metadata->'microsoft_source'->>'content_hash' then 'pending' else i.processing_status end,
   metadata=i.metadata||excluded.metadata returning id into interaction_id;
  insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,source,status,payload)
   values(p_tenant,'interaction.ready','interaction',interaction_id,'microsoft-projection','pending',jsonb_build_object('source_page_id',p.id))
   on conflict(tenant_id,event_type,subject_id) where status='pending' do nothing;
  if thread_key is not null then
   observed_time:=coalesce((f->>'receivedDateTime')::timestamptz,(f->>'sentDateTime')::timestamptz);
   select coalesce(jsonb_agg(v order by v),'[]') into participants from(select distinct v from jsonb_array_elements_text((row_data->'to_emails')||(row_data->'cc_emails')||jsonb_build_array(row_data->>'from_email')) as a(v) where v is not null)x;
   insert into public.email_threads as t(tenant_id,provider,provider_thread_id,subject,participants,last_message_at,raw_payload)
    values(p_tenant,'microsoft_365',thread_key,f->>'subject',participants,observed_time,jsonb_build_object('latest_microsoft_message',message_key))
    on conflict(tenant_id,provider,provider_thread_id) do update set
     subject=case when t.last_message_at is null or excluded.last_message_at>t.last_message_at
      or (excluded.last_message_at=t.last_message_at and excluded.raw_payload->>'latest_microsoft_message'>=coalesce(t.raw_payload->>'latest_microsoft_message','')) then excluded.subject else t.subject end,
     raw_payload=case when t.last_message_at is null or excluded.last_message_at>t.last_message_at
      or (excluded.last_message_at=t.last_message_at and excluded.raw_payload->>'latest_microsoft_message'>=coalesce(t.raw_payload->>'latest_microsoft_message','')) then t.raw_payload||excluded.raw_payload else t.raw_payload end,
     last_message_at=greatest(t.last_message_at,excluded.last_message_at),
     participants=(select jsonb_agg(v order by v) from(select distinct v from jsonb_array_elements_text(t.participants||excluded.participants) as a(v))x);
  end if;
  published:=published+1;
 end loop;
 result:=jsonb_build_object('contract','microsoft-projection-receipt/1','tenantId',p_tenant,'sourcePageId',p_page,
  'published',published,'unchanged',unchanged,'held',held,'drafts',drafts,'removedFromFolder',removed,'older',older,
  'coverage','unverified','attachmentsCaptured',false);
 insert into public.learn_microsoft_projection_receipts(page_id,tenant_id,result) values(p_page,p_tenant,result);
 return result;
end $$;

-- The existing settlement still owns its lease, continuation and immutable result.
-- Publishing a message page and settling its job are now one transaction. A
-- failed/expired settlement rolls back all canonical changes and the receipt.
alter function public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) rename to learn_microsoft_job_settle_before_projection;
revoke all on function public.learn_microsoft_job_settle_before_projection(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
create function public.learn_microsoft_job_settle(p_tenant uuid,p_job uuid,p_worker text,p_claim integer,p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare prior jsonb;page_id uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'learn_microsoft_projection_forbidden' using errcode='42501';end if;
 if p_apply is null then raise exception 'learn_microsoft_settlement_invalid' using errcode='22023';end if;
 prior:=public.learn_microsoft_job_settle_before_projection(p_tenant,p_job,p_worker,p_claim,false);
 if prior->>'state'='completed' or not p_apply then return prior;end if;
 select p.id into page_id from public.learn_microsoft_source_pages p join public.learn_microsoft_capture_streams s on s.id=p.stream_id and s.tenant_id=p.tenant_id
  where p.tenant_id=p_tenant and p.job_id=p_job and s.kind='messages';
 if page_id is not null then perform public.learn_microsoft_page_project(p_tenant,page_id);end if;
 return public.learn_microsoft_job_settle_before_projection(p_tenant,p_job,p_worker,p_claim,true);
end $$;
revoke all on function public.learn_microsoft_projection_time(text),public.learn_microsoft_projection_fields_valid(jsonb),public.learn_microsoft_page_project(uuid,uuid),public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.learn_microsoft_page_project(uuid,uuid),public.learn_microsoft_job_settle(uuid,uuid,text,integer,boolean) to service_role;
commit;
