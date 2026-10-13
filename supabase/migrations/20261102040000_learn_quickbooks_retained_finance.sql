-- Intake can be paused without hiding retained accounting evidence from its
-- existing authorised readers. LEARN availability and identity checks remain.
-- Linking, capture and credential operations retain their existing fences.
begin;
create function public.learn_quickbooks_retained_finance_access(p_tenant uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'quickbooks_finance_forbidden' using errcode='42501';end if;
 if p_reason is not null then
  if length(btrim(p_reason)) not between 3 and 500 then raise exception 'quickbooks_reason_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 else perform public.learn_import_batch_authority(p_tenant,auth.uid());end if;
 perform 1 from auth.users where id=auth.uid() and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'quickbooks_finance_forbidden' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'quickbooks_module_disabled' using errcode='42501';end if;
end $$;
revoke all on function public.learn_quickbooks_retained_finance_access(uuid,text) from public,anon,authenticated,service_role;

do $patch$
declare signature text;definition text;needle text:='public.learn_quickbooks_finance_access(';begin
 foreach signature in array array[
  'public.learn_quickbooks_customer_candidates(uuid,text,text,uuid)',
  'public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'QuickBooks finance reader missing';end if;
  select pg_get_functiondef(to_regprocedure(signature)) into definition;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2
   or position('public.learn_quickbooks_retained_finance_access(' in definition)>0 then
   raise exception 'QuickBooks finance reader differs; inspect before changing';end if;
  execute replace(definition,needle,'public.learn_quickbooks_retained_finance_access(');
 end loop;
end $patch$;
commit;
