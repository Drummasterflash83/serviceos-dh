# ServiceOS direction — 20 October 2026

“Client-visible” means an authenticated Drummonds user, not Chris's OpenFolk preview. No Drummonds-user acceptance is verified; LIVE has a “Jobs to review” shell, not a complete list.

## 1. Per milestone (M1–M6 + Emma)

- **M1:** Client: shell, no verified list. Next: audited dual-ID links → open-status paging → client flag and desktop/mobile acceptance; Heidi stays disabled.
- **M2:** Client: no verified visits or costs. Next: fresh exact-job read → current appointment export → source-linked visits, estimates and parts/costs.
- **M3:** Client: no money view; reviews are operator-only. Next: verified invoice/job mapping → dated GP and debt exceptions → ARR, Further Works and review-only chase drafts.
- **M4:** Client: no scores. Next: measure/sample/freshness rules → scorecard home with withheld states → supported advisory scores with reasons/actions.
- **M5:** Client: no verified obligations. Next: quote ageing/conversion → PPM and 60-day renewals → expiring certificates, all source-linked.
- **M6:** Client: no asset pilot/utilisation. Next: one authorised customer's assets → evidenced engineer hours/utilisation → next-client onboarding trial.
- **Emma:** Client: main-number routing unchanged. Next: reconcile #88 with LIVE v14 → isolated 603 fallback/delivery → real calls and Chris's day-of switch.

## 2. Tracks

A (UI) and B (Commusoft) shipped in parallel. C’s agent worked on Commusoft closure, **not QuickBooks**; #273 opened just before this pause, unmerged and without a provider call. D (Emma) had no active coding; real-phone/603 work awaits setup. No feature track runs during this reply. Resume independent work in parallel; I integrate and verify LIVE.

## 3. Job list

Treat **11,668 unlinked** as Chris's baseline until a fresh count. Dry-run counts; auto-link only when Commusoft customer and property IDs each map to exactly one tenant customer/site without conflict. Audit rule, source version and before/after; make unlink reversible. Send missing, multiple and conflicting cases to review, then report actual linked/review counts. Define open statuses from Commusoft. Use tenant filters and cursor paging for the full open list. Enable the Drummonds client flag after source/access/mobile checks, without enabling Heidi's login.

## 4. Scorecard home

M4 slipping behind source plumbing was the wrong priority. Target a LIVE owner scorecard home by **22 October**, client-facing layout by **23 October**. Unsupported numbers must say “not enough data yet”. Numbers need agreed measures, sample, freshness and source-linked reasons; no pay effect. Drummonds-login acceptance remains unproved.

## 5. Emma

Before #88 merges: reconcile v14 settings, freeze one candidate, pass all 12 scenarios and prove real transfer, mailbox 603, both emails and Slack alert. I need Chris for a supervised test call and separate day-of main-number approval. Commercial emergencies: Rob→Tony; domestic: Tony→Rob. The greeting discloses automation and recording.

## 6. Branch cleanup

Fresh fetch: **157 remote heads, 62 unmerged into main**, not 115. Archive all refs and unique worktrees, close obsolete drafts after review, then delete superseded branches. Keep `main`, `codex/new-dawn-emma` and open-PR heads until resolved; never rewrite history.

## 7. Decisions you need from me

1. **Scores:** recommend job progress/completion first; withhold customer/team numbers pending evidence.
2. **Visits:** recommend a current 30-day appointment export with event/job IDs, times, status and corrections.
3. **30% GP:** recommend labelled accounts GP first; hold field GP until job costs link.
4. **Emma:** recommend one supervised test-call slot this week; keep main routing unchanged.
5. **Assets:** recommend one Drummonds customer for a bounded pilot.

## 8. Handback

Private reviewable **HANDBACK ZIP by 23 October**, with unfinished gates explicit; final verified target **6 November**, conditional on visit export, asset pilot and Emma call. Include evidence, never secrets or raw communications. Use fewer outcome-sized PRs; no STATUS-only PRs; update `docs/STATUS.md` once per milestone change.
