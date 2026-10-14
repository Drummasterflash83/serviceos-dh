# Slack conversation-to-work context

## Reviewed selection release, 14 October 2026 04:54 UTC

**14 October, 05:54 BST — bounded reviewed-context selection deployed in LIVE.**

- The existing learning selector now reserves up to one fifth of a batch for
  recorded Slack context reviews whose retained source revision still matches.
  Remaining capacity continues oldest-first processing; unused review slots return
  to historical work. Mapper-ledger exclusion and the 1–200 batch bounds remain.
- Exact LIVE readback selected the two recently reviewed messages plus twenty-three
  historical records. The 25-row read took **129 ms** on current production data.
  Selector ownership, service-only permissions and invocation security remain
  unchanged; the search path is now fixed. Source/review and schedule fingerprints
  passed before/after comparison. No jobs were manually enqueued or restarted.
- The final isolated full-schema rehearsal passes selection fairness, stale sources,
  retained tombstones, tenant isolation, mapper states, limits, target/checksum
  guards, injected failure after replacement and exact rollback/reapply. All
  1,591,601 archived rows across 387 tables and seven sequences remain intact.
  Two earlier rehearsal-only rollback packaging issues were fixed before promotion.
- Hosted TEST lacks the activation selector prerequisite and was not changed. This
  is isolated production-schema validation plus LIVE readback, not hosted TEST
  acceptance. **Normally scheduled ingestion and downstream observation acceptance
  remain pending**; selection alone does not establish learning completion.

[Release and preservation evidence](evidence/learn-reviewed-ingestion-selection-live-2026-10-14.json)
· [Exact release and rollback](../../supabase/release/learn-production-patches/reviewed-ingestion-selection-v1/README.md).

## Latest timeline acceptance and queue diagnostic, 14 October 2026 04:42 UTC

**14 October, 05:42 BST — two more public Slack messages connected to LIVE customer/job context.**

- Reviewed two complete retained messages that explicitly concern one published
  Commusoft job: a parts-location question and a follow-up reporting the stock
  movement. Existing logged OpenFolk controls saved two immutable review receipts.
  No provider calls, new permissions, schema change or runtime release were needed.
- LIVE customer and job timelines both show the two messages. Full retained source
  reading and customer-to-job-to-customer navigation pass. Original message text,
  source-version hashes, Slack author attribution and unknown direction remain
  intact; the customer is derived through the current reviewed job ownership.
- Review scope requires exact-version public-channel capture proof. DMs, private
  and shared channels are excluded. Reported stock movements/prices remain source
  statements, not independently verified inventory or performance measurements.
- Downstream learning is **not yet accepted for these two messages**. They have no
  ingestion ledger or matching single/batch ingestion job at this check. The
  existing five-minute selector is active and orders oldest first; **23,764 enriched
  interactions** await a current-mapper ledger. The earlier four Slack recovery
  observations still pass source/job binding, zero-action and preservation checks.
- Next processing work: provide bounded priority for explicit context reviews while
  continuing historical ingestion. The source-link result does not close this gate.
  Operator job selection also currently requires paging through UUID-ordered jobs;
  a usable job search remains needed for review at scale.

[Public Slack context and handoff evidence](evidence/learn-public-slack-job-links-2026-10-14.json).

## Latest repair, 14 October 2026 01:14 UTC

The LEARN-only evidence ceiling is now deployed in LIVE worker v74 and TEST v26.
It preserves Drummonds' assisted mode and human-review requirements while forbidding
execution for this delivery. Exact artifact readback and auth guards pass; the
full-schema assisted-mode and recovery journeys preserve all retained rows.

All four original reviewed-message observation jobs stopped at the old mode gate.
A bounded audited maintenance recovery retained those parents and source hashes,
queued four identical-payload children and rebound their unobserved ingestion
ledgers. At 01:14 UTC all four children are still queued. No new observation is
claimed until the exact child receipt, source binding, graph job link and zero
execution are verified. The generic operator retry control is still a placeholder;
earlier references to recovering these jobs through existing controls were plans,
not proof that such a control was implemented.

See [recovery procedure](LEARN-OBSERVATION-RECOVERY.md) and
[release evidence](evidence/learn-observation-mode-live-2026-10-14.json).

