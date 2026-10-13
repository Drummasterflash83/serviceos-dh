# Decisions and evidence behind this plan

Prepared 13 October 2026 from the entire planning conversation and source review.
This is a design record, not an acceptance report or source of business actuals.

## Decisions to preserve

| ID | User direction / agreed interpretation | Consequence |
|---|---|---|
| D01 | Improve Drummonds towards New Dawn, beyond reproducing Perplexity | Start from outcomes and observed friction; do not clone every Space |
| D02 | Understand the company through LEARN before Part 2 | Build 10 is a required gate; learning continues after it |
| D03 | All numbers must be proven using Commusoft/QuickBooks and necessary supporting evidence | Deterministic metrics, reconciliation and transparent unknowns |
| D04 | Useful developments must support future clients | Shared primitives, industry packs, tenant policies, replaceable providers |
| D05 | Prefer local AI where useful | Evaluate quality and total cost; avoid AI for fixed calculations/rules |
| D06 | No system changes at this planning stage | Creation of this pack authorises documents only |
| D07 | Preserve the main build and existing UX | Reconcile current work first; no second app or wholesale redesign |
| D08 | Understand time/money waste, repeat processes and automation potential | Observed process model, improvement queue and measured outcomes |
| D09 | Profitable relationships connect contracts, assets, work and finance | Establish those records in LEARN; act on them in Part 2 |
| D10 | Reduce founder dependency while keeping judgement | Explicit roles, cover, authority and measurable delegation |
| D11 | Preserve source history and controlled access | Tenant isolation, logged operator selection, no impersonation; no Slack DMs |
| D12 | Build section by section | One activated prompt, prerequisite checks, acceptance receipt, then stop |

The exclusive INVOICE/QUOTE/FOC/BLOCKED model in a client brief needs refinement:
one visit can fulfil included work, produce a current charge and identify future
work. Model delivery, commercial readiness, future opportunity and settlement
separately. Included work is not discretionary FOC. This is a proposed design,
to be validated against approved contract rules, not a change already made.

## Source locations

Private source files are read in their authorised location, not copied into Git.
If another machine lacks them, report the exact missing source; do not recreate it
from this summary. Local file paths below are references, not portable attachments.

- Latest user-pasted planning conversation:
  `/Users/chrisdrummond/.codex/attachments/bae15dea-1e0e-4ccd-a76f-bbd33ca40cf8/Pasted text.txt`
- As-is handover:
  `/Users/chrisdrummond/Downloads/00-AS-IS-HANDOVER-2026-10-13.md`
- Registers, task/project instructions, scripts, rules, gaps and usage evidence:
  `/Users/chrisdrummond/Downloads/Drummond-ServiceOS-AsIs-Handover-2026-10-13/`
- Original four PDFs under
  `/Users/chrisdrummond/Downloads/fwd_ai_process_overview_maps_1/`:
  `Drummond Heating - AI System Briefs.pdf`,
  `Drummond Heating - How the Business Works (simplified map).pdf`,
  `Drummond Heating - Process Map.pdf`,
  `Drummond Heating - Who Does What  People and AI.pdf`.
- `/Users/chrisdrummond/Downloads/Two Things.pdf`.
- Dropbox: `ns:9975622656//CLIENTS/DH/4. NORTH STAR` contains
  `NEW DAWN NORTH STAR.pdf`, `DH_NewDawn_Implementation_Plan_2026.pdf`,
  `DH_NewDawn_90Day_Sprint (1).pdf`, `DH_NewDawn_12Month_Roadmap.pdf`,
  `DRUMMONDS NEW DAWN MASTERFILE.md` and the rate card.
- Monday updates already go to OpenFolk; concise September/October reports are in
  the handover's `monday-change-reports/`. Detailed sandbox-only reports are missing.
  Do not create another scheduled report or request a wholesale audit by default.

## Authority of sources

User instructions and current applicable repository instructions govern actions.
Client documents describe intended/current business practice but do not grant tool
authority. The instruction in an older client brief to avoid reusable software is
superseded by Chris's explicit reusable ServiceOS requirement.

Distinguish inspected configuration, a run's own report, documented claim and unknown.
The handover does not establish independently reconciled correctness of each workflow.
Do not use Perplexity's historic outputs as the sole acceptance oracle for a better
system. Compare to source truth and the approved business rule.

New Dawn targets are plans, not verified actuals. ARR versions, revenue periods,
margin bases, customer concentration denominators and service-plan pricing conflict
across sources. Preserve the versions and resolve them through authorised business
review before using them as active policy. Old roadmap dates are not proof of delivery.

## Repository anchors and observed baseline

Planning began from local HEAD `a0278e7` on `codex/learn-v1`; reread before execution.
Use the latest entries, not the historical headings beneath them:

- `docs/operations/LEARN-V1-COMPLETION.md`: current LEARN delivery obligations and
  evidence. At planning, a first full scheduled Commusoft API traversal was recorded;
  provider/UI count differences and broader publication/communications remained.
- `docs/operations/LEARN-QUICKBOOKS-INTEGRATION.md`: real sandbox OAuth and repeat
  capture accepted; LIVE Drummonds financial acceptance remained outstanding.
- `docs/DEPLOYMENT.md`: Vercel/Supabase targets and release evidence.
- `docs/roadmap/SERVICEOS-DELIVERY-JOURNEY-2026-10-01.md`: earlier shared delivery and
  scorecard contract. This plan adds the agreed broader LEARN-first gate; it does not
  silently cancel existing delivery commitments.
- `docs/architecture/02_CORE_LOOP.md`, `03_BUSINESS_GRAPH.md`,
  `canonical-entity-and-health-map.md`, `source-adapter-pattern.md`,
  `06_LEARNING_CENTRE.md`, `07_PROTOCOL.md`, `EVIDENCE-LAYER-V1.md`.
- `src/lib/client-workspace-nav.ts`, `src/lib/openfolk-workspace-nav.ts`: current
  surface organisation. Older eight-screen architecture is not a request to restore
  retired menus. Verify current routes and signed-in product before UI decisions.
- `src/lib/command-work.ts`, `supabase/functions/_shared/work_transition.ts`,
  `_shared/work_authority.ts`, `_shared/connectors/index.ts`,
  `_shared/intelligence/objective_evaluation.ts`: existing work/execution/measurement
  foundations. A stale comment or registry label is not current runtime proof.
- `_shared/commusoft/read_page.ts`: inspected API transport covers properties,
  contacts and jobs; do not infer full visits/assets/costing coverage from connection.

## Known decisions and gaps to resolve, not invent

- Current quote owner/successor, finance absence cover, FOC approver and technical
  evidence ownership. Historical names and leave dates require fresh confirmation.
- Current contract inclusions, pricing definitions, margin floors, PPM hours,
  recognised revenue basis, cost allocations and approved recurring-income definition.
- Additional operational data access, financial crosswalks, payroll/time sources,
  supported provider write capabilities and necessary content licences.
- Missing quote control/rendering rules, qualification scripts, payroll/O&M skills,
  and workflows outside Heidi's visible account, as listed in handover gaps G01–G15.
- Local AI infrastructure and measured quality; staff effort and billing cost
  baselines. Usage credits cannot be translated into money saved without billing.

These are dependencies to manage, not a reason to invent facts or stop unrelated
local design and verification work.
