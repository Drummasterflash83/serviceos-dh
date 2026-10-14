-- TEST saatxzwxvdvqevbnskxy; no financial records or identity links seeded.
begin;
set local lock_timeout='5s';
set local statement_timeout='40s';
do $guard$ begin
if current_setting('serviceos.quickbooks_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'QuickBooks TEST target required';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.uid()') and md5(prosrc)='cdef18c69c4f4cbbced2eaf81e628b49' and pg_get_userbyid(proowner)='supabase_auth_admin') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('auth.role()') and md5(prosrc)='f31486fed08a7402e89d4aa71b0ad273' and pg_get_userbyid(proowner)='supabase_auth_admin') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_operator_input_access(uuid,uuid,boolean)') and md5(prosrc)='6b26e22470bfb077e0c61d312c55f713' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_import_batch_authority(uuid,uuid)') and md5(prosrc)='8010faf9b8dd341b7eda54d891d7b9b6' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_quickbooks_enabled(uuid)') and md5(prosrc)='bdd3136f37f38cfaa84f332ed6b47185' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.learn_operator_input_immutable()') and md5(prosrc)='5226d715d49ccaa8a0c61b39a08c294b' and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks finance prerequisite changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='tenant_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks finance column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.profiles') and attname='role' and not attisdropped and format_type(atttypid,atttypmod)='text') then raise exception 'QuickBooks finance column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.customer_cards') and attname='id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks finance column changed';end if;
if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.customer_cards') and attname='tenant_id' and not attisdropped and format_type(atttypid,atttypmod)='uuid') then raise exception 'QuickBooks finance column changed';end if;
if not exists(select 1 from public.learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1' and source_hashes='[{"name":"20261102000000_learn_quickbooks_oauth.sql","sha256":"344c2530955bb86a90fe7943060026661c9a8b68be467aa9f7c213afba50d046"},{"name":"20261102010000_learn_quickbooks_import.sql","sha256":"d801ba6a45af0570dd47312e8fb35552e3dfd085c130e7f5e7b3b5f9835e342c"}]'::jsonb) then raise exception 'QuickBooks foundation mismatch';end if;
end $guard$;
-- Explicit customer identity review and retained financial evidence. No imports,
-- automatic matching, credentials, access grants or provider writes are seeded.

create table public.learn_quickbooks_customer_links (
 tenant_id uuid not null references public.tenants(id),
 environment text not null check(environment in ('sandbox','production')),
 realm_id text not null,
 external_id text not null,
 card_id uuid references public.customer_cards(id),
 reviewed_version uuid not null references public.learn_quickbooks_source_versions(id),
 identity jsonb not null,
 revision bigint not null check(revision>0),
 reviewed_by uuid not null references public.profiles(id),
 reviewed_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,environment,realm_id,external_id)
);
create index learn_quickbooks_customer_card on public.learn_quickbooks_customer_links(tenant_id,card_id,environment);
create table public.learn_quickbooks_finance_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),event text not null,
 detail jsonb not null,reason text,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_quickbooks_customer_links enable row level security;
alter table public.learn_quickbooks_finance_events enable row level security;
revoke all on public.learn_quickbooks_customer_links,public.learn_quickbooks_finance_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_quickbooks_finance_events for each row execute function public.learn_operator_input_immutable();
create trigger retain_all before truncate on public.learn_quickbooks_finance_events for each statement execute function public.learn_operator_input_immutable();

-- Compare identity, not mutable accounting balances. Missing fields remain
-- distinct from supplied values; no fuzzy/name-only identity matching.
create function public.learn_quickbooks_customer_identity(p jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p)
 where key in ('Id','DisplayName','FullyQualifiedName','CompanyName','GivenName','FamilyName',
  'PrimaryEmailAddr','PrimaryPhone','Mobile','BillAddr','ShipAddr','ParentRef','Job','Active')
