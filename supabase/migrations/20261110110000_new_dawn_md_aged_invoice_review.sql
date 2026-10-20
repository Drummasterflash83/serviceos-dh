-- Bounded, audited 91+ invoice-source review for the guarded MD/operator path.
-- No provider call, money write, customer/job link, chase draft or new staff access.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.new_dawn_md_aged_invoice_review(
  p_tenant uuid, p_reason text, p_after_due date default null,
  p_after_version uuid default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  c public.learn_quickbooks_connections%rowtype;
  connection_count integer;
  read_at timestamptz := clock_timestamp();
  as_of date := (clock_timestamp() at time zone 'UTC')::date;
  eligible_count bigint;
  selected jsonb;
  has_more boolean;
  audit uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null
    or p_reason is null or length(btrim(p_reason)) not between 3 and 500
    or ((p_after_due is null) <> (p_after_version is null))
    or (p_after_due is not null and p_after_due > as_of - 91) then
    raise exception 'aged_invoice_review_forbidden' using errcode = '42501';
  end if;
  perform public.learn_operator_input_access(p_tenant, actor, true);
  perform public.learn_quickbooks_actor_access(p_tenant, actor);
  perform 1 from public.feature_flags where tenant_id = p_tenant
    and flag = 'new_dawn.invoice_review_candidates_preview'
    and value = 'true'::jsonb for share;
  if not found then raise exception 'aged_invoice_review_disabled' using errcode = '42501'; end if;

  select count(*) into connection_count from public.learn_quickbooks_connections
    where tenant_id = p_tenant and environment = 'production'
      and confirmed_at is not null and realm_id is not null
      and status <> 'disconnected';
  if connection_count <> 1 then
    raise exception 'aged_invoice_realm_unconfirmed' using errcode = '42501';
  end if;
  select * into c from public.learn_quickbooks_connections
    where tenant_id = p_tenant and environment = 'production'
      and confirmed_at is not null and realm_id is not null
      and status <> 'disconnected' for share;

  with source_rows as materialized (
    select l.external_id, l.version_id, l.last_observed_at,
      v.source_updated_at, v.content_hash, v.payload,
      public.new_dawn_invoice_strict_date(v.payload->>'DueDate') as due_date,
      v.payload->>'Balance' as balance_text,
      v.payload#>>'{CurrencyRef,value}' as currency
    from public.learn_quickbooks_latest l
    join public.learn_quickbooks_source_versions v
      on v.id = l.version_id and v.tenant_id = l.tenant_id
      and v.environment = l.environment and v.realm_id = l.realm_id
      and v.entity = l.entity and v.external_id = l.external_id
      and v.sync_token = l.sync_token
      and v.source_updated_at is not distinct from l.source_updated_at
    where l.tenant_id = p_tenant and l.environment = 'production'
      and l.realm_id = c.realm_id and l.entity = 'Invoice'
      and not l.conflicted and v.payload->>'Id' = l.external_id
      and l.last_observed_at >= read_at - interval '7 days'
      and l.last_observed_at <= read_at
  ), eligible as materialized (
    select * from source_rows
    where content_hash ~ '^[0-9a-f]{64}$'
      and external_id ~ '^[0-9]{1,30}$'
      and currency ~ '^[A-Z]{3}$'
      and jsonb_typeof(payload->'Balance') = 'number'
      and balance_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      and length(balance_text) <= 40
      and case when length(balance_text) <= 40
        and balance_text ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
        then balance_text::numeric > 0 else false end
      and due_date <= as_of - 91
      and source_updated_at <= read_at
  ), chosen as (
    select * from eligible
    where p_after_due is null or (due_date, version_id) > (p_after_due, p_after_version)
    order by due_date, version_id limit 21
  ), page as (
    select * from chosen order by due_date, version_id limit 20
  )
  select (select count(*) from eligible),
    coalesce((select jsonb_agg(jsonb_build_object(
      'invoice_id', external_id, 'source_version_id', version_id,
      'document_number', left(payload->>'DocNumber', 200),
      'balance', balance_text, 'currency', currency,
      'due_date', due_date, 'source_updated_at', source_updated_at,
      'source_observed_at', last_observed_at, 'source_sha256', content_hash)
      order by due_date, version_id) from page), '[]'::jsonb),
    (select count(*) > 20 from chosen)
    into eligible_count, selected, has_more;

  perform public.learn_operator_input_access(p_tenant, actor, true);
  perform public.learn_quickbooks_actor_access(p_tenant, actor);
  insert into public.learn_quickbooks_finance_events(
    tenant_id, actor_id, event, detail, reason
  ) values (
    p_tenant, actor, 'invoice.aged_91_review_read',
    jsonb_build_object('realm_id', c.realm_id, 'as_of', as_of,
      'eligible_count', eligible_count, 'shown_count', jsonb_array_length(selected),
      'after_due', p_after_due, 'after_version', p_after_version),
    btrim(p_reason)
  ) returning id into audit;
  perform set_config('response.headers', '[{"Cache-Control":"no-store"}]', true);
  return jsonb_build_object(
    'version', 'new-dawn-md-aged-invoice-review/1',
    'audience', 'openfolk_operator_only', 'tenant_id', p_tenant,
    'actor_id', actor, 'environment', 'production', 'realm_id', c.realm_id,
    'as_of', as_of, 'read_at', read_at, 'eligible_count', eligible_count,
    'has_more', has_more, 'candidates', selected, 'audit_id', audit
  );
end $$;

revoke all on function public.new_dawn_md_aged_invoice_review(uuid,text,date,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.new_dawn_md_aged_invoice_review(uuid,text,date,uuid)
  to authenticated;
commit;
