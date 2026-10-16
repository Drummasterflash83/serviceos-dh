-- Index-only card reads for a company with a large retained interaction history.
-- Built concurrently on TEST and LIVE to avoid blocking source publications.
create index concurrently learn_card_company_cover_idx
  on public.interactions (tenant_id,related_company_id)
  include (id,interaction_type,direction,occurred_at,sentiment,
           source_type,source_table,source_id,status);
