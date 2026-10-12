# Bounded real Google Workspace TEST acceptance

Prepared on 12 October 2026. No real email has been captured by this run yet.

## Exact scope

- Run `b93b3a2f-dceb-4027-8c0d-819f38d70249` targets existing Drummonds TEST tenant
  `f8c114fa-fee7-4983-8970-f6e7f5fd3129` in `saatxzwxvdvqevbnskxy`.
- Reuse the approved server-side Google Workspace credential. Its three secret
  digests match the existing credential and production connection identity.
- Register only `heidi@drummondheating.co.uk`, whose existing production account
  is active through Workspace. No production configuration or data is changed.
- Capture one mailbox page, at most 20 messages, using the installed durable
  `email.workspace_sync` handler. This includes message headers, bodies and
  provider evidence in private TEST database records. No attachment download,
  AI processing, provider mutation or outbound message is included.
- At most one delegated-token request, one Gmail profile request, one message-list
  request and 20 message-detail requests. The message-response aggregate limit is
  32 MiB; the actual body/storage size can differ after parsing.
- Use one existing service-authenticated worker invocation, with `batch_size: 1`
  and only `email.workspace_sync`. It may retain a successor job and cursor for
  later continuation; that successor is not dispatched by this run.
- Pause the email flag, account, mailbox and connection after the attempt,
  including an acknowledged error. Retain source history and receipts. An already
  admitted page may finish after pausing; an uncertain outcome is inspected,
  never automatically replayed.
- Create no login, human role, operator grant, API key or schedule. Existing
  authorised TEST access remains unchanged.

## Preconditions and checks

`scripts/verify/learn-email-real-test.mjs prepare` is read-only. It records the
exact source binding, runtime versions/hashes, credential digests and preservation
baseline privately in the excluded `.verification-results` directory. It refuses
an existing target mailbox/source inventory or an unverified credential binding.

`scripts/verify/learn-email-real-test-run.mjs rehearse` executes the exact
registration and queue submission inside a rolled-back TEST transaction. It
checks the returned mailbox/job receipt, registration absence and all 194 original
dataset fingerprints. This rehearsal has passed with zero provider requests.

Capture requires the matching run ID, unchanged source authority, unchanged
runtime/credential pins and a matching SQL rehearsal hash. The Commusoft
supervisor must be stopped; unrelated queued work and any running worker prevent
dispatch. TEST schedules must remain off. Waiting, unleased Commusoft work may
remain queued for later continuation.

After capture, verify the exact queue job, durable attempt, source counts, retained
cursor, pause state and unchanged original data. Reconcile only reviewed additions
into the stopped Commusoft supervisor's baseline, retaining its original hashes,
before resuming that import. Do not reset a checkpoint or silently replace a baseline.

## Remaining acceptance

One page does not prove full mailbox history, ongoing capture, deduplication across
new pages, customer attribution or useful cards. Those journeys remain explicit
launch gates. No production promotion follows automatically from this TEST run.
