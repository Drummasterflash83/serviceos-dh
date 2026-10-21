# LIVE identity and customer-card reliability diagnosis

On 21 October 2026, the ordinary Drummonds identity and customer-card jobs
reached attempt 4/5 with generic `identity_inventory_unconfirmed` and
`card_sync_error` results. All 4,683 active cards still had saved projections;
the current card sweep had not refreshed 4,582 before its cursor. Identity had
no `pending` or `ready` interactions at the read-only snapshot, while 105,366
interactions were durably held for identity review. Do not turn these holds into
successful work or manually enqueue duplicate jobs.

The worker now adds only a fixed `diagnostic_stage` and a five-character
SQLSTATE, when available, to the existing durable failure result. It does not
store database error prose, query text, source IDs or private customer content.
The existing retry and dead-letter behavior is unchanged. Identity stages are
`pending_inventory`, `delivery` and `review_count`; customer-card stages are
`graph_target`, `target_cards`, `people_prefetch`, `company_prefetch`,
`graph_nodes_prefetch` and `graph_edges_prefetch`. Per-card projection failures
remain separately reported as `card_partial_failure`.

After the same-source Edge worker is released, allow the normal scheduled job
to run once. Read only its status, attempt, safe code, stage and SQLSTATE. A
successful scheduled run is the acceptance evidence; an error stage guides a
bounded source fix or isolated restore reproduction. If the result remains
ambiguous, hold further changes rather than treating the old projections as a
fresh successful sweep. No provider call, staff login or customer-visible score
is added by this diagnostic change.
