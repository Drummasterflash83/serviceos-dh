-- Repair the installed invoice-check completion function. The prior
-- UPDATE ... SET result=result raised SQLSTATE 42702 because the PL/pgSQL
-- variable and table column shared a name. No provider request or data replay.
begin;

create or replace function public.learn_quickbooks_invoice_check_finish(p_request uuid,p_raw text[])
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_quickbooks_invoice_checks%rowtype;entry jsonb;v public.learn_quickbooks_source_versions%rowtype;
 comparison_rows jsonb:='[]'::jsonb;raw text;invoice jsonb;idx integer;balanced boolean;dated boolean;
 audit uuid;
begin
 if auth.role() is distinct from 'service_role' or p_raw is null or cardinality(p_raw) not between 2 and 3
  or array_position(p_raw,null) is not null then raise exception 'invoice_check_invalid' using errcode='22023';end if;
 select * into r from public.learn_quickbooks_invoice_checks where id=p_request for update;
 if not found or r.state<>'claimed' or cardinality(p_raw)<>cardinality(r.versions)
  or not public.learn_quickbooks_invoice_check_current(p_request) then
  raise exception 'invoice_check_unavailable' using errcode='42501';end if;
 for idx in 1..cardinality(p_raw) loop
  raw:=p_raw[idx];
  if length(raw) not between 1 and 131072 then raise exception 'invoice_check_response_invalid' using errcode='22023';end if;
  entry:=raw::jsonb;invoice:=entry->'Invoice';
  select * into v from public.learn_quickbooks_source_versions where id=r.versions[idx] and tenant_id=r.tenant_id;
  perform 1 from public.learn_quickbooks_latest where version_id=v.id and not conflicted;
  if not found then raise exception 'invoice_check_source_changed' using errcode='42501';end if;
  if jsonb_typeof(invoice) is distinct from 'object' or invoice->>'Id' is distinct from v.external_id
   or jsonb_typeof(invoice->'Balance') is distinct from 'number'
   or public.learn_quickbooks_money(invoice->'Balance') is null
   or invoice->>'DueDate' is null or public.learn_quickbooks_strict_date(invoice->>'DueDate') is null
   or jsonb_typeof(entry->'Fault') is not null then
   raise exception 'invoice_check_response_invalid' using errcode='22023';end if;
  balanced:=public.learn_quickbooks_money(invoice->'Balance') is not distinct from public.learn_quickbooks_money(v.payload->'Balance');
  dated:=invoice->>'DueDate' is not distinct from v.payload->>'DueDate';
  comparison_rows:=comparison_rows||jsonb_build_array(jsonb_build_object('version_id',v.id,'invoice_id',v.external_id,
   'retained_balance',public.learn_quickbooks_money(v.payload->'Balance')::text,
   'provider_balance',public.learn_quickbooks_money(invoice->'Balance')::text,
   'retained_due_date',v.payload->>'DueDate','provider_due_date',invoice->>'DueDate',
   'balance_matches',balanced,'due_date_matches',dated,
   'retained_observed_at',(select last_observed_at from public.learn_quickbooks_latest where version_id=v.id),
   'provider_updated_at',invoice#>>'{MetaData,LastUpdatedTime}'));
 end loop;
 update public.learn_quickbooks_invoice_checks set state='complete',result=comparison_rows where id=r.id;
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(r.tenant_id,r.actor_id,'invoice.provider_check_completed',jsonb_build_object('request_id',r.id,
  'versions',to_jsonb(r.versions),'all_balances_match',not exists(select 1 from jsonb_array_elements(comparison_rows)x where x->>'balance_matches'<>'true'),
  'all_due_dates_match',not exists(select 1 from jsonb_array_elements(comparison_rows)x where x->>'due_date_matches'<>'true')),
  r.reason) returning id into audit;
 return jsonb_build_object('version','quickbooks-invoice-check/1','request_id',r.id,'tenant_id',r.tenant_id,
  'environment',r.environment,'realm_id',r.realm_id,'compared_at',clock_timestamp(),'audit_id',audit,'rows',comparison_rows);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'invoice_check_response_invalid' using errcode='22023';
end $$;

commit;