## Latest learning diagnostic, 14 October 2026 00:52 UTC

All four reviewed messages now have durable ingestion ledgers. The first downstream
observation failed with `learn_observation_mode_review`; three remain queued. The
current platform default is discovery, but Drummonds has a tenant-wide assisted
mode override. The LEARN observation handler requires `mode_observe_only` and therefore
rejects this result before publication. No new observation has been verified.

The four source-bound timeline links remain valid and unchanged. Do not replay their
reviews or alter Drummonds' global autonomy just to pass this gate. Complete the
LEARN-only non-executing observation path, verify its audit and unchanged permissions,
then recover the original failed delivery through the existing logged controls.

## Timeline acceptance, 14 October 2026 00:24 UTC

Four full retained public Slack conversations now have logged, source-revision-bound
reviews against three corroborated canonical jobs and their current site/customer
provenance. Readback verifies four committed receipts, unchanged source hashes,
unknown direction and unchanged customer-speaker attribution. Signed-in LIVE shows
all four on the customer timeline and the first on its job timeline. The existing
customer job-context reader is therefore accepted for these actual relationships.

The scheduled intelligence selector queued the first new review at 00:15 UTC; that
exact job remains queued at 00:23 UTC, while other ingest jobs are succeeding.
No new observation is verified yet. Do not restart it or describe the link itself
as an AI finding. The standalone candidate helper remains unwired: this is explicit
review, not automatic matching or comprehensive coverage. Timeline source excerpts
are available; a full original Slack source reader remains unfinished.

See [aggregate evidence](evidence/learn-slack-reviewed-context-live-2026-10-14.json)
and the authoritative completion checklist. Earlier observations below are historical
and do not override this later acceptance.

## Historical inspection, 13 October 2026

The initial diagnostic made no production mutations, paid AI or UI changes.

## Current evidence

Aggregate-only production check at 11:30 UTC:

- 1,233 retained Slack messages: 857 conversations and 376 channel activities.
- 857 canonical interactions: 668 pending and 189 held for `direction_unverified`.
- Zero customer/person/job links and zero recorded Slack work-context reviews.
- Zero canonical Drummonds jobs and zero job-number aliases at this check. Provider records retained in the Commusoft input store are not automatically published canonical jobs.
- One message had a strict prefixed numeric job-reference candidate; it had no canonical job match. This is a limited diagnostic pattern, not a complete count of job references or a claim that only one message concerns a job.

The counts are a timestamped snapshot while capture continues. The private aggregate receipt is `.verification-results/slack-context-diagnostic-20261013.json`; it contains no message bodies, customer names or provider credentials.

## Existing path and missing connections

1. **Retention and projection work.** Slack page commits preserve message/version evidence and project conversation messages into `interactions`; channel activity is retained without inventing a conversation. The interaction receives `direction='unknown'`, a source-version hash and bounded preview. Slack authors are staff participants, not customer identities.
2. **Generic identity processing cannot establish Slack work context.** `learn_identity_pending` selects pending/ready interactions. `learn_identity_deliver_internal` requires a verified inbound/outbound direction and external contact identifier; unknown-direction Slack rows become identity-review holds. Repeated identity jobs cannot resolve this absence. A review hold also prevents the current identity handler from continuing its successful batch, although later scheduled batches can still run.
3. **The job-reference extractor is not connected.** `extractJobReferences` in `_shared/imports/job_number.ts` is currently used by its verification script, not a Slack matching worker. Its prefixed regex can match prefixes inside words or truncate a long digit run; do not use it for automatic publication without boundary/length fixes. A number alone is not sufficient evidence for a link.
4. **Canonical jobs are a prerequisite.** Commusoft publication creates tenant- and connection-scoped canonical jobs with explicit customer/site ownership and retained source-version provenance. A retained Commusoft API row must complete that publication path before a Slack job link can be confirmed.
5. **An audited operator path already exists.** `learn_operator_slack_context` previews current source/job state; `learn_operator_slack_context_review` records an explicit source-revision-bound company-context or job-context decision. It sets `related_job_id` and marks the interaction enriched, with idempotent receipts and source-edit invalidation. It does not establish a customer identity, create a customer card, or copy the job's owner into person/company attribution.
6. **Existing readers have narrower relationships.** Job-card communication reads use `related_job_id`; customer-card reads use person/company attribution. Merely reviewing a job link does not make that Slack message appear on a customer card. Business-graph interaction sync currently reads person/company links and has no job relationship projection.
7. **The learning handoff exists, but needs live acceptance for Slack.** Enriched interactions can be selected by the scheduled intelligence bridge. Reviewed work context is recognised by eligibility and included in the observation draft, which also carries `job_id`. A review is not itself evidence that the scheduled observation was accepted. No Slack context had yet been reviewed at this check. The generic Evidence model still labels Slack as future and has no Slack adapter; retained Slack source/version evidence nevertheless exists in its own tables.

