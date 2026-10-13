# Slack campaign page recovery

Prepared on 13 October 2026. Not deployed or run. This change does not broaden the
accepted Slack message formats.

Four active channels stopped after a provider page contained an unsupported
message shape or subtype. The failure codes are retained, but the exact offending
structure was not. Previously saved pages and the current cursors remain intact.
A repeated blind retry would provide no additional evidence.

## Prepared behavior

- The existing OpenFolk Slack campaign controls gain an advanced held-page
  recovery panel. Ordinary client controls do not expose it.
- A logged authenticated metadata read supplies the exact campaign, account,
  current import, failed job and SHA-256 checkpoint fingerprint. The operator adds
  a reason and reviews that fixed request before dispatch.
- The existing authenticated campaign dispatcher accepts `recover_page`. It
  preserves the campaign settings and cursor, queues one normal history job,
  retains the original failure, and records an immutable actor-bound receipt.
  Check and cancellation reconcile the same request; cancellation never claims to
  undo an already committed job. A failed job can have only one committed
  recovery; a later failure needs its own reviewed identity.
- Current campaign authority, requesting-operator authority, original dates,
  existing scope expiry, page limit, request ledger, account lease and workspace
  pacing still apply. No new credential, access grant, schedule or scope is added.
- An unsupported record saves only bounded structural labels: error code,
  whether `type` is missing/message/other, whether `hidden` is missing/true/false/
  other, and a short lowercase subtype identifier when safe. It never saves a
  message body, user identity, URL, attachment or raw response in diagnostics.
- Diagnostic persistence requires the same running job lease/attempt, no committed
  page, and a charged campaign dispatch. Failure to confirm that receipt leaves
  the job held; it does not enable automatic retries or advance the checkpoint.
- The recovery reader can inspect the retained job outcome and structural
  diagnostic. A queued receipt is not labelled successful capture. Unknown,
  deleted, hidden or redacted content remains rejected until an observed format
  is separately reviewed and implemented.

## Release and acceptance

Install the matching SQL before the two matching worker artifacts. Preserve the
published source-replay path (Slack worker 5/platform worker 65), voicemail parser,
all other runtime endpoints, credentials, access, cron and ongoing capture state.
The prepared runtime guard requires no running voicemail job immediately before
publication; the parent release must also wait for its active voicemail monitor.

Review local artifacts in
`.verification-results/production-slack-campaign-recovery-20261013/`. The initial
SQL plans are superseded by the v3 plan. It prevents reusing a failed job
under another request, uses a distinct recovery creation timestamp, and rejects
null import identities with an explicit null-safe equality guard. The runtime
preparation-v2 plan binds the exact corrected schema-plan-v3 hash.
No apply, deploy or recovery request was performed during preparation.

After reviewed publication, use OpenFolk → selected client → Slack connection →
Historical campaigns → select the existing campaign → Advanced: recover a held
campaign page. Refresh the saved failure, review the exact checkpoint and reason,
then apply once. Read the saved job outcome. If it remains held, review only its
structural diagnostic, implement the proven format with matching runtime and SQL
classification tests, then recover that new exact failed job. Never reset the
cursor or start a competing campaign to bypass the hold.

Rollback restores the two previous dispatcher/authority function definitions and
revokes the new entrypoints after all active recovery jobs are resolved. Immutable
requests, diagnostics, source messages and checkpoints remain retained. Runtime
rollback uses the exact retained published artifacts and original JWT settings.


## Separate original-source reader proposal

The representative customer → job → retained Slack excerpt journey is verified.
A dedicated Slack original-source disclosure remains an additive capability, not
required to display the existing useful excerpt. No implementation is included
in this recovery patch.

A future narrow source reader should return bounded message text, exact source
version, channel/workspace identifiers and timestamps only after checking the
retained version's capture-time public-visibility proof and current non-revoked
Slack connection. It should reuse the existing source evidence disclosure, avoid
raw provider payloads and files, and deny private channels/DMs or missing proof.
It needs tenant/isolation/revocation/stale-version rehearsal and the established
role-preserving restricted-reader deployment envelope before publication.
