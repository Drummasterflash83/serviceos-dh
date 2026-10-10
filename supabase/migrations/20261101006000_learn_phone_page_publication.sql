-- Phone page publication: controller/account checks, source writes and receipt commit together.
-- Additive; no capture activation, credentials, schedules or source rewrites on installation.
begin;
create table public.learn_phone_capture_pages (
 run_id uuid not null references public.phone_sync_runs(id),
 page integer not null check(page between 1 and 50),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(run_id,page)
);
alter table public.learn_phone_capture_pages enable row level security;
revoke all on public.learn_phone_capture_pages from public,anon,authenticated,service_role;
grant select on public.learn_phone_capture_pages to service_role;
create trigger learn_phone_pages_immutable before update or delete on public.learn_phone_capture_pages
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_pages_no_truncate before truncate on public.learn_phone_capture_pages
 for each statement execute function public.learn_operator_input_immutable();

-- Also fence direct flag edits, including insertion of a previously absent switch.
-- Publisher never row-locks flags, avoiding a flag-row/advisory-lock inversion.
create function public.learn_phone_capture_flag_lock() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare old_tenant uuid;new_tenant uuid;t uuid;
begin
 if TG_OP<>'INSERT' and OLD.flag in ('learn.enabled','learn.inputs.phone.enabled') then old_tenant:=OLD.tenant_id;end if;
 if TG_OP<>'DELETE' and NEW.flag in ('learn.enabled','learn.inputs.phone.enabled') then new_tenant:=NEW.tenant_id;end if;
 for t in select distinct v from unnest(array[old_tenant,new_tenant])v where v is not null order by v loop
  perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||t::text,0));
 end loop;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $$;
revoke all on function public.learn_phone_capture_flag_lock() from public,anon,authenticated,service_role;
create trigger learn_phone_capture_flags before insert or update or delete on public.feature_flags
 for each row execute function public.learn_phone_capture_flag_lock();

create function public.learn_phone_publish_page(
 p_tenant uuid,p_run uuid,p_account uuid,p_connector uuid,p_customer text,
 p_kind text,p_page integer,p_records jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;
 prior public.learn_phone_capture_pages%rowtype;d jsonb;answer jsonb;item jsonb;identity_key text;keys text[];
 inserted_id uuid;new_ids jsonb:='[]'::jsonb;previous_page integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_page_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_account is null or p_connector is null or p_customer is null
 or p_customer!~'^[A-Za-z0-9_-]{1,128}$' or p_kind is null or p_kind not in ('calls','recordings')
 or p_page is null or p_page not between 1 and 50 or jsonb_typeof(p_records) is distinct from 'array'
 or jsonb_array_length(p_records)>200 or octet_length(p_records::text)>2097152 then
  raise exception 'phone_page_invalid' using errcode='22023';end if;
 identity_key:=case when p_kind='calls' then 'provider_call_id' else 'provider_recording_id' end;
 keys:=case when p_kind='calls' then array['tenant_id','provider','provider_call_id','linked_id','direction','from_number','to_number','started_at','duration_seconds','outcome','cost','raw_payload']
  else array['tenant_id','provider','provider_recording_id','provider_call_id','linked_id','recording_uri','file_size','started_at','duration_seconds','raw_payload'] end;
 if exists(select 1 from jsonb_array_elements(p_records)x where jsonb_typeof(x) is distinct from 'object'
  or x->>'tenant_id' is distinct from p_tenant::text or x->>'provider' is distinct from 'simwood'
  or jsonb_typeof(x->identity_key) is distinct from 'string' or length(btrim(x->>identity_key)) not between 1 and 200
  or (x-keys)<>'{}'::jsonb or jsonb_typeof(x->'raw_payload') is distinct from 'object')
 or (select count(distinct x->>identity_key) from jsonb_array_elements(p_records)x)<>jsonb_array_length(p_records) then
  raise exception 'phone_page_records_invalid' using errcode='22023';end if;
 d:=jsonb_build_object('accountId',p_account,'connectorId',p_connector,'customerId',p_customer,'kind',p_kind,
  'recordsSha256',encode(sha256(convert_to(p_records::text,'UTF8')),'hex'));
 -- Lock order shared with controller changes, then the run. Replays only read a receipt.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>p_kind then raise exception 'phone_page_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_capture_pages where run_id=p_run and page=p_page;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_page_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_page_run_changed' using errcode='PT409';end if;
 select max(page) into previous_page from public.learn_phone_capture_pages where run_id=p_run;
 if p_page<>coalesce(previous_page,0)+1 or exists(select 1 from public.learn_phone_capture_pages where run_id=p_run
  and (definition-'recordsSha256')<>(d-'recordsSha256')) then raise exception 'phone_page_sequence_changed' using errcode='PT409';end if;
 -- Native row locks fence direct tenant/account/connector changes through commit.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=p_connector and tenant_id=p_tenant for share;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or a.tenant_connector_id<>p_connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from p_customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 -- Stable source-key order avoids deadlocks between concurrent pages/runs.
 for item in select x from jsonb_array_elements(p_records)x order by x->>identity_key loop
  if p_kind='calls' then
   insert into public.phone_calls(tenant_id,provider,provider_call_id,linked_id,direction,from_number,to_number,started_at,duration_seconds,outcome,cost,raw_payload)
   values(p_tenant,'simwood',item->>'provider_call_id',item->>'linked_id',item->>'direction',item->>'from_number',item->>'to_number',
    (item->>'started_at')::timestamptz,(item->>'duration_seconds')::integer,item->>'outcome',(item->>'cost')::numeric,item->'raw_payload')
   on conflict(tenant_id,provider,provider_call_id) do update set linked_id=excluded.linked_id,direction=excluded.direction,
    from_number=excluded.from_number,to_number=excluded.to_number,started_at=excluded.started_at,duration_seconds=excluded.duration_seconds,
    outcome=excluded.outcome,cost=excluded.cost,raw_payload=excluded.raw_payload;
  else
   inserted_id:=null;
   insert into public.phone_recordings(tenant_id,provider,provider_recording_id,provider_call_id,linked_id,recording_uri,file_size,started_at,duration_seconds,raw_payload)
   values(p_tenant,'simwood',item->>'provider_recording_id',item->>'provider_call_id',item->>'linked_id',item->>'recording_uri',
    (item->>'file_size')::bigint,(item->>'started_at')::timestamptz,(item->>'duration_seconds')::integer,item->'raw_payload')
   on conflict(tenant_id,provider,provider_recording_id) do nothing returning id into inserted_id;
   if inserted_id is not null then new_ids:=new_ids||jsonb_build_array(inserted_id);
   else
    update public.phone_recordings set provider_call_id=item->>'provider_call_id',linked_id=item->>'linked_id',recording_uri=item->>'recording_uri',
     file_size=(item->>'file_size')::bigint,started_at=(item->>'started_at')::timestamptz,duration_seconds=(item->>'duration_seconds')::integer,
     raw_payload=item->'raw_payload' where tenant_id=p_tenant and provider='simwood' and provider_recording_id=item->>'provider_recording_id';
   end if;
  end if;
 end loop;
 answer:=jsonb_build_object('version','learn-phone-page/1','tenantId',p_tenant,'runId',p_run,'page',p_page,'kind',p_kind,
  'recordsProcessed',jsonb_array_length(p_records),'newRecordingIds',new_ids);
 insert into public.learn_phone_capture_pages(run_id,page,tenant_id,definition,receipt) values(p_run,p_page,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_publish_page(uuid,uuid,uuid,uuid,text,text,integer,jsonb) to service_role;
commit;
