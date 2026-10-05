# Intelligence Ingest Bridge (interaction → `intelligence.observe`)

**Where this sits.** This bridge is the **Observation-stage seam** of the
[Core Loop](../architecture/02_CORE_LOOP.md) (stage 2, Interaction to
Observation). It maps a canonical **Interaction** into an **ObservationDraft** and
enqueues `intelligence.observe`, which produces an **Observation** (a row in
`intelligence_objects`, tracked by the `intelligence_ingestions` ledger); that
Observation is then the input the Decision Engine turns into a **Decision** (a
**Decision Package**, `decision_log`). Vocabulary follows
[00_GLOSSARY](../architecture/00_GLOSSARY.md).

> **One loop, two vocabularies.** This Observation to Decision path and the
> deterministic v1 card and recommendation path in
> [INTERACTIONS_IDENTITY_CARDS](./INTERACTIONS_IDENTITY_CARDS.md) are **the same
> Core Loop expressed two ways, not rival systems**. The v1 wave gave a Card and a
> Recommendation directly from identity rules; the intelligence wave inserts an
> explicit Observation and Decision. See the reconciliation table in
> [02_CORE_LOOP](../architecture/02_CORE_LOOP.md) ("One loop, two vocabularies")
> for how each stage lines up.

Step 1 of the horizontal inbound-communication intelligence capability. This is the
seam that connects the canonical `interactions` projection to the existing
`intelligence.observe` Decision Package pipeline. It is **channel-neutral, reusable, and
carries no customer-, industry-, connector- or service-specific logic**.

```
inbound (email | phone | chat | form | …)
        ↓  (existing connectors + interactions_sync / phone_enrich)
interactions  ── the UNIVERSAL inbound boundary (connector-agnostic row)
        ↓  (existing identity_resolve + customer_card_sync + business_graph_sync)
interactions.processing_status = 'enriched'  + customer_cards + graph_nodes
        ↓  ★ THIS BRIDGE ★  intelligence.ingest_interaction
channel-neutral ObservationDraft
        ↓  intelligence.observe   (unchanged: the SOLE path to a Decision)
Observation (intelligence_objects, via intelligence_ingestions ledger)
        ↓  Decision Engine
immutable Decision Package (decision_log) → existing review routing
```

## Design principles

- **`interactions` is the universal inbound boundary.** Phone, email and every future
  connector project into the same row, so the bridge maps _interactions_, not channels.
- **The bridge is channel-neutral.** The pure mapper never branches on `source_type`.
  Channel and source references travel only in **provenance**; they never change the
  evaluation algorithm (subject shape, scores, domain, structure). Two interactions that
  differ only by channel produce ObservationDrafts that differ only in provenance.
- **`intelligence.observe` remains the sole path to a Decision.** The bridge only
  _enqueues_ `intelligence.observe`; it never calls the Decision Engine directly and
  never creates an Automation Intent or any external side effect. The Observation it
  yields is an **Intelligence Object** (`object_type` observation in
  `intelligence_objects`); its `source_entities` are **resolved graph nodes**, not raw
  identifiers.
- **Scheduling / backfill is deliberately deferred (Step 1b).** The handler processes an
  **explicit, bounded** set of interaction ids only — it never sweeps history. No cron is
  enabled until the bridge is proven.

## Modules

| Layer        | File                                                                                          | Responsibility                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure core    | `supabase/functions/_shared/observation_ingest.ts`                                            | `buildObservationDraft` (deterministic mapper), deterministic key builders, eligibility predicate, and `ingestInteractions` (pure-by-injection orchestrator). No DB/queue/event imports. |
| Impure shell | `supabase/functions/_shared/worker_handlers/intelligence_ingest.ts`                           | Handler `intelligence.ingest_interaction`: tenant-scoped loaders, ledger claim, deterministic-key recovery, and `enqueueJob("intelligence.observe")`.                                    |
| Ledger       | `supabase/migrations/20260724120000_intelligence_ingestion_ledger.sql`                        | `intelligence_ingestions` — the atomic idempotency/lineage table.                                                                                                                        |
| Tests        | `observation_ingest.verify.ts` (unit), `observation_ingest.integration.ts` (in-process proof) |                                                                                                                                                                                          |

## Handler contract

`job_type: intelligence.ingest_interaction`, payload:

```jsonc
{
  "interaction_id": "<uuid>",           // or:
  "interaction_ids": ["<uuid>", ...],   // bounded (cap DEFAULT_MAX_BATCH = 25)
  "mapper_version": "obs-ingest/1",     // optional; defaults to MAPPER_VERSION
  "domain": "core"                      // optional; horizontal default
}
```