Relevant implementation: `20261101600000_learn_slack_work_context.sql`, `_shared/worker_handlers/identity_resolve.ts`, `_shared/learn_work_context.ts`, `_shared/observation_ingest.ts`, `_shared/worker_handlers/business_graph_sync.ts`, and `src/lib/learn-card-communications.ts`.

## Smallest safe production acceptance

1. Finish a bounded reviewed Commusoft publication with one real canonical job, its customer/site relationship and source-version receipt. Verify the source account and provider identifiers; do not create a placeholder just to make the demo link succeed.
2. Use the existing logged OpenFolk read controls to find one retained Slack conversation that explicitly refers to that job. Inspect the complete relevant source and thread, not only its 2,000-character interaction preview. If no verifiable example exists yet, keep capturing and report that honestly.
3. Preview and apply the existing operator work-context review using its exact current revision and a concrete evidence reason. Do not impersonate the Slack author or claim the staff author is the customer. Preserve unknown communication direction.
4. Verify the existing job-card communication reader returns that exact source, while a different tenant cannot read it. Retain before/after review receipts; repeat the same request and prove no duplicate mutation.
5. Observe the existing scheduled intelligence selector/worker and retained observation receipt. Check source revision and job reference. Do not call a recorded link an AI finding or enable paid processing merely to finish this check.

This establishes one verified end-to-end path without changing the customer card design. Company-level technical discussions can separately be reviewed as company context; they must not be forced onto an arbitrary customer or job.

## Proposed scalable implementation, for parent review

- Add a bounded **read-only work-context candidate stage**, separately from customer identity resolution. Read full retained Slack text, source/version, team/channel/thread provenance and canonical job/provider-link records within one tenant. Return candidates and explicit unresolved/ambiguous reasons; initial release does not publish links automatically.
- Extract explicit job labels or verified provider URL patterns with whole-token boundaries. Resolve exact identifiers within the reviewed provider connection. Reject partial digit matches, phone numbers, prices, years, unrecognised domains and conflicting/multiple jobs. Names, channel titles, staff authors and semantic similarity may offer review hints but cannot become proof.
- Bind each candidate to the current Slack source hash plus canonical job and its provider source-version link. Recheck all bindings at application time. Reuse the existing operator review transaction for initial accepted links; preserve existing reviewed decisions rather than overwriting them.
- A later automated exact-reference path requires its own explicit policy and recorded decision type. It must never fabricate `reviewed_by` or use the existing human-review marker for machine decisions. Keep uncertain and multi-job conversations in review, rather than choosing one.
- Keep **job context** distinct from **customer speaker identity**. To surface job-linked Slack on existing customer communications, derive the relationship through the canonical job's verified customer ownership and expose the provenance as job context. Do not populate `related_person_id` as if that customer authored an internal Slack message. Hold disputed or stale ownership.
- Separate Slack work-context backlog from external identity holds so unrelated email/phone progress is not stopped by unresolved internal conversations. Introduce this only with queue settlement/retry tests; do not silently consume unresolved review items.
- Thread replies may inherit a reviewed parent job only through an explicit recorded policy, exact same workspace/channel/thread, fresh parent/source bindings and no conflicting reference. Otherwise each reply remains unlinked. Source edits invalidate affected decisions and observations.

No new UI is proposed here. Expanded customer-card presentation remains held for the user's design discussion.

## Prepared pure candidate implementation

