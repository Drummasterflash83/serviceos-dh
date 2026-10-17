-- Synthetic seam for a disposable schema clone. The production function uses
-- the real retained-source reader and review authority from earlier migrations.
create function public.learn_business_input_review_access(p_tenant uuid,p_connection uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
   or p_connection is distinct from 'eeee0000-0000-0000-0000-0000000000b1'
   or not exists(select 1 from profiles where id=auth.uid() and tenant_id=p_tenant and role in ('owner','admin'))
   or exists(select 1 from view_as_context where actor_user_id=auth.uid() and ended_at is null)
 then raise exception 'synthetic_review_forbidden' using errcode='42501';end if;
end $$;
create function public.learn_commusoft_source_job_rows(p_tenant uuid,p_connection uuid)
returns table(external_id text,version_id uuid,observed_at timestamptz,title text,source_status text,
 business_unit text,property_reference text,customer_reference text,company_name text,contact_name text,
 relationship_state text,customer_identity_state text,reviewed_job_id uuid)
language sql stable set search_path=public as $$
 select '123', 'eeee0000-0000-0000-0000-0000000000b2'::uuid,
   '2026-10-17T08:00:00Z'::timestamptz,'Synthetic job','on_hold',null,null,null,
   null,null,'property_source_missing','unreviewed',null::uuid
 where p_tenant='aaaa0000-0000-0000-0000-0000000000a1'::uuid
   and p_connection='eeee0000-0000-0000-0000-0000000000b1'::uuid;
$$;
