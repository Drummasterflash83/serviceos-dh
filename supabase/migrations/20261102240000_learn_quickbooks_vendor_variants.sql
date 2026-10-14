-- Vendor has a computed Balance, but not Customer's BalanceWithJobs.
begin;
do $patch$
declare d text;needle text;begin
 select pg_get_functiondef('public.learn_quickbooks_payload_variant(text,jsonb,jsonb)'::regprocedure) into d;
 needle:='p_entity=''Customer'' and';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'quickbooks_vendor_variant_source_changed';end if;
 d:=replace(d,needle,'p_entity in(''Customer'',''Vendor'') and');
 needle:='p_before-array[''Balance'',''BalanceWithJobs'',''MetaData'']';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'quickbooks_vendor_variant_source_changed';end if;
 d:=replace(d,needle,'p_before-(case when p_entity=''Customer'' then array[''Balance'',''BalanceWithJobs'',''MetaData''] else array[''Balance'',''MetaData''] end)');
 needle:='p_after-array[''Balance'',''BalanceWithJobs'',''MetaData'']';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'quickbooks_vendor_variant_source_changed';end if;
 execute replace(d,needle,'p_after-(case when p_entity=''Customer'' then array[''Balance'',''BalanceWithJobs'',''MetaData''] else array[''Balance'',''MetaData''] end)');
end $patch$;
commit;
