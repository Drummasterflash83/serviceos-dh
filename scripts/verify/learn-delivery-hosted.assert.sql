-- Installed TEST schema denials only. No Auth identities, grants or publications.
begin;
set local statement_timeout='15s';
set local search_path=public,pg_catalog;
do $$begin
 if exists(select 1 from client_delivery_updates) or exists(select 1 from controlplane_change_log) then raise exception 'Expected empty restored progress and audit tables';end if;
 if has_function_privilege('anon','operator_update_delivery(uuid,integer,jsonb,text)','execute')
 or has_table_privilege('authenticated','client_delivery_updates','insert')
 or has_table_privilege('authenticated','controlplane_change_log','insert')
 or has_table_privilege('service_role','controlplane_change_log','truncate') then raise exception 'Unexpected delivery/audit authority';end if;
 if (select count(*) from pg_trigger where tgrelid='public.controlplane_change_log'::regclass and not tgisinternal and tgname like 'learn_delivery_audit_no_%')<>3 then raise exception 'Audit retention triggers missing';end if;
end $$;
set local request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000099"}';
set local role authenticated;
do $$declare denied boolean:=false;begin
 if exists(select 1 from client_delivery_updates) or exists(select 1 from controlplane_change_log) then raise exception 'Unassigned identity read progress or raw audit';end if;
 begin perform operator_update_delivery('00000000-0000-4000-8000-000000000098',0,'{"summary":"Denied","areas":[],"readinessNote":"","next":"Denied"}','Synthetic denial check');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unassigned identity published delivery';end if;
end $$;
reset role;
select 'learn-delivery-hosted/1' as marker,true as unassigned_publication_denied,true as no_raw_browser_write,true as audit_retention_present,true as no_publication;
rollback;
