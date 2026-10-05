# Evidence Layer V1

**Status:** Gate 0 complete (model defined + lossless/reversible conformance proven, read-only). Gates 1–2 pending approval.
**Principle:** Evidence is a foundational platform primitive, not a feature. Every downstream object (Observation, Recommendation, Learning, Knowledge) must ultimately trace to immutable Evidence. Nothing is built or deployed that breaks that chain.

## Why (the three gates)

1. **Smarter** — full, hashed, versioned raw capture makes the system *reprocessable*: every future parser/extractor improvement can re-derive history instead of starting blind. It stops intelligence loss (e.g. discarded email headers).
2. **Trustworthy** — an immutable, content-hashed record with provenance turns "we think this came from somewhere" into "here is the byte-identical source, its hash, and the extractor that read it." Precondition for auditability.
3. **Autonomous operations** — the system may only be trusted to act once every action is justifiable from tamper-evident Evidence. This is the substrate for that.

## Gate sequence (each independently deployable, reversible, measurable)

- **Gate 0 — Canonical model + lossless proof (this milestone, read-only).** Define the Evidence model; prove every existing signal maps into it with zero loss and full reversibility. No store, no parser change, no pipeline change, no migration, no deploy.
- **Gate 1 — Additive capture.** Enrich ingest so future Evidence is richer: capture the email headers the Gmail parser currently discards (List-Unsubscribe / Precedence / List-Id), a `parser_version` / `extractor_version` on every source, and any provider metadata dropped today. Additive and backwards-compatible; changes no existing stored row.
- **Gate 2 — Evidence store + adapters.** Introduce the append-only `evidence` table + a read-only backfill from existing sources, and adapters that present Evidence in the exact shape pipelines already expect. **Pipelines keep reading existing models until the Evidence layer reaches complete conformance** — the cut-over is a separate, reversible, independently deployable step per source type.

## Canonical Evidence model (`_shared/evidence/model.ts`)

An `Evidence` record is the immutable representation of one raw source signal:

| field | meaning |
|---|---|
| `evidenceKind` | `email · email_attachment · email_ai_insight · phone_call · phone_recording · phone_transcript · phone_ai_insight · commusoft_import` (+ future `slack_message · calendar_event · file · webhook · api_response`) |
| `tenantId` | tenant isolation |
| `sourceSystem` | gmail · sipcentric/simwood · transcription · ai · commusoft … |
| `sourceTable` / `sourceId` / `sourceExternalId` | system-of-record row + provider id |
| `occurredAt` / `capturedAt` | real-world event time / ingest time |
| `parserVersion` + `extractionHistory[]` | the extractor version(s) that produced the stored form |
| `derivedFrom[]` | upstream provenance chain (transcript ← recording ← call) |
| `contentHash` | sha256 of `canonical` (set by a crypto-capable runtime) |
| `canonical` | deterministic, key-order-independent serialization of `raw` (the hash preimage) |
| `raw` | **the COMPLETE source row — nothing dropped** |

**Losslessness is guaranteed by construction:** `raw` is the entire source row; typed fields are *derived projections* for indexing, never the source of truth. `verifyLossless(row, evidence)` asserts every source key/value is present in `raw`; `reconstructSource(evidence)` returns the original row (reversible). Adapters are config-driven (`SOURCE_ADAPTERS`) so a new signal type is one entry, provider-neutral.

## Gate 0 conformance (real Drummonds, read-only, `scripts/evidence-conformance-proof.ts`)

Every populated signal represents **100% lossless + 100% reversible**, with **zero content-hash collisions**:

| source | kind | rows | lossless | reversible | occurredAt | externalId | parserVersion |
|---|---|---|---|---|---|---|---|
| email_messages | email | 4031 | 100% | 100% | 100% | 100% | 0% |
| phone_calls | phone_call | 867 | 100% | 100% | 100% | 100% | 0% |
| phone_recordings | phone_recording | 582 | 100% | 100% | 100% | 100% | 0% |
| phone_transcripts | phone_transcript | 582 | 100% | 100% | 100% | 0% | 100% |
| phone_ai_insights | phone_ai_insight | 582 | 100% | 100% | 100% | 0% | 0% |
| email_attachments / email_ai_insights / data_imports | (modelled) | 0 | — | — | — | — | — |

## Known upstream gaps (Gate 1 scope — not a Gate 0 loss)

Gate 0 is lossless **with respect to the current system-of-record**. Two things are already lost *before* storage or absent, to be fixed additively in Gate 1:

- **Email headers** — the Gmail parser keeps only from/to/cc/subject/date; `raw_payload` = `{label_ids, size_estimate, history_id, has_attachments}`. List-Unsubscribe / Precedence / List-Id are discarded (root cause of marketing leaking into operational intelligence).
- **`parser_version`** — absent on all sources except transcripts (which carry `model`). Add an explicit extractor version at capture.

## Invariants held throughout

Read-only against existing data · additive only · backwards-compatible · reversible (source → evidence → observation) · measurable (conformance %) · independently deployable per source · tenant-scoped · provenance preserved · no raw evidence deleted or rewritten · no production writes until a gate is separately approved.
