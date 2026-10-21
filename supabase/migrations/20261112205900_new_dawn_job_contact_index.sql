-- Read-only job-detail contact counts need a tenant/job/source lookup without
-- scanning the full interaction history. Run outside a transaction.
create index concurrently if not exists interactions_tenant_job_contact_idx
 on public.interactions (tenant_id,related_job_id,source_type)
 where related_job_id is not null and source_type in ('phone','email')
  and status='active';
