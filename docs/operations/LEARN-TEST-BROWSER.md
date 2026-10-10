# Actual TEST browser acceptance — 9 October 2026

The real application ran at `http://127.0.0.1:47872/client?section=learn`
against the verified TEST project `saatxzwxvdvqevbnskxy`. This was the normal
Supabase client, password sign-in and real database/Edge reads, not the isolated
simulated preview. No production records, provider sync, emails or recordings
were changed. No new hosting deployment or real employee assessment occurred.

## Verified flow

- Signed in as the owner of a separately marked synthetic company and read its
  two-member roster. Created and reloaded draft revision 1 through the editor:
  scale 50, one handoff measure, weight 1, minimum sample 1 and full coverage.
- Selected a completed same-day UTC interval, collected its captured handoff,
  reloaded the page, restored the exact interval and read the retained proof.
  One creation and one transfer produced one handoff, with confirmed identities.
- The inferred observation withheld the score. Confirming the inspected evidence
  produced a draft simulation of 5/50: one handoff against a target of ten.
  Disputing it withheld the score again. Both reviews and the original observation
  remained in history. This count does not measure speed, quality or productivity.
- After synthetic membership ended, the owner role was revoked and the Auth login
  banned/password rotated, the existing browser session could no longer read
  scoring rules. Evidence and author identities were retained.

## Bugs found and fixed

The old date-only assessment fields ended at midnight and could not select work
from earlier the same day. They now accept UTC dates and times to the second,
provide a **Through now** button, and invalidate the displayed assessment when
either field changes. Native input and change events both update state. The same
validated ISO interval reaches the reader and collector; browser proof confirmed
`21:44:02Z` through `21:46:30Z`. Invalid calendar dates, reversed and future
intervals are refused. The helper is shared with the isolated preview.

The launch endpoint returned HTTP 200 with a valid response timestamp about 70ms
ahead of this computer. The browser rejected it as a future observation. Launch
validation now permits at most five seconds of server clock lead without extending
the server's expiry. Larger future offsets, expired responses, foreign tenants and
future source facts still fail. The actual browser then showed zero stored
emails/calls/recordings for the empty synthetic company, with Slack still unknown.

## Verification and limits

Ten focused date/launch tests, both TypeScript checks, main build (47 prebuild
checks) and isolated preview build passed. Existing build warnings remain.
The synthetic company retains one work item, two canonical captures, two
measurements/receipts (the initial seven-day window plus the corrected same-day
window), and separate confirmation/dispute reviews for the same-day observation.

The browser fixture and loopback server helpers require the explicit TEST project
guard and reuse existing CLI credentials without printing keys. The temporary
password is supplied on stdin and is never saved by those helpers. Non-secret
fixture metadata lives in `/private/tmp/serviceos-learn-ui-browser-20261009.json`.
Do not reactivate this retired fixture; create a fresh one for subsequent checks.

See [structured acceptance evidence](evidence/learn-test-browser-2026-10-09.json)
and [the confirmed-score screenshot](evidence/learn-test-browser-confirmed-2026-10-09.jpg).
The screenshot records the confirmation stage; the final retained review is disputed.

Still outstanding: separately hosted TEST frontend, full staff/cover work-action
browser flows, Slack/voicemail/Commusoft live connections, business-calendar and
delay exclusions, team aggregation, saved assessments and reviewed reward rules.
LEARN V1 remains active and incomplete.


## Slack recovery browser acceptance — 10 October

The actual app and normal TEST sign-in verified continue/restart approvals,
retained source evidence, original-window budgets and progress across reload.
Read-only stored records matched the UI. A fresh synthetic fixture was retired
without deleting its evidence; the browser signed out and its tab/server closed.
See [the detailed acceptance record](LEARN-SLACK-INGESTION.md#channel-recovery-screen--signed-in-test-acceptance-10-october)
and [structured evidence](evidence/learn-test-recovery-browser-2026-10-10.json).
This does not establish live Slack ingestion or a deployed TEST frontend.