$$;
create function public.learn_quickbooks_money(p jsonb) returns numeric
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p)='number' and length(p#>>'{}')<=80
  and p#>>'{}' ~ '^-?[0-9]+(\.[0-9]+)?$' then (p#>>'{}')::numeric end
$$;
create function public.learn_quickbooks_finance_access(p_tenant uuid,p_reason text) returns void
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
 perform public.learn_quickbooks_enabled(p_tenant);
end $$;

-- Operator-only candidate listing. Exact version IDs are returned for review;
-- the client cannot substitute an older identity when saving a link.
create function public.learn_quickbooks_customer_candidates(p_tenant uuid,p_environment text,p_reason text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;next_id uuid;audit uuid;begin
 if p_reason is null or p_environment is null or p_environment not in ('sandbox','production') then
  raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 with page as materialized(
  select v.id,l.realm_id,l.external_id,l.conflicted,l.last_observed_at,v.payload,k.card_id,coalesce(k.revision,0) revision
  from public.learn_quickbooks_latest l join public.learn_quickbooks_source_versions v on v.id=l.version_id
  left join public.learn_quickbooks_customer_links k on (k.tenant_id,k.environment,k.realm_id,k.external_id)=(l.tenant_id,l.environment,l.realm_id,l.external_id)
  where l.tenant_id=p_tenant and l.environment=p_environment and l.entity='Customer'
   and (p_after is null or v.id>p_after) order by v.id limit 26
 ),shown as(select * from page order by id limit 25)
 select coalesce((select jsonb_agg(jsonb_build_object('version_id',id,'realm_id',realm_id,'external_id',external_id,
  'name',left(coalesce(payload->>'FullyQualifiedName',payload->>'DisplayName','Unnamed customer'),500),
  'email',left(payload#>>'{PrimaryEmailAddr,Address}',500),'phone',left(payload#>>'{PrimaryPhone,FreeFormNumber}',200),
  'address',left((payload->'BillAddr')::text,2000),'parent_id',left(payload#>>'{ParentRef,value}',200),
  'conflicted',conflicted,'last_observed_at',last_observed_at,'card_id',card_id,'revision',revision::text) order by id) from shown),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end into entries,next_id;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customers.read',jsonb_build_object('environment',p_environment,'after',p_after,'versions',
  (select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb) from jsonb_array_elements(entries)x)),btrim(p_reason)) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-customers/1','tenant_id',p_tenant,'actor_id',auth.uid(),
  'environment',p_environment,'after',p_after,'rows',entries,'next_after',next_id,'observed_at',clock_timestamp(),'audit_id',audit);
end $$;

-- Revision check supports reviewed correction/unlinking without overwriting a
-- concurrent decision. A null card unlinks; retained audit/history stay intact.
create function public.learn_quickbooks_customer_link(p_tenant uuid,p_version uuid,p_card uuid,p_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_quickbooks_source_versions%rowtype;k public.learn_quickbooks_customer_links%rowtype;rev bigint;audit uuid;begin
 if p_reason is null or p_revision is null or p_revision<0 then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 select s.* into v from public.learn_quickbooks_source_versions s join public.learn_quickbooks_latest l
  on l.version_id=s.id and l.tenant_id=s.tenant_id and l.entity=s.entity and l.environment=s.environment and l.realm_id=s.realm_id and l.external_id=s.external_id
  where s.id=p_version and s.tenant_id=p_tenant and s.entity='Customer' and not l.conflicted for share of l;
 if not found then raise exception 'quickbooks_customer_review_required' using errcode='40001';end if;
 if p_card is not null then
  perform 1 from public.customer_cards where id=p_card and tenant_id=p_tenant for share;
  if not found then raise exception 'quickbooks_card_unavailable' using errcode='42501';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('quickbooks-customer:'||p_tenant::text||':'||v.environment||':'||v.realm_id||':'||v.external_id,0));
 select * into k from public.learn_quickbooks_customer_links where (tenant_id,environment,realm_id,external_id)=(p_tenant,v.environment,v.realm_id,v.external_id) for update;
 if coalesce(k.revision,0)<>p_revision then raise exception 'quickbooks_link_changed' using errcode='40001';end if;
 rev:=p_revision+1;
 insert into public.learn_quickbooks_customer_links(tenant_id,environment,realm_id,external_id,card_id,reviewed_version,identity,revision,reviewed_by)
 values(p_tenant,v.environment,v.realm_id,v.external_id,p_card,v.id,public.learn_quickbooks_customer_identity(v.payload),rev,auth.uid())
 on conflict(tenant_id,environment,realm_id,external_id) do update set card_id=excluded.card_id,reviewed_version=excluded.reviewed_version,
  identity=excluded.identity,revision=excluded.revision,reviewed_by=excluded.reviewed_by,reviewed_at=clock_timestamp();
 perform public.learn_quickbooks_finance_access(p_tenant,p_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.link',jsonb_build_object('environment',v.environment,'realm_id',v.realm_id,'external_id',v.external_id,
  'version_id',v.id,'previous_card',k.card_id,'card_id',p_card,'revision',rev::text),btrim(p_reason)) returning id into audit;
 return jsonb_build_object('revision',rev::text,'audit_id',audit);
end $$;

