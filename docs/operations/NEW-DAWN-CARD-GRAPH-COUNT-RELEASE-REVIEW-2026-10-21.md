# Customer-card graph read: release review (21 October 2026)

**Source-only candidate.** No LIVE database migration, Edge publish, job
retry, scheduler change or card-data write has been performed from this
branch. The ordinary scheduled customer-card work must be allowed to retry
after a reviewed release; do not enqueue a duplicate manually.

## Failure and resulting behavior

LIVE `platform-worker` v114 emitted `card_read_failed` at
`graph_edges_prefetch`, SQLSTATE `57014`, on the ordinary 03:45 and 03:50 UTC
attempts. The saved projections remain intact, but the sweep is stale. The
source prefetch currently combines 40 `from_node_id` and 40 `to_node_id`
filters with a broad OR, globally orders matching edge rows by UUID `id`,
and fetches every edge page to count per-person relationships. This is the
exact read removed by this change. The LIVE query plan has **not** been
observed, so the precise cause of PostgreSQL's cancellation is unproven.

The replacement `learn_customer_card_relationship_counts(uuid,uuid[])`
accepts at most 40 distinct, tenant-owned `person`/`people` graph node IDs
from `service_role`. It counts outbound and inbound edges with the existing
`graph_edges_tenant_from_idx` and `graph_edges_tenant_to_idx` indexes and
returns exactly one count per node. It transfers no edge rows, performs no
global edge-ID sort and has no unbounded page loop. The worker validates the
entire response before writing any card. A missing, duplicate, foreign,
negative or fractional count fails closed and retains the prior projection.
The count preserves the old semantics: all edge statuses, one count per
selected endpoint, self-loop +2, and cross-batch edges counted once for each
endpoint's card.

## Exact source and order

1. Install `supabase/migrations/20261112190000_new_dawn_card_graph_degree_counts.sql`
   **only after explicit LIVE migration review/authority**. SHA-256
   `8176fecdf713f208aeee691fdbb778b11981fd079ead07997e6001d7c5b124f0`.
   It creates one read-only RPC and service-role-only EXECUTE grant; no row,
   index, role membership or client access changes.
   The exact one-transaction installer and readback are
   `scripts/verify/new-dawn-card-graph-count-release.mjs`. Its LIVE read-only
   preflight found both endpoint indexes, no RPC and no migration ledger row.
   The installer requires the exact project and SQL hash, then re-reads grants
   and the ledger; an uncertain write is never replayed automatically.
2. After verifying the RPC on LIVE, publish the handler change in
   `supabase/functions/_shared/worker_handlers/customer_card_sync.ts`
   through the scheduled `platform-worker` and direct `customer-card-sync`
   routes that use the shared handler. The branch now includes the diagnostic
   source merged through PR #336, including sanitized stage/SQLSTATE logging.
   Merged handler SHA-256: `c27087645192966b7f7ef019f27e9c45556afb898b0d1cfdaa5d96a3cadd4a63`.
   Repackage against the archived LIVE v114 body and verify the candidate's
   exact executable hash before publishing. Do not publish this
   source before the RPC exists or restore an older Edge package accidentally.
   A staged v114 package changing only that handler compiled in the pinned
   local runtime (ESZIP SHA-256
   `994bafc61093af0068ff588fd514eab33a3e3a158b57c06c519e0591d04b572c`)
   and booted without network or real credentials; its unauthenticated probe
   returned 403. This is not a LIVE publish or signed-in card readback.
3. Observe the ordinary next `customer_card.sync` job and its card counts,
   source freshness and sanitized error stage. Do not infer success from a
   queued row or from an Edge publish alone. If another `57014` occurs,
   preserve the logged stage/SQLSTATE and investigate that precise read.

Rollback is the prior shared handler/Edge package; leaving this inert
read-only RPC installed does not change card data. No card projection should
be marked current until an ordinary job completes and saved card timestamps
advance. Check service-role RPC grants and absence of anon/authenticated
EXECUTE before any Edge publish.

## Evidence and limits

- `node --test scripts/customer-card-refresh.test.mjs scripts/verify/learn-build01-card-revision-conflict.test.mjs`: 17/17 after merging PR #336. Includes a
  500-card sweep in 50 bounded ten-card batches, cross-batch and self-loop parity,
  second-batch failure with zero card writes, malformed response guards and
  existing per-card projection behavior.
- Disposable PostgreSQL 17:
  `scripts/verify/customer-card-graph-counts.synthetic.sql` passed exact
  degree, tenant/type, 40-node limit and anonymous-denial checks.
  `scripts/verify/customer-card-graph-plan.synthetic.sql` used 202,000
  synthetic edges. The old OR query selected a BitmapOr/index plan and ran
  in ~0.7 ms; the proposed 40-node indexed lateral count ran in ~0.5 ms.
  This supports the new bounded plan but **does not reproduce or explain**
  the LIVE 57014 under production volume and load.
- TypeScript `tsc --noEmit` passed. This is a source/test candidate only;
  LIVE migration, Edge readback and completed scheduled-job evidence remain
  release gates.
- The exact installer adds three focused tests; the combined handler and
  installer suite is 20/20 after merging current `main`.
