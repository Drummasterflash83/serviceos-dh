-- Surface retained open-work review priorities without inferring an assignee,
-- publishing a score, changing a job identity or asking the provider to write.
-- The existing reader, audit, paging and tenant/connection checks remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$ declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)'::regprocedure);
 if md5(definition)<>'944d779e4a737dceb3b8c94e79d8dd22'
 then raise exception 'commusoft_source_attention_baseline_changed';end if;
 needle:='(btrim(p_query)='''' or position(lower(btrim(p_query)) in lower(concat_ws('' '',external_id,title,business_unit,property_reference,customer_reference,company_name,contact_name)))>0)';
 replacement:='(case btrim(p_query)
   when ''status:on-hold'' then source_status=''on_hold''
   when ''status:needs-review'' then source_status in (''Open'',''ongoing'',''pending'',''on_hold'')
    and (reviewed_job_id is null or customer_identity_state<>''reviewed''
     or relationship_state not in (''customer_source_retained'',''site_customer_source_retained''))
   else btrim(p_query)='''' or position(lower(btrim(p_query)) in lower(concat_ws('' '',external_id,title,business_unit,property_reference,customer_reference,company_name,contact_name)))>0 end)';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 then raise exception 'commusoft_source_attention_filter_anchor_changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
