-- Additive private billing read model. No browser write or payment authority.
begin;
create table public.client_invoices (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.client_programmes(tenant_id),
 reference text not null, issued_on date not null,
 amount_pence bigint not null check(amount_pence>0),
 status text not null check(status in ('paid','outstanding')),
 description text not null, outcome_note text not null, payment_basis text not null,
 storage_path text not null unique, sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 correction_note text, created_at timestamptz not null default now(),
 unique(tenant_id,reference), check(storage_path like tenant_id::text || '/%')
);
alter table public.client_invoices enable row level security;
revoke all on public.client_invoices from anon,authenticated;
grant select on public.client_invoices to authenticated;
grant all on public.client_invoices to service_role;
create policy client_invoice_read on public.client_invoices for select to authenticated
using (public.current_user_is_openfolk_operator() or exists (
 select 1 from public.client_portal_access a
 where a.tenant_id=client_invoices.tenant_id and a.profile_id=auth.uid()
));
create table public.client_delivery_updates (
 tenant_id uuid primary key references public.client_programmes(tenant_id),
 content jsonb not null check(jsonb_typeof(content)='object'),
 verified_at timestamptz not null default now()
);
alter table public.client_delivery_updates enable row level security;
revoke all on public.client_delivery_updates from anon,authenticated;
grant select on public.client_delivery_updates to authenticated;
grant all on public.client_delivery_updates to service_role;
create policy client_delivery_read on public.client_delivery_updates for select to authenticated
using (public.current_user_is_openfolk_operator() or exists (
 select 1 from public.client_portal_access a
 where a.tenant_id=client_delivery_updates.tenant_id and a.profile_id=auth.uid()
));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('client-invoices','client-invoices',false,10485760,array['application/pdf']);
create policy client_invoice_file_read on storage.objects for select to authenticated
using (bucket_id='client-invoices' and exists (
 select 1 from public.client_invoices i where i.storage_path=storage.objects.name
 and (public.current_user_is_openfolk_operator() or exists (
  select 1 from public.client_portal_access a where a.tenant_id=i.tenant_id and a.profile_id=auth.uid()
 ))
));
commit;
