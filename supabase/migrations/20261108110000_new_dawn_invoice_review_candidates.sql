-- Operator-only review of bounded, recently observed retained QuickBooks invoices.
-- Installation does not seed a flag, contact a provider or expose client money.
begin;

create function public.new_dawn_invoice_strict_date(p_value text) returns date
language plpgsql immutable strict set search_path=pg_catalog as $$
begin
 if p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 return make_date(substr(p_value,1,4)::integer,substr(p_value,6,2)::integer,
  substr(p_value,9,2)::integer);
exception when others then return null;
end $$;

create function public.new_dawn_invoice_review_candidates(p_tenant uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  c public.learn_quickbooks_connections%rowtype;
  connection_count integer;
  source_currency text;
  currency_count integer;
  invalid_currency_count integer;
  candidates jsonb;
  eligible_count bigint;
  newest_observed_at timestamptz;
  audit uuid;
  read_at timestamptz:=clock_timestamp();
  as_of date:=(clock_timestamp() at time zone 'UTC')::date;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_tenant is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'invoice_review_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.invoice_review_candidates_preview' and value='true'::jsonb for share;
 if not found then raise exception 'invoice_review_disabled' using errcode='42501';end if;

 -- A single confirmed production realm is required; never combine companies.
 select count(*) into connection_count from public.learn_quickbooks_connections
  where tenant_id=p_tenant and environment='production' and confirmed_at is not null
   and realm_id is not null and status<>'disconnected';
 if connection_count<>1 then raise exception 'invoice_review_realm_unconfirmed' using errcode='42501';end if;
 select * into c from public.learn_quickbooks_connections
  where tenant_id=p_tenant and environment='production' and confirmed_at is not null
   and realm_id is not null and status<>'disconnected' for share;

 select max(l.last_observed_at) into newest_observed_at from public.learn_quickbooks_latest l
  where l.tenant_id=p_tenant and l.environment='production' and l.realm_id=c.realm_id
   and l.entity='Invoice';
 select count(distinct v.payload#>>'{CurrencyRef,value}'),max(v.payload#>>'{CurrencyRef,value}'),
  count(*) filter(where v.payload#>>'{CurrencyRef,value}' is null
   or v.payload#>>'{CurrencyRef,value}' !~ '^[A-Z]{3}$')
  into currency_count,source_currency,invalid_currency_count
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v
   on v.id=l.version_id and v.tenant_id=l.tenant_id and v.environment=l.environment
   and v.realm_id=l.realm_id and v.entity=l.entity and v.external_id=l.external_id
   and v.sync_token=l.sync_token
   and v.source_updated_at is not distinct from l.source_updated_at
  where l.tenant_id=p_tenant and l.environment='production' and l.realm_id=c.realm_id
   and l.entity='Invoice' and not l.conflicted;
 if currency_count<>1 or invalid_currency_count<>0 or source_currency !~ '^[A-Z]{3}$' then
  raise exception 'invoice_review_currency_unconfirmed' using errcode='42501';end if;

 with source_rows as materialized (
  select l.external_id,l.version_id,l.last_observed_at,v.source_updated_at,
   v.content_hash,v.payload,
   public.new_dawn_invoice_strict_date(v.payload->>'DueDate') due_date,
   v.payload->>'Balance' balance_text,
   v.payload#>>'{CurrencyRef,value}' currency
  from public.learn_quickbooks_latest l
  join public.learn_quickbooks_source_versions v
   on v.id=l.version_id and v.tenant_id=l.tenant_id
   and v.environment=l.environment and v.realm_id=l.realm_id
   and v.entity=l.entity and v.external_id=l.external_id
   and v.sync_token=l.sync_token
   and v.source_updated_at is not distinct from l.source_updated_at
  where l.tenant_id=p_tenant and l.environment='production'
   and l.realm_id=c.realm_id and l.entity='Invoice' and not l.conflicted
   and v.payload->>'Id'=l.external_id
 ), eligible as materialized (
  select * from source_rows where content_hash ~ '^[0-9a-f]{64}$'
   and currency=source_currency
   and jsonb_typeof(payload->'Balance')='number'
   and balance_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
   and case when length(balance_text)<=40 and balance_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    then balance_text::numeric>0 else false end
   and due_date>=as_of-30 and due_date<as_of
   and source_updated_at>=read_at-interval '30 days' and source_updated_at<=read_at
   and last_observed_at>=read_at-interval '7 days' and last_observed_at<=read_at
 ), chosen as (
  select * from eligible order by due_date desc,version_id limit 20
 )
 select coalesce((select jsonb_agg(jsonb_build_object(
   'invoice_id',external_id,'source_version_id',version_id,
   'document_number',left(payload->>'DocNumber',200),
   'balance',balance_text,'currency',currency,'due_date',due_date,
   'source_updated_at',source_updated_at,'source_observed_at',last_observed_at,
   'source_sha256',content_hash)
   order by due_date desc,version_id) from chosen),'[]'::jsonb),
   (select count(*) from eligible) into candidates,eligible_count;

 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform public.learn_quickbooks_actor_access(p_tenant,auth.uid());
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'invoice.review_candidates_read',
  jsonb_build_object('connection_id',c.id,'realm_id',c.realm_id,
   'as_of',as_of,'eligible_count',eligible_count,'shown_count',jsonb_array_length(candidates)),
  btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-invoice-review-candidates/1',
  'audience','openfolk_operator_only','tenant_id',p_tenant,'actor_id',auth.uid(),
  'environment','production','realm_id',c.realm_id,'currency',source_currency,
  'as_of',as_of,'read_at',read_at,
  'newest_observed_at',newest_observed_at,'eligible_count',eligible_count,
  'candidates',candidates,'audit_id',audit);
end $$;

revoke all on function public.new_dawn_invoice_review_candidates(uuid,text)
 from public,anon,authenticated,service_role;
revoke all on function public.new_dawn_invoice_strict_date(text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_invoice_review_candidates(uuid,text) to authenticated;
commit;
