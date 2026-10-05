-- Read-only/rolled-back assertions against published DH invoices.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where email='heidi@drummondheating.co.uk'),true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.client_invoices where tenant_id='00000000-0000-0000-0000-000000000001')<>8 then raise exception 'Client invoice count';end if;
 if (select sum(amount_pence) from public.client_invoices where status='paid' and tenant_id='00000000-0000-0000-0000-000000000001')<>950800 then raise exception 'Paid total';end if;
 if (select sum(amount_pence) from public.client_invoices where status='outstanding' and tenant_id='00000000-0000-0000-0000-000000000001')<>175000 then raise exception 'Outstanding total';end if;
 if (select count(*) from storage.objects where bucket_id='client-invoices')<>8 then raise exception 'Client file access';end if;
 if (select count(*) from public.client_delivery_updates)<>1 then raise exception 'Delivery access';end if;
 begin update public.client_invoices set status='paid';raise exception 'Unexpected write access';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','77777777-8888-4999-aaaa-bbbbbbbbbbbb',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.client_invoices) then raise exception 'Unrelated user sees invoices';end if;
 if exists(select 1 from public.client_delivery_updates) then raise exception 'Unrelated user sees delivery';end if;
 if exists(select 1 from storage.objects where bucket_id='client-invoices') then raise exception 'Unrelated user sees files';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.client_invoices;raise exception 'Anonymous invoice access';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select public from storage.buckets where id='client-invoices') then raise exception 'Public bucket';end if;
end $$;
rollback;
select 'PASS: client totals/files, unrelated identity denial, anonymous denial, no browser writes, private bucket' as proof;
