# LEARN foundation acceptance contract

This defines the expanded company-understanding foundation requested in this chat.
It is additional to the current LEARN V1 delivery checklist. Neither one becomes
complete merely because the other passes. Build 00 reconciles their obligations.

## Fix the scope before measuring completion

Build 02 produces a reviewed scope register: business areas, sources/accounts,
history windows, entities, fields, expected refresh, eligibility, allowed access,
intended uses, reference counts where available, owner and acceptance method.
Inventory the whole relevant company, including unavailable sources. An approved
exclusion is visible with its reason and downstream impact; it is not successful
coverage. No silently narrowed denominator, blanket 'all data' ingestion or perfect
knowledge claim. Additions remain possible through versioned scope changes.

Each row is required, supporting or deliberately excluded. Required sources and
claims need their evidence to pass. An unresolved material issue makes the related
capability unavailable and prevents a gate that depends on it. Unsupported provider
capabilities may use an approved export with explicit cadence, provenance and limits.

## Required evidence at Build 10

| Gate | Pass evidence | Cannot substitute |
|---|---|---|
| G1 Source coverage | Every in-scope source row accounted for; pagination/history/updates/corrections/deletions or limitations checked; freshness and failure visible | A connected badge, one imported page or total stored row count |
| G2 Durable operation | Required feeds refresh without manual rescue over the applicable acceptance window; replay/recovery and access withdrawal demonstrated | A manually invoked worker or one successful initial traversal |
| G3 Connected company | Sampled links across people, customers, sites, visits/jobs, assets, contracts, opportunities and finance are reviewed; unmatched/ambiguous populations quantified | Name/email coincidence, shared office phone or matching job-type code |
| G4 Business meaning | Approved strategy/metric definitions, responsibilities, cover and policy precedence; as-is, intended and proposed roles/processes distinct | AI-extracted text treated as an approved rule |
| G5 Financial and time baseline | Relevant totals/record lists reconcile, calculations reproduce, costs/hours and exclusions explicit; real company acceptance | Sandbox sample data, stale plans, draft totals or charge-out-as-cost |
| G6 Process understanding | Representative ordinary and exception journeys reviewed by staff; event/handling/waiting distinctions, blind spots and confidence explicit | A plausible flowchart or elapsed time labelled labour effort |
| G7 Improvement proposals | Prioritised evidence-backed proposals with owner, dependencies, measurement and potential adverse effects; eliminate/simplify options considered | A generic AI-generated automation wishlist or unsupported savings sum |
| G8 Product and access | Usable signed-in client/operator paths, isolated client data, logged operator selection, source access respected through derivatives | Local synthetic screens or operator-only acceptance |
| G9 Repeatability | Same primitives work for a second synthetic tenant with different terminology and provider-shaped inputs; no private information crosses tenants | A Drummonds fork renamed for another company |
| G10 Human acceptance | Named business reviewers confirm company/process understanding, finance definitions and evidence usability; issues and revisions retained | The implementing agent approving its own interpretation |

## Representative journeys

Select a bounded but meaningful cohort with the operational and finance owners.
Cover routine paid work, contract-included work, further works, multi-visit or
part-complete work, missing evidence, an approved FOC case, a disputed/unpaid or
credited invoice, and a renewal/commitment where records permit. Record sample
selection, counts, reasons, evidence paths and limits. Do not declare company-wide
accuracy from a single easy customer. Do not fabricate real cases to fill a sample.

## Measures and acceptance thresholds

Record agreed thresholds before evaluation, with metric, denominator, owner and
period. Required integrity invariants are zero cross-tenant disclosure, zero silent
source mutation, zero invented monetary/date/completion facts and no duplicate
side-effects in tested replay cases. Coverage, matching, classification and latency
targets require explicit task-specific definitions; do not impose a universal 95%.

For learned extraction, retain a reviewed evaluation set containing noisy, missing,
conflicting and adversarial inputs. Show false positives/negatives, abstentions and
human correction effort, not just aggregate accuracy. A material unsafe class can
block a capability even when aggregate accuracy looks high.

Use existing one-working-day unattended input criteria where applicable. Longer
business-cycle checks require real elapsed observation; do not simulate a week or
claim four weeks of production success from replay. Historical replay supplements,
but never substitutes for, real operation and human acceptance.

## Decision record

Build 10 writes a receipt listing G1–G10, links, environment, scope/version, reviewed
exceptions and acceptance owners. A PASS requires all required gates. Record PARTIAL
or BLOCKED for missing material evidence; neither unlocks Part 2. Preserve useful
completed work and name the precise next dependency. Ask Chris to change the scope
only where a concrete trade-off is required; the agent cannot waive it itself.

When accepted, LEARN remains active and continuously refreshes. New source changes,
revoked access, deteriorating freshness or corrected facts can invalidate downstream
findings and pause dependent actions. Passing once is not permanent permission.
