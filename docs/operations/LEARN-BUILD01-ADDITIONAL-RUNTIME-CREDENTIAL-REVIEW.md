# Build 01 full-application recovery: five additional active Edge credentials

**Prepared 17 October 2026; names-only evidence, no new secret copy approved or made.**
The approved eleven-setting age package, Vault snapshot and project-key
rebinding cover the identified LEARN Phone, Email, Commusoft, Slack, QuickBooks
and Control Plane credential sources. They do not cover five
other **configured LIVE Edge secrets**. A names-only readback of the 62 active
settings and pinned v107 source found current uses for all five. Drummonds'
receptionist workspace specifically points to both of its named bindings.
[Sanitised evidence](evidence/learn-build01-additional-edge-binding-use-2026-10-17.json).

| Existing setting | Current-source consumer and affected recovery path |
| --- | --- |
| `MARKETING_TRACKING_SECRET` | `marketing-track` verifies tracking; the marketing email connector also reads it when constructing tracked links. |
| `OPENAI_EMMA_REVIEW_KEY` | Receptionist greeting, task and review routes use the separate review model key. |
| `RECEPTIONIST_SLACK_DRUMMONDS` | `client-notifications` reads the workspace's dynamic `slack_secret_name` for its legacy Slack route; Drummonds points to this exact setting. |
| `RECEPTIONIST_VAPI_DRUMMONDS` | Receptionist calls, practice, release, rehearsal and review routes read the workspace's dynamic `vapi_secret_name`; Drummonds points to this exact setting. |
| `RESEND_API_KEY` | Marketing sender and shared worker/automation email connectors use the outbound email key. |

These are outside the eleven-setting package and the Vault overlap. Omitting
them from a replacement project would leave those functions unable to resume
their configured behavior. They do not prove a failure of LEARN's read-only
source intake, but a **full application** recovery claim cannot silently
exclude them. This review does not imply permission to send through Slack,
Vapi or Resend, activate a campaign, or rotate any credential.

The smallest bounded recovery extension is a **separate one-time package for
these five exact names**. Reuse the proven short-lived server-side sealed
export pattern: bind the temporary route to the current project and service
key, a random nonce, an ephemeral encryption public key and a short expiry;
deny the wrong nonce; compare all five values only in process memory to their
current management digests; encrypt directly to the existing age public
recovery recipient; remove the temporary route and verify all other function
versions are unchanged. No value belongs in Git, logs, shell arguments or a
plaintext file. Rehearse the exact route with synthetic TEST values first.

Only after a prepared ciphertext has known bytes and SHA-256 should a separate
exact create-only off-site copy be reviewed for the existing private London
bucket and independently downloaded with the Restore identity. A later
recovery-only private-key check and isolated replacement-runtime/provider
restart remain separate proof gates. The earlier one-time approval covered
the other eleven settings, not these five; no standing access or expanded
copy is implied by it.
