# Build speed review — 21 October 2026, 04:15 UTC

## 1. Where we are

LIVE means Chris’s MD preview; Heidi remains disabled.

| Milestone | MD can use on LIVE | Deployed but unaccepted; blocker/owner | Forecast vs target |
|---|---|---|---|
| M1 Home | Paged 330 open jobs (70 On hold, 13 Pending), detail, LEARN totals/freshness. | No scores; workflow unaccepted. **Build/Chris.** | Layout 23 Oct; scored Home earliest 3 Nov. **Misses 22/23 Oct score target.** |
| M2 job | Source-backed detail; 34/330 open jobs linked. | 296 identity holds; no verified visits, engineer or last contact. Sweep recovery unproved. **Build/Commusoft/Chris.** | Earliest 30 Oct with diary; **misses 23 Oct**. |
| M3 money | Dated FY27 GP/NP and net A/R through 19 Oct. | No job–invoice bridge, NP target, field GP or standing refresh. **Build/Commusoft/Chris.** | Company view 23 Oct; job money **after 6 Nov** without ledger. |
| M4 scores | Jobs counts and 3 Nov evidence-review date. | No scores; 20 Oct roster 326/326, per-job history outstanding. **Time/Build/Commusoft.** | First Moving measure 3 Nov earliest; full scores **after 6 Nov**. |
| M5 obligations | Nothing actionable. | Opportunity API denied; alternate source absent. **Commusoft/Chris.** | Unknown, **after 6 Nov**. |
| M6 assets | Nothing client-usable. | Synthetic onboarding only; no pilot/source. **Chris/Build.** | Unknown, **after 6 Nov**. |
| Emma | Modules says “Not launched.” | Test number on older graph; 603 Tony-only; handset proof/route consent absent. **Build/Birchills/Chris.** | Unknown, **after 23 Oct**. |

## 2. Measured output and time

19 October 13:45–21 October 04:15 UTC: **38.5 elapsed hours, 244 merged PRs**, median **103.5 changed lines/3 files**; **70 one-file**, **66 ≤20 lines**. File categories: **52 docs/status/evidence-only, 37 test/readback-only, 19 operator-only, 23 backend-only, 21 mixed/other, 92 touching client UI**. UI touch is not necessarily a usable feature. Flags/guards mixed with code cannot be counted reliably. **185 handback-stage files** changed.

We kept **no time sheet**. Actual hours on verification versus screens, waiting (Chris, exports, providers, tools), and rework **cannot be recovered**. The replaced 24-job preview, score panels and first identity rule are documented rework. I should have instrumented this.

Hourly merge trace, **not labour**, UTC (A UI, B Commusoft, C QuickBooks, D Emma, O other; – none): **19 Oct** 14 AB, 15 ABCO, 16–20 ABCO, 21–22 ABC, 23 ABCO; **20 Oct** 00–02 ABCO, 03 ABO, 04 ABCD, 05 B, 06 AB, 07 BCO, 08 BC, 09 ABC, 10 ABCD, 11–12 –, 13 D, 14 B, 15–16 ABCO, 17 A, 18 B, 19 ABC, 20–21 AB, 22–23 –; **21 Oct** 00 C, 01 A, 02 AB, 03–04 –. **26/33 active merge-hours** spanned tracks; LIVE integration was serial. D had **three merged PRs**.

## 3. Top causes, ranked by observable drag; hours lost unrecorded

1. **Micro-releases.** Goal: “Ship fewer, outcome-sized PRs”; “Don't open STATUS-only PRs.” **244 merges/66 tiny PRs** contradict it. Security checks protect data; separate copy-change proofs are my ceremony.
2. **Over-interpretation.** I read the goal’s exact dual-ID rule as forbidding Chris-approved clean creation; reset a 325/326 day despite ≥99%; withheld labelled partial scores despite “Missing measures drop out and the weights rescale.” These were my choices, not AGENTS.md.
3. **Missing authority.** Commusoft office tasks are not visits; no exact QuickBooks `Invoice.Id` bridge exists. Holding invented claims protects clients; source exploration yielded little UI.
4. **Operator drift.** AGENTS.md requires “explicit, logged client selection and operator reads” for tenant safety, not **19 operator-only PRs** ahead of a clear Home. My sequencing did that.
5. **Tool/approval friction.** Arc failures, browser review, local paths and approvals slowed integration. “Never invent successful processing” and secret exclusion protect clients; repeat approvals were avoidable.

## 4. Proposed fix — **wait for Chris’s reply before applying**

Replace the goal’s “Every finished slice goes to LIVE ... as soon as it's verified” with: **“Release 1–3 client-usable outcomes daily in at most two verified LIVE batches. Bundle related code, migrations, rollback and evidence in one outcome PR.”** Add to AGENTS.md: **“Apply approved clean exact-source links in reversible audited batches; ≥99% frozen-roster coverage qualifies a day, with per-job gaps shown; publish approved partial measures with sample, dates and missing measures.”** Keep tenant isolation, secrets out of Git, and explicit consent for provider writes, money, messages, routing and logins.

Target **300–1,000 lines/outcome PR** and **one verification per morning/afternoon batch**. Replace Arc forms with an audited one-click action plus CLI readback; put handoffs in Git.

**Chris/source-owner actions:** 1. In Drummonds Commusoft, find **Diary/appointment export** and **invoice integration/transfer report**; send the menu breadcrumb or grant a guided read-only session. Published docs do **not** verify click labels. Export ≤100 appointments for **20–27 Oct** with event/job/engineer IDs, zoned times, status/corrections; provide exact job/document IDs and QuickBooks `Invoice.Id`/realm. Unlocks visits, Team and job money. 2. Send Birchills: **“Make mailbox 603 notify Rob and Tony; confirm its transfer target, Rob 109/Tony 105 forwarding, and Mon–Fri 08:30–17:00 versus out-of-hours routes. Send a test receipt; don't change the main DID.”** Unlocks Emma tests. 3. Give FY27 NP target/period/basis, name an asset pilot, inspect `/client-md` on desktop/phone. 4. Decide on bounded standing read-only QuickBooks refresh; prior consent was one-use.

**Plan:** 21 Oct 09:00–12:00 identity/card recovery readback; 12:00–17:00 job workflow/Home; 17:00–19:00 LIVE batch. 22 Oct 09:00–12:00 diary/ledger or visible holds; 12:00–17:00 LIVE batch/phone review. **By 22 Oct 17:00:** jobs first, dated money/freshness, linked/held counts, no invented score. 23 Oct 09:00–13:00 score/Emma evidence; 13:00–17:00 layout/Dropbox HANDBACK. **By 23 Oct 17:00:** reviewable MD layout and unfinished gates.