`supabase/functions/_shared/slack/slack_job_context.ts` now provides a bounded read-only proposal builder with 12 passing tests in `slack_job_context.test.ts`. It is **not wired to a hosted reader, worker, scheduler or publisher**.

It accepts a current retained public conversation and its matching interaction revision, plus exact lookup results carrying canonical job, connection and latest provider-version proof. A single explicit job reference and unique current proof produces `candidate_review_required`; all other conditions are explicit holds. Unknown direction is returned unchanged, attribution remains unchanged, and no `reviewed_by` or reviewed `work_context` is fabricated. Existing context is preserved. Deleted messages, private channels and DMs are excluded from this public-history proposal. URL patterns and implicit reply inheritance remain unsupported rather than guessed.

The runtime shell still needs an authenticated logged tenant-scoped reader that constructs these proofs from database records, not caller assertions. It must recheck the existing operator review revision immediately before publication. A pure proposal is not authorisation and is not a committed link.

## Required acceptance before automatic linking

- Synthetic exact-reference, money/phone/year, embedded-prefix, too-long-number, conflicting-reference and unknown-domain cases.
- Same identifier in two tenants or provider connections cannot leak or silently select a target; duplicate canonical matches remain ambiguous.
- Missing job/customer publication, changed provider source, edited Slack source, changed job ownership, revoked provider access and paused capture are distinguishable holds.
- Tenant isolation, authenticated operator access/auditing, no DMs/private-channel expansion, and full source-history preservation.
- Duplicate/concurrent application, lost response inspection, immutable receipts and manual decision protection.
- Correct thread provenance; parent linkage never spreads across channels or overrides an explicit conflicting reply.
- Existing email/phone identity and queue continuation remain functional with Slack review items present.
- Existing job and customer communication readers show only proven relationships, without pretending internal authors are customers.
- One real scheduled Slack review-to-observation receipt, plus source-edit invalidation, before declaring the complete learning path accepted.

## Follow-up candidate check, 13 October 11:57 UTC

The refreshed bounded scan covered all 2,391 messages retained at 11:55 UTC (maximum scan 5,000). It found 45 conversations with explicit numeric job-reference patterns, with no reference to the first published example job 13164. These are candidate patterns, not accepted links.

The initial regex recognised only job 13356 in one recent conversation; this was not a claim of complete job-reference coverage. Read-only checks inside the database confirmed its current source revision, matching interaction, retained latest Commusoft job version, numeric property reference 1644 and latest customer-property version. Neither target was yet canonically published at this check. Subsequent logged live source review rejected it as a whole-message job-link candidate: it is a weekly StockBot summary covering multiple customers/jobs, including JN12952 missed by the initial parser. The parser now supports JN forms and its multi-job summary regression test holds this shape. The canonical customer/job publication can stand independently; no Slack linkage follows from this rejected candidate.

Private metadata-only receipts: `.verification-results/slack-context-candidates-20261013.json` and `.verification-results/slack-context-selected-receipt-20261013.json`. Automatic approval review rejected a proposed local copy of complete source bodies; that copy was not retried. The successful alternative returned boolean checks and reference IDs only, with no message bodies or customer records exported.

### Exact existing customer communication reader

`readLearnCardDetail` in `src/lib/learn-cards.ts` selects the customer's canonical person/company scope, then `readCardCommunications` in `src/lib/learn-card-communications.ts` calls `learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])`. The current SQL body is in `20261101380000_learn_email_draft_eligibility.sql` and remains owned by the restricted `learn_card_communication_reader` role.

Both database predicate and frontend scope validation currently accept only direct person/company links for a customer scope. To include job-owned communications safely, extend this existing reader with a bounded same-tenant join through the canonical job's customer ownership and current reviewed provider provenance. Add explicit job-context provenance fields to the response and its validator; do not write a customer speaker identity onto the Slack interaction. The reader role presently has no jobs/provider-provenance privileges, so the required narrow helper or column grants and RLS must be separately tested. Preserve limits, draft/deletion filters, direct communication behaviour and tenant isolation. No UI expansion is required for the relationship model. The subsequent reader implementation is now prepared and verified offline; see `LEARN-SLACK-CUSTOMER-JOB-CONTEXT.md`. It is not yet deployed.