Returns per-interaction results: `{ interactionId, outcome: observed|reused|rejected,
idempotent, ingestionId, observeJobId, observeJobType: "intelligence.observe", channel,
reason? }`.

## Idempotency & concurrency model

One interaction produces **at most one logical Observation per mapper version**, safe
under concurrent workers, retries, and post-enqueue timeouts:

1. **Atomic claim.** The ledger's `unique (tenant_id, interaction_id, mapper_version)` is
   a single-writer gate: exactly one worker wins the `INSERT`; concurrent/retry workers
   hit the conflict (`23505`) and take the **reuse** path with the existing row.
2. **Deterministic observe job key** `intelligence.observe:{tenant}:{interaction}:{mapper}`.
   The queue's active-job-key uniqueness collapses duplicate enqueues to one active job.
3. **Crash-window recovery.** If a worker claimed the ledger row but crashed before/around
   the enqueue (so `observe_job_id` is unrecorded), the reuse path first looks up the
   observe job by its deterministic key **in any status** (`platform_jobs` rows are
   durable). A completed observe job is found and reused — never re-enqueued — so a second
   Observation cannot be created. Only a genuine orphan (no job ever enqueued) enqueues.
4. **Tenant isolation.** All loaders are tenant-scoped and the pure mapper rejects any
   cross-tenant interaction/card reference (`IngestTenantMismatchError`).
5. **No history sweep.** Only the ids passed in the payload are touched, bounded by cap.
6. **Failure isolation.** Each id is handled independently; one failure never aborts the
   batch.

`mapper_version` participates in every key: bumping it is an intentional re-mapping that
may legitimately produce a new logical Observation — never a silent duplicate.

## Provenance model

The ObservationDraft preserves the original channel and source references without letting
them influence evaluation:

- `source_interactions: [interaction.id]` and `evidence[]` carry the source-of-record
  references (`source_table`, `source_id`, `source_external_id`), never fabricated content.
- `source_entities` carries resolved `graph_nodes.id` (interaction/person/company).
- `attributes.channel`, `attributes.source`, `attributes.direction` hold provenance.
- `attributes.resolution` / `attributes.customer_context` are **honest about absence**
  (`null` when the customer is unresolved), and `attributes.ingest` records the mapper
  version + deterministic ingest key.
- `created_from: "intelligence.ingest_interaction"`.

The `intelligence_ingestions` ledger row additionally records `observe_job_id`,
(`observation_id`, backfilled later), `domain`, `correlation_id`, and `status`.

## Scores

Confidence/ambiguity/risk/reversibility are **preserved or deterministically derived**
from the presence of resolution/context — never from channel:

- confidence: the customer card's confidence when present, else `0.7` (resolved) / `0.5`.
- ambiguity: `0.2` (resolved) / `0.5` (unresolved).
- risk: `0.2` (an inbound observation proposes nothing external yet).
- reversibility: `0.9` (any downstream response is a reversible internal note).

## Verification

- `node supabase/functions/_shared/observation_ingest.verify.ts` — pure unit checks
  (channel neutrality, determinism, idempotency, concurrency, crash-window recovery,
  cross-tenant rejection, honest absence, bounded batching, failure isolation).
- `node supabase/functions/_shared/observation_ingest.integration.ts` — controlled
  in-process proof that one email-shaped and one phone-shaped interaction each reach
  `interaction → bridge → intelligence.observe payload → DecisionPackage / review routing`
  through the **real** pure Decision Engine, with no bespoke rule.

## Deferred (not in Step 1)

Honestly, the following are **not** built here:

- Step 1b: scheduled enqueuer + `interaction.enriched`/backfill trigger (no cron yet).
  The handler still processes only an explicit, bounded set of interaction ids.
- Steps 2 to 4: `review_resolve` for Decision Packages, executable Automation Intents,
  approval API. Documented in the build plan; not implemented here.

## See also

- [02_CORE_LOOP](../architecture/02_CORE_LOOP.md): stage 2 (Observation) and the
  one-loop-two-vocabularies reconciliation table.
- [00_GLOSSARY](../architecture/00_GLOSSARY.md): Observation, Intelligence Object,
  Decision, entity/node.
- [INTERACTIONS_IDENTITY_CARDS](./INTERACTIONS_IDENTITY_CARDS.md): the deterministic
  v1 card and recommendation path this shares its loop with.
- [DECISION_ENGINE](./DECISION_ENGINE.md): what consumes the Observation.
