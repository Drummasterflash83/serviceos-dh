-- Final import status and its immutable evidence commit together. This does not
-- activate capture, advance a scheduler cursor, or modify existing source rows.
begin;
create table public.learn_phone_import_completions (
 run_id uuid primary key references public.phone_sync_runs(id),
 tenant_id uuid not null references public.tenants(id),
 definition jsonb not null,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_phone_import_completions enable row level security;
revoke all on public.learn_phone_import_completions from public,anon,authenticated,service_role;
grant select on public.learn_phone_import_completions to service_role;
create trigger learn_phone_completions_immutable before update or delete on public.learn_phone_import_completions
 for each row execute function public.learn_operator_input_immutable();
create trigger learn_phone_completions_no_truncate before truncate on public.learn_phone_import_completions
 for each statement execute function public.learn_operator_input_immutable();

create function public.learn_phone_complete_import(
 p_tenant uuid,p_run uuid,p_account uuid,p_connector uuid,p_customer text,
 p_kind text,p_pages integer,p_records integer,p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.phone_sync_runs%rowtype;a public.connector_accounts%rowtype;c public.tenant_connectors%rowtype;
 prior public.learn_phone_import_completions%rowtype;d jsonb;scope jsonb;answer jsonb;
 page_count integer;last_page integer;record_count integer;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'phone_completion_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_run is null or p_account is null or p_connector is null or p_customer is null
 or p_customer!~'^[A-Za-z0-9_-]{1,128}$' or p_kind is null or p_kind not in ('calls','recordings')
 or p_pages is null or p_pages not between 1 and 50 or p_records is null or p_records not between 0 and 10000
 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>16384
 or p_metadata->'window_complete' is distinct from 'true'::jsonb
 or p_metadata->'pages_fetched' is distinct from to_jsonb(p_pages)
 or p_metadata->>'customer_id' is distinct from p_customer
 or p_metadata->(case when p_kind='calls' then 'skipped_no_call_id' else 'skipped_no_recording_id' end) is distinct from '0'::jsonb then
  raise exception 'phone_completion_invalid' using errcode='22023';end if;
 scope:=jsonb_build_object('accountId',p_account,'connectorId',p_connector,'customerId',p_customer,'kind',p_kind);
 d:=scope||jsonb_build_object('pages',p_pages,'recordsProcessed',p_records,'metadata',p_metadata);
 -- Same ordering as publication/controller: controller lock, run, tenant,
 -- connector, account. An exact receipt replay is read-only even after a pause.
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.phone_sync_runs where id=p_run and tenant_id=p_tenant for update;
 if not found or r.provider<>'simwood' or r.sync_type<>p_kind then raise exception 'phone_completion_run_changed' using errcode='PT409';end if;
 select * into prior from public.learn_phone_import_completions where run_id=p_run;
 if found then
  if prior.tenant_id<>p_tenant or prior.definition<>d then raise exception 'phone_completion_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if r.status<>'running' then raise exception 'phone_completion_run_changed' using errcode='PT409';end if;
 if jsonb_typeof(r.metadata->'from') is distinct from 'string' or jsonb_typeof(r.metadata->'to') is distinct from 'string'
 or not (p_metadata @> r.metadata) or not isfinite((r.metadata->>'from')::timestamptz)
 or not isfinite((r.metadata->>'to')::timestamptz) or (r.metadata->>'from')::timestamptz >= (r.metadata->>'to')::timestamptz then
  raise exception 'phone_completion_window_changed' using errcode='PT409';end if;
 select count(*),max(page),coalesce(sum((receipt->>'recordsProcessed')::integer),0)
 into page_count,last_page,record_count from public.learn_phone_capture_pages where run_id=p_run;
 if page_count<>p_pages or last_page is distinct from p_pages or record_count<>p_records
 or exists(select 1 from public.learn_phone_capture_pages where run_id=p_run
  and (tenant_id<>p_tenant or (definition-'recordsSha256')<>scope)) then
  raise exception 'phone_completion_pages_changed' using errcode='PT409';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found or not public.learn_capture_allowed(p_tenant,'phone') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into c from public.tenant_connectors where id=p_connector and tenant_id=p_tenant for share;
 if not found or c.connector_id<>'simwood' or c.provider<>'simwood' or not c.enabled or c.status not in ('active','error') then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant for share;
 if not found or a.tenant_connector_id<>p_connector or a.status<>'active'
 or coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) is distinct from p_customer then
  raise exception 'phone_account_unavailable' using errcode='PT409';end if;
 answer:=scope||jsonb_build_object('version','learn-phone-import/1','tenantId',p_tenant,'runId',p_run,
  'pages',p_pages,'recordsProcessed',p_records,'from',r.metadata->>'from','to',r.metadata->>'to','windowComplete',true);
 update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=p_records,
  error_message=null,metadata=p_metadata where id=p_run and tenant_id=p_tenant;
 insert into public.learn_phone_import_completions(run_id,tenant_id,definition,receipt) values(p_run,p_tenant,d,answer);
 return answer;
end $$;
revoke all on function public.learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_phone_complete_import(uuid,uuid,uuid,uuid,text,text,integer,integer,jsonb) to service_role;
commit;
