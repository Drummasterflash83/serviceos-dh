-- Keep an exact, reversible projection of the latest retained Commusoft job
-- observation. The immutable source pages/versions/observations stay the truth.
-- No provider request, canonical link, client flag or direct read grant is added.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.new_dawn_commusoft_current_job_source (
 tenant_id uuid not null,
 connection_id uuid not null,
 external_id text not null,
 observed_at timestamptz not null,
 source_version_id uuid references public.learn_business_input_versions(id),
 source_page_id uuid references public.learn_business_input_pages(id),
 ambiguous boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 primary key(tenant_id,connection_id,external_id),
 constraint new_dawn_current_job_source_exact check (
  (ambiguous and source_version_id is null and source_page_id is null)
  or (not ambiguous and source_version_id is not null and source_page_id is not null))
);
create index new_dawn_commusoft_current_job_source_tenant
 on public.new_dawn_commusoft_current_job_source(tenant_id,observed_at);
alter table public.new_dawn_commusoft_current_job_source enable row level security;
revoke all on public.new_dawn_commusoft_current_job_source
 from public,anon,authenticated,service_role;

-- The original page writer inserts a page, its retained version, then its
-- observation in one transaction. The projection update shares that commit.
create function public.new_dawn_commusoft_current_job_source_observe()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;
 p public.learn_business_input_pages%rowtype;
begin
 select * into v from public.learn_business_input_versions where id=new.version_id;
 if not found then raise exception 'current_job_source_version_missing'; end if;
 if v.provider<>'commusoft' or v.collection<>'jobs' then return new; end if;
 select * into p from public.learn_business_input_pages where id=new.page_id;
 if not found or p.tenant_id is distinct from v.tenant_id
  or p.connection_id is distinct from v.connection_id
  or p.provider is distinct from v.provider
  or p.collection is distinct from v.collection then
  raise exception 'current_job_source_scope_mismatch';
 end if;

 insert into public.new_dawn_commusoft_current_job_source as current_row
  (tenant_id,connection_id,external_id,observed_at,source_version_id,
   source_page_id,ambiguous)
 values(v.tenant_id,v.connection_id,v.external_id,p.committed_at,v.id,p.id,false)
 on conflict(tenant_id,connection_id,external_id) do update set
  observed_at=excluded.observed_at,
  source_version_id=case
   when excluded.observed_at>current_row.observed_at
    then excluded.source_version_id
   when current_row.ambiguous
    or current_row.source_version_id is distinct from excluded.source_version_id
    then null
   else current_row.source_version_id end,
  source_page_id=case
   when excluded.observed_at>current_row.observed_at
    then excluded.source_page_id
   when current_row.ambiguous
    or current_row.source_version_id is distinct from excluded.source_version_id
    then null
   else current_row.source_page_id end,
  ambiguous=case
   when excluded.observed_at>current_row.observed_at then false
   else current_row.ambiguous
    or current_row.source_version_id is distinct from excluded.source_version_id end,
  updated_at=clock_timestamp()
 where excluded.observed_at>=current_row.observed_at;
 return new;
end $$;
revoke all on function public.new_dawn_commusoft_current_job_source_observe()
 from public,anon,authenticated,service_role;
create trigger new_dawn_commusoft_current_job_source_observe
 after insert on public.learn_business_input_observations
 for each row execute function public.new_dawn_commusoft_current_job_source_observe();
commit;
