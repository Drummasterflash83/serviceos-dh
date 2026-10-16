-- Only if a release readback or later workload measurement requires rollback.
-- Run as a single autocommit statement.
DROP INDEX CONCURRENTLY public.learn_identity_ready_order_idx;
