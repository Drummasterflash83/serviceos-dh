-- Build 01: accelerate the existing tenant-scoped identity pending selector.
-- Run as a single autocommit statement; CONCURRENTLY cannot run in a transaction.
CREATE INDEX CONCURRENTLY learn_identity_ready_order_idx
  ON public.interactions (tenant_id, occurred_at, id)
  WHERE processing_status IN ('pending', 'ready');
