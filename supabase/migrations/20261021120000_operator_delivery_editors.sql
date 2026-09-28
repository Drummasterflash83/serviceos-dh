-- Operator-only shared delivery editing. Issued invoice money/PDFs stay immutable.
begin;
alter table public.client_invoices add column version integer not null default 1;
alter table public.client_delivery_updates add column version integer not null default 1;

create function public.operator_update_invoice_notes(p_tenant uuid, p_invoice uuid, p_version integer, p_outcome_note text, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare old_row public.client_invoices; next_version integer;
begin
 if auth.uid() is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin') then raise exception 'Operator administrator required' using errcode='42501'; end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>now())) then raise exception 'Editing is unavailable in client preview' using errcode='42501'; end if;
 if p_version is null or p_outcome_note is null or length(btrim(p_outcome_note)) not between 1 and 10000 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Valid notes and change reason required'; end if;
 select * into old_row from public.client_invoices where tenant_id=p_tenant and id=p_invoice for update;
 if not found then raise exception 'Invoice not found'; end if;
 if old_row.version <> p_version then raise exception 'This invoice changed. Reload before saving.' using errcode='40001'; end if;
 update public.client_invoices set outcome_note=btrim(p_outcome_note),version=version+1 where id=p_invoice returning version into next_version;
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,before,after,reason,source)
 values(p_tenant,auth.uid()::text,'client.invoice.notes_updated','client_invoice',p_invoice::text,jsonb_build_object('outcome_note',old_row.outcome_note,'version',old_row.version),jsonb_build_object('outcome_note',btrim(p_outcome_note),'version',next_version),btrim(p_reason),'openfolk');
 return next_version;
end $$;

create function public.operator_update_delivery(p_tenant uuid, p_version integer, p_content jsonb, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare old_row public.client_delivery_updates; next_version integer; area jsonb;
begin
 if auth.uid() is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin') then raise exception 'Operator administrator required' using errcode='42501'; end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>now())) then raise exception 'Editing is unavailable in client preview' using errcode='42501'; end if;
 if p_version is null or p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>100000 or p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Valid delivery update and change reason required'; end if;
 if (p_content - array['summary','areas','readinessNote','next']) <> '{}'::jsonb then raise exception 'Unexpected delivery fields'; end if;
 if jsonb_typeof(p_content->'summary') is distinct from 'string' or length(btrim(p_content->>'summary')) not between 1 and 10000
 or jsonb_typeof(p_content->'next') is distinct from 'string' or length(btrim(p_content->>'next')) not between 1 and 10000
 or jsonb_typeof(p_content->'readinessNote') is distinct from 'string' or length(p_content->>'readinessNote')>10000
 or jsonb_typeof(p_content->'areas') is distinct from 'array' then raise exception 'Invalid delivery structure'; end if;
 if jsonb_array_length(p_content->'areas')>50 then raise exception 'Too many delivery areas'; end if;
 for area in select value from jsonb_array_elements(p_content->'areas') loop
   if jsonb_typeof(area)<>'object' or (area-array['title','status','detail'])<>'{}'::jsonb
   or jsonb_typeof(area->'title') is distinct from 'string' or length(btrim(area->>'title')) not between 1 and 200
   or jsonb_typeof(area->'status') is distinct from 'string' or length(btrim(area->>'status')) not between 1 and 100
   or jsonb_typeof(area->'detail') is distinct from 'string' or length(btrim(area->>'detail')) not between 1 and 10000 then raise exception 'Invalid delivery area'; end if;
 end loop;
 -- Parent lock serialises first publication as well as subsequent edits.
 perform 1 from public.client_programmes where tenant_id=p_tenant for update;
 if not found then raise exception 'Client programme not found'; end if;
 select * into old_row from public.client_delivery_updates where tenant_id=p_tenant for update;
 if coalesce(old_row.version,0)<>p_version then raise exception 'This delivery update changed. Reload before saving.' using errcode='40001'; end if;
 next_version:=coalesce(old_row.version,0)+1;
 insert into public.client_delivery_updates(tenant_id,content,verified_at,version) values(p_tenant,p_content,now(),next_version)
 on conflict(tenant_id) do update set content=excluded.content,verified_at=excluded.verified_at,version=excluded.version;
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,before,after,reason,source)
 values(p_tenant,auth.uid()::text,'client.delivery.updated','client_delivery',p_tenant::text,jsonb_build_object('content',old_row.content,'version',old_row.version),jsonb_build_object('content',p_content,'version',next_version),btrim(p_reason),'openfolk');
 return next_version;
end $$;
revoke all on function public.operator_update_invoice_notes(uuid,uuid,integer,text,text), public.operator_update_delivery(uuid,integer,jsonb,text) from public,anon;
grant execute on function public.operator_update_invoice_notes(uuid,uuid,integer,text,text), public.operator_update_delivery(uuid,integer,jsonb,text) to authenticated;
commit;
