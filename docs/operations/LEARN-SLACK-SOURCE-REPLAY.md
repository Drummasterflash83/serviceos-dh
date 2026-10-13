# Supplemental revalidation of retained Slack sources

Prepared only. No production request, provider call, replay job or proof has been created by this work.

Messages captured before durable public-visibility proofs were introduced cannot be attached to customer context merely because their channel IDs begin with C. Existing campaigns own their accounts and cursors, so the manual import/recovery controls correctly refuse to overwrite them. This protocol adds a bounded supplemental read without disturbing the original campaign.

## Exact request and authority

The existing authenticated `learn_slack_campaign_dispatch` accepts operation `replay_source`. Its input contains exactly `campaignId`, `sourceMessageId`, `sourceVersion`, and `reason`. Existing actor matching, logged OpenFolk/company-admin access, and request/check/cancel handling remain. The new immutable request table has no client or service-role table privileges, and its internal request function has no new authenticated grant.

The server derives the account, channel, timestamp, optional genuine thread parent, connection revision and expiry from the retained source and its existing campaign. The selected source must still have that exact version and lie inside the approved campaign window. The derived window is one microsecond either side of that timestamp, one page only. A reply uses its retained parent evidence; an ordinary message does not invent a thread. The parent can predate the window, as in the existing observed-thread reader.

Each request creates one normal Slack history job carrying a distinct replay identity. The existing worker claims it with the same account/workspace locks, prioritisation and rate pacing. The current campaign and requesting actor must remain authorised. The original campaign's dispatch ledger reserves every identity/channel/history request and retry before HTTP; its budget and expiry never increase. There are at most three attempts and nine reservations per attempt, still subject to the shared campaign allowance. No new recurring schedule or credential is introduced.

## Publication and held outcomes

The credential-owning runtime reads its scope from a fenced service RPC, observes public-channel metadata using the normal authorised transport and fetches the one bounded page. The dedicated commit rejects a missing reservation, stale claim, changed connection, private/DM/shared visibility, extra records or the wrong source identity.

Only exact equality between fresh provider JSON and the retained source version can add the capture receipt and source-version proof. They commit together with the job's durable page receipt. A missing source or changed JSON records `source_unavailable` or `source_changed`; no proof is added, no old data is rewritten, and no review association is guessed. This is source revalidation, not a replacement for normal capture of newly changed messages.

A repeated identical commit resolves an uncertain response without another proof. A conflicting replay fails. Worker crash recovery settles the retained page receipt without another provider request. Existing retry delays and 429 workspace backoff remain; successful replay never queues a normal history continuation. The main account settings/cursor, campaign coverage, previous imports, source messages, versions, interaction attribution and operator review decisions are preserved.

## Delivery and acceptance

Migration `20261101920000_learn_slack_campaign_source_replay.sql` depends on the published customer-context proof schema. Its matching runtime changes are the new `slack_source_replay.ts` module and narrow history binding/handler branches. Deploy SQL before the matching worker closure, preserving the latest separately published voicemail repair. This preparation must be rehearsed and reviewed before any deployment or logged operator request.

For the first acceptance, use one genuine reviewed source already held in the existing campaign. Verify its exact immutable replay request, normal scheduled claim, dispatch reservations, unchanged account cursor, exact source proof and the existing customer timeline. A changed/missing result is a successful bounded check with unresolved source evidence, not successful customer-context publication.

## Verified preparation

- 124 focused Node tests pass, including exact source windows and an observed reply using `conversations.replies`.
- Full-schema v2 rehearsal passed as non-superuser `postgres`. It exercises actual request, claim, shared reservation, proof commit and settlement; missing/changed source holds; private/wrong-source rejection; pause, actor revocation and exhausted budget; proof-write rollback; retry/429 workspace backoff and stale-attempt rejection.
- All 1,591,580 archived COPY rows, 396 tables and seven sequences match. Existing communication-reader, draft and operator-context journeys still pass. The networkless container was removed.
- Release remains prepared only. Any future immutable closure must use live Slack worker v4/platform worker v64 as its baseline and preserve the latest voicemail implementation. No provider request or production replay has been performed.

Sanitised evidence: `docs/operations/evidence/learn-slack-source-replay-preparation-2026-10-13.json`. Detailed local results: `.verification-results/slack-source-replay-rehearsal-v2/report.json` and `.verification-results/slack-source-replay-node-tests.txt`.

## Immutable production rollout prepared

The guarded SQL/rollback is retained in `supabase/release/learn-production-patches/slack-source-replay-v1/`. All four changed functions are already owned by the maintenance role; this patch makes no role-membership change. The exact release envelope passes full-schema wrong-target/digest and late-failure guards, plus reader/function rollback.

The private immutable runtime package contains only the new replay module and two binding/handler changes atop published Slack v4/platform v64. Both exact compiled artifacts boot without network or real credentials and reject missing authentication. The latest voicemail parser and all other runtime source bytes are preserved.

The runtime guard supports ongoing voicemail capture. It requires exact route, access, owner and cron state; no running voicemail job at immediate preflight; and preservation of every previously captured message/source identity and content digest. Legitimately appended rows are allowed. Four direct tests reject deletion, mutation, duplicate identity and control changes while accepting append-only captures. It does not pause or disable any route.

No SQL, runtime publication or replay request has been executed by this preparation. Root will wait for the first ongoing-voicemail monitor to finish before reviewing/executing the prepared rollout.