create function public.learn_quickbooks_customer_finance(p_tenant uuid,p_card uuid,p_environment text default 'production',p_after uuid default null,p_operator_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare entries jsonb;totals jsonb;next_id uuid;record_count bigint;link_count bigint;review_count bigint;conflicts bigint;audit uuid;begin
 if p_environment is null or p_environment not in ('sandbox','production') then raise exception 'quickbooks_request_invalid' using errcode='22023';end if;
 perform public.learn_quickbooks_finance_access(p_tenant,p_operator_reason);
 perform 1 from public.customer_cards where id=p_card and tenant_id=p_tenant for share;
 if not found then raise exception 'quickbooks_card_unavailable' using errcode='42501';end if;
 with links as materialized(
  select k.*,l.conflicted is false and public.learn_quickbooks_customer_identity(v.payload)=k.identity as current_identity
  from public.learn_quickbooks_customer_links k left join public.learn_quickbooks_latest l
   on (l.tenant_id,l.environment,l.realm_id,l.external_id)=(k.tenant_id,k.environment,k.realm_id,k.external_id) and l.entity='Customer'
  left join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where k.tenant_id=p_tenant and k.card_id=p_card and k.environment=p_environment
 ),matched as materialized(
  select l.version_id,l.realm_id,l.entity,l.external_id,l.conflicted,l.last_observed_at,v.source_updated_at,v.payload,
   case when v.payload#>>'{CurrencyRef,value}' ~ '^[A-Z]{3}$' then v.payload#>>'{CurrencyRef,value}' end currency,
   public.learn_quickbooks_money(v.payload->'TotalAmt') amount,public.learn_quickbooks_money(v.payload->'Balance') balance
  from links k join public.learn_quickbooks_latest l on l.tenant_id=k.tenant_id and l.environment=k.environment and l.realm_id=k.realm_id
  join public.learn_quickbooks_source_versions v on v.id=l.version_id
  where k.current_identity and l.entity in ('Invoice','Payment','CreditMemo','SalesReceipt','Estimate') and v.payload#>>'{CustomerRef,value}'=k.external_id
 ),usable as materialized(select * from matched where not conflicted),
 page as(select * from usable where p_after is null or version_id>p_after order by version_id limit 26),
 shown as(select * from page order by version_id limit 25),
 grouped as(
  select realm_id,currency,entity,count(*) records,count(*) filter(where amount is null) missing_amounts,
   count(*) filter(where entity='Invoice' and balance is null) missing_balances,
   case when currency is not null and count(*) filter(where amount is null)=0 then sum(amount)::text end total,
   case when entity='Invoice' and currency is not null and count(*) filter(where balance is null)=0 then sum(balance)::text end outstanding,
   min(last_observed_at) oldest_observation,max(last_observed_at) newest_observation
  from usable group by realm_id,currency,entity
 )
 select coalesce((select jsonb_agg(jsonb_build_object('version_id',version_id,'realm_id',realm_id,'entity',entity,'external_id',external_id,
  'document_number',left(payload->>'DocNumber',200),'transaction_date',left(payload->>'TxnDate',32),'due_date',left(payload->>'DueDate',32),
  'currency',currency,'amount',amount::text,'balance',case when entity='Invoice' then balance::text end,
  'source_updated_at',source_updated_at,'last_observed_at',last_observed_at) order by version_id) from shown),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(g) order by realm_id,currency nulls last,entity) from grouped g),'[]'::jsonb),
  case when (select count(*) from page)>25 then (select version_id from shown order by version_id desc limit 1) end,
  (select count(*) from usable),(select count(*) from links),(select count(*) from links where current_identity is not true),
  (select count(*) from matched where conflicted)
 into entries,totals,next_id,record_count,link_count,review_count,conflicts;
 perform public.learn_quickbooks_finance_access(p_tenant,p_operator_reason);
 insert into public.learn_quickbooks_finance_events(tenant_id,actor_id,event,detail,reason)
 values(p_tenant,auth.uid(),'customer.finance.read',jsonb_build_object('card_id',p_card,'environment',p_environment,'after',p_after,
  'versions',(select coalesce(jsonb_agg(x->'version_id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'records',record_count),p_operator_reason) returning id into audit;
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','quickbooks-customer-finance/1','tenant_id',p_tenant,'actor_id',auth.uid(),'card_id',p_card,
  'environment',p_environment,'operator_mode',p_operator_reason is not null,'after',p_after,'rows',entries,'groups',totals,'next_after',next_id,
  'records',record_count,'linked_customers',link_count,'links_needing_review',review_count,'conflicted_records',conflicts,
  'coverage','retained_unreconciled_records','observed_at',clock_timestamp(),'audit_id',audit);
end $$;

revoke all on function public.learn_quickbooks_customer_identity(jsonb),public.learn_quickbooks_money(jsonb),
 public.learn_quickbooks_finance_access(uuid,text),public.learn_quickbooks_customer_candidates(uuid,text,text,uuid),
 public.learn_quickbooks_customer_link(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_quickbooks_customer_candidates(uuid,text,text,uuid),
 public.learn_quickbooks_customer_link(uuid,uuid,uuid,bigint,text),public.learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text) to authenticated;


insert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('quickbooks_customer_finance_v1','[{"name":"20261102020000_learn_quickbooks_customer_finance.sql","sha256":"d6b7c742b7520533ebdd0f1b5ce956fd91a7c37f75065a2a0abf692c84666a0f"}]'::jsonb);
notify pgrst,'reload schema';
commit;
