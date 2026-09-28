begin;

-- OpenFolk operating expenses, NOT client invoices. One row per provider account.
-- No credentials, guessed balances, automatic payments or enabled alert routes.
create table public.openfolk_cost_accounts (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider in ('vapi','openai','supabase','vercel','telephony','other')),
 account_ref text not null check(length(btrim(account_ref)) between 1 and 160),
 name text not null check(length(btrim(name)) between 1 and 100),
 currency text not null check(currency in ('USD','GBP','EUR')),
 billing_mode text not null check(billing_mode in ('prepaid','invoiced')),
 low_balance numeric not null check(low_balance>=0 and low_balance<=1000000000),
 stale_hours integer not null default 24 check(stale_hours between 1 and 168),
 version integer not null default 0,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(provider,account_ref)
);
create table public.openfolk_cost_clients (
 account_id uuid not null references public.openfolk_cost_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 primary key(account_id,tenant_id)
);
create table public.openfolk_cost_checks (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.openfolk_cost_accounts(id),
 version integer not null,
 observed_at timestamptz not null check(isfinite(observed_at)),
 balance numeric check(balance between -1000000000 and 1000000000),
 period_spend numeric check(period_spend between 0 and 1000000000),
 period_start date,
 period_end date,
 auto_reload text not null check(auto_reload in ('unknown','on','off')),
 payment_status text not null check(payment_status in ('unknown','okay','failed')),
 source text not null check(source in ('dashboard','invoice')),
 evidence text not null check(length(btrim(evidence)) between 1 and 500),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default now(),
 unique(account_id,version),
 check((period_spend is null and period_start is null and period_end is null) or
       (period_spend is not null and period_start is not null and period_end is not null and
        isfinite(period_start) and isfinite(period_end) and period_start<=period_end))
);
alter table public.openfolk_cost_accounts enable row level security;
alter table public.openfolk_cost_clients enable row level security;
alter table public.openfolk_cost_checks enable row level security;
revoke all on public.openfolk_cost_accounts,public.openfolk_cost_clients,public.openfolk_cost_checks from public,anon,authenticated;
grant all on public.openfolk_cost_accounts,public.openfolk_cost_clients,public.openfolk_cost_checks to service_role;

create function public.costs_require_operator(p_edit boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.current_user_is_openfolk_operator() or
    (p_edit and not public.current_user_is_openfolk_operator('platform.controlplane.admin')) then
   raise exception 'OpenFolk operator access required' using errcode='42501';
 end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>now())) then
   raise exception 'Leave client preview to access operating costs' using errcode='42501';
 end if;
end $$;

create function public.costs_add_account(p_provider text,p_ref text,p_name text,p_currency text,p_mode text,p_threshold numeric,p_clients uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare account uuid;
begin
 perform public.costs_require_operator(true);
 insert into public.openfolk_cost_accounts(provider,account_ref,name,currency,billing_mode,low_balance,created_by)
 values(p_provider,btrim(p_ref),btrim(p_name),p_currency,p_mode,p_threshold,auth.uid()) returning id into account;
 insert into public.openfolk_cost_clients(account_id,tenant_id) select account,t from (select distinct unnest(p_clients) t) clients;
 return account;
end $$;

create function public.costs_record_check(p_account uuid,p_version integer,p_observed timestamptz,p_balance numeric,p_spend numeric,p_start date,p_end date,p_reload text,p_payment text,p_source text,p_evidence text) returns integer
language plpgsql security definer set search_path='' as $$
declare next_version integer;
begin
 perform public.costs_require_operator(true);
 if p_observed is null or not isfinite(p_observed) or p_observed>now() then raise exception 'Check time must not be in the future'; end if;
 if p_end>current_date then raise exception 'Spend period cannot end in the future'; end if;
 update public.openfolk_cost_accounts set version=version+1 where id=p_account and version=p_version returning version into next_version;
 if next_version is null then raise exception 'Account changed. Refresh before saving.' using errcode='40001'; end if;
 -- A newer entry cannot silently replace a more recent provider observation.
 if exists(select 1 from public.openfolk_cost_checks where account_id=p_account and observed_at>p_observed) then raise exception 'A newer check is already saved'; end if;
 insert into public.openfolk_cost_checks(account_id,version,observed_at,balance,period_spend,period_start,period_end,auto_reload,payment_status,source,evidence,recorded_by)
 values(p_account,next_version,p_observed,p_balance,p_spend,p_start,p_end,p_reload,p_payment,p_source,btrim(p_evidence),auth.uid());
 return next_version;
end $$;

create function public.costs_overview() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.costs_require_operator();
 select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object(
   'clients',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.display_name) order by t.display_name) from public.openfolk_cost_clients c join public.tenants t on t.id=c.tenant_id where c.account_id=a.id),'[]'::jsonb),
   'latest',(select to_jsonb(s) from public.openfolk_cost_checks s where s.account_id=a.id order by s.version desc limit 1)
 ) order by a.name),'[]'::jsonb) into result from public.openfolk_cost_accounts a;
 return jsonb_build_object('accounts',result,'checked_at',now(),'automatic_monitoring',false);
end $$;
revoke all on function public.costs_require_operator(boolean),public.costs_add_account(text,text,text,text,text,numeric,uuid[]),public.costs_record_check(uuid,integer,timestamptz,numeric,numeric,date,date,text,text,text,text),public.costs_overview() from public,anon;
grant execute on function public.costs_add_account(text,text,text,text,text,numeric,uuid[]),public.costs_record_check(uuid,integer,timestamptz,numeric,numeric,date,date,text,text,text,text),public.costs_overview() to authenticated;
commit;
