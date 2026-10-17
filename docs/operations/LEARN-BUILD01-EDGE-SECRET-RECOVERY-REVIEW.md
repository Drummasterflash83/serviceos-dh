# Build 01 — Edge runtime-secret recovery decision

**Prepared 17 October 2026. A partial local encrypted credential package exists;
no off-site credential copy or production change has been made under this
review.** The independently restored database/Auth/Edge
and frontend now serve a preserved Drummonds account in an isolated browser.
This is still not a full application restore because a replacement Supabase
runtime would need its Edge configuration and provider credentials restored.

## Verified boundary

- LIVE currently reports **62 configured Edge entries**. The management API
  returns 64-character SHA-256-shaped digests for every `value`, not plaintext
  that can be replayed into a replacement project.
- The scheduled off-site database package restores **20 Vault secrets**. Fifteen
  of those names are also configured Edge entries, and **all 15 digest-match**
  their active LIVE values. No Vault row changed after the independently
  downloaded 07:52 UTC snapshot. Those 15 values have a tested recovery path.
- **47 configured Edge names are outside Vault.** This count includes public
  configuration, platform-provided keys, flags, optional integrations and
  independently sensitive credentials. It is not a claim that 47 additional
  private keys must be copied. Examples of sensitive non-Vault bindings include
  the Slack Events signing secret, Google Workspace private key, Simwood login,
  OpenAI key and Resend key. Their values were neither printed nor saved in
  this review.
- The v107 off-site Edge package contains source for 103 functions, not their
  hosted secret values. The signed-in recovery check served the current LEARN
  route with synthetic local runtime keys; it did not establish all-function
  startup or provider capture from recovered credentials.

[Digest-only evidence](evidence/learn-build01-runtime-secret-restore-map-2026-10-17.json).

A names-only review narrows those 47 entries to **seven Supabase project
bindings**, **24 provider identifiers, public URLs, models, feature flags and
capture controls**, and **16 credential/webhook candidates**. These are
classification counts, not restored-value counts. The seven project bindings
must be obtained from a replacement project and reconciled with frontend and
service configuration. A subsequent digest-only reconstruction matched **18
of the 24 controls** to values already present in reviewed release material and
**three more** to a Drummonds Workspace row whose `updated_at` precedes the
scheduled database snapshot. This includes the Workspace service-account
email, domain and project ID inferred from that email. The configured global
Workspace client ID and impersonation subject did **not** match the saved
tenant row; the separate Google OAuth client ID is also unproven. These three
must remain explicit in the restore inventory until their source and current
use are verified. The 16 credential candidates include optional marketing and
receptionist integrations as well as Build 01 routes. Only the credentials
actually needed to restart approved Build 01 sources should enter the proposed
package. A separate isolated startup check must establish that subset.

**17 October, 10:35 UTC — two internal keys do not need copying.** A read-only
verification process compared the current LIVE `service_role` key in memory
with all active Edge digests. It matched exactly
`LEARN_COMMUSOFT_WORKER_KEY` and `LEARN_SLACK_WORKER_KEY`; no key value was
printed or saved. The original production release bound both names to that
project key. A replacement project must issue its own service key and bind
these two worker names to the replacement value. Copying their LIVE value
would be incorrect in a replacement project. This narrows the credential-copy
subset without weakening the worker authentication gate.

[Non-secret reconstruction evidence](evidence/learn-build01-nonsecret-runtime-reconstruction-2026-10-17.json).

A hash-checked scan of all **103 current v107 function closures / 728 source
files** found no literal read of the configured global Workspace domain or
impersonation subject. Current Workspace operations read those from the
tenant's saved connection row; the global subject is therefore not a required
input to that current capture path. The global Workspace client ID is optional
in the credential parser and used for connection setup/display. The separate
Google OAuth client ID is actively read by the Gmail OAuth path. Fourteen of
the 16 credential/webhook candidates have literal lookups; the two Drummonds
Receptionist names have no literal lookup because the route resolves their
configured names dynamically. This is a source-use distinction, not permission
to drop those capabilities from a full recovery. A cross-name digest comparison
found **zero** non-Vault Edge entries matching a Vault value under another
name, so no additional credential can be claimed from the scheduled database
backup. [Names-only source and digest receipt](evidence/learn-build01-runtime-credential-usage-2026-10-17.json).

This is also a way around per-release approvals: code/source packages and
credential material have different change cycles. Keep the v107 source copy as
its own artifact, compare active credential digests to the protected recovery
inventory without reading plaintext, and refresh an encrypted credential copy
only when an actual credential rotates or a required binding is added. This
does **not** authorise standing secret capture; it limits when a future review
would be needed.

An independent TEST/LIVE digest-only check examined these 16 candidate
bindings. Three values match, two names exist in both with different values,
and eleven exist only in LIVE. TEST therefore cannot serve as the full
credential recovery source, and its matching values were not used for provider
calls or moved between projects. [Sanitised comparison](evidence/learn-build01-test-live-edge-digest-overlap-2026-10-17.json).

## Proposed smallest recovery path

1. Confirm which of the 16 credential/webhook candidates the actual Build 01
   functions require. Reissue the seven project bindings at restore, use the
   21 digest-matched controls from reviewed material and the database snapshot,
   resolve the active Google OAuth client ID, verify whether the optional
   Workspace client ID must be reissued for setup, and preserve the tenant-row
   Workspace subject rather than copying its unused global setting. Include
   only credentials needed
   to restart the approved Phone, Email, Commusoft, Slack and LEARN routes.
   Record names, source item references and active-value digest matches
   without disclosing values in a report.
2. Make one controlled read of the remaining credentials from their existing
   authorised source. Stage them only in memory, age-encrypt to the existing
   public recipient in `infrastructure/database-backup/public-recipient.json`,
   and retain the ciphertext under `.verification-results/` with mode `0600`.
   No plaintext `.env`, shell argument, log, Git artifact or dashboard paste.
   If an entry is unavailable, stop and report its exact name and affected
   capability; never manufacture a replacement.
3. After byte/hash review, create only a content-addressed object under
   `projects/tgbnakbxwcqjeimygroz/objects/` in the existing private London
   bucket `openfolk-serviceos-database-235099643372-eu-west-2`. Use the
   existing scoped Writer identity, then the separate Restore identity for an
   immutable-version download and hash check. No new destination.
4. Rehearse a replacement runtime without provider egress: restore the
   database/Auth/frontend/current Edge source, verify that recovered settings
   match the LIVE digest inventory, start the required functions, and hold
   inherited jobs before allowing a bounded synthetic job. Real provider
   resumption must be a separate controlled check, not inferred from startup.

This first copy would be manual and point-in-time. Unattended updates require
an independently scoped credential source and a rotation/alert design; do not
silently turn an unlocked desktop or repeated Touch ID into the daily runner.

The local package stage is now implemented in
`scripts/backup/stage_build01_edge_secret_package.mjs`. Its real mode accepts a
reviewed name/value/source-reference set only on standard input, permits only
the 16 named candidates, compares each value to the active LIVE Edge digest,
and age-encrypts directly from memory to a create-only mode-0600 file. It does
not upload or decrypt a real package. A synthetic two-credential roundtrip
passed with the pinned age binary and an ephemeral test identity; the temporary
ciphertext was removed. [Synthetic rehearsal](evidence/learn-build01-edge-credential-package-synthetic-2026-10-17.json).
Chris approved the one-time, scoped encrypted credential inventory and
off-site copy on 17 October. This does not authorise standing secret capture.
The first exact-item read matched and locally age-encrypted three required
values: the QuickBooks worker key and both Simwood fields. It found no active
digest match for the Google OAuth secret, Workspace private key, Slack Events
signing secret, OpenAI key, OpenFolk control-plane key or Phone webhook secret;
the two Google identifiers also remain unresolved. The local ciphertext is
**partial and has not been uploaded**. The missing names and affected routes
are in the [sanitised inventory](evidence/learn-build01-scoped-credential-inventory-2026-10-17.json).
Under the reviewed stop rule, no full-recovery claim or off-site credential
copy follows until an exact protected source or controlled reissue path is
established for each required value.

### Narrow recovery routes for the unmatched settings

These are next-source routes, **not completed credential recovery**:

| LIVE setting | Exact next source or reissue route | Acceptance still needed |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Inspect the existing OAuth client in the owning Google Cloud project; Google documents that its ID and current secret can be viewed in the console. Preserve the current client and compare both values with LIVE digests before copying either. | Existing client identity, redirect URI and a provider-free OAuth configuration check; no reset by default. |
| `GOOGLE_WORKSPACE_PRIVATE_KEY`, optional `GOOGLE_WORKSPACE_CLIENT_ID` | The private-key digest matches TEST, but neither project's management API yields the value. Google states a downloaded service-account key cannot be downloaded again. Locate an exact existing protected key copy; otherwise create a second key on the same service account under a controlled change and escrow it at creation. | Confirm the service-account identity, domain-wide delegation, bounded mailbox access and old/new key overlap before retiring the old key. |
| `LEARN_SLACK_EVENTS_SIGNING_SECRET` | Read the signing secret from **Basic Information** of the already installed Drummonds app, as Slack documents, and compare with LIVE digest. Do not regenerate it for inventory. | Signed request denial/acceptance against the replacement route and exact approved public-channel roster; DMs remain excluded. |
| `OPENAI_API_KEY` | Find a named protected copy if one exists. OpenAI says an existing full key cannot be viewed after creation; absent a copy, create a replacement project key in a separately reviewed cutover and escrow it immediately. | Scoped project/permission check, bounded model call, then old-key retirement only after the replacement works. |
| `OPENFOLK_CONTROLPLANE_KEY` | Treat as a dedicated internal machine key, not the project service key. Map every caller supplying `x-openfolk-machine-key` before a controlled replacement. | Caller/server equality, denied wrong-key requests, audited actor boundary. |
| `PHONE_OPERATIONS_WEBHOOK_SECRET` | Identify the configured Vapi/Twilio sender of `x-phone-operations-secret` before a controlled replacement; the current value is not in the two reviewed 1Password items. | Provider callback identity, denied wrong secret and one bounded valid callback; confirm whether this alert route is active in Build 01. |

The Google [OAuth credential guide](https://developers.google.com/identity/openid-connect/openid-connect)
and [service-account key guide](https://docs.cloud.google.com/iam/docs/keys-create-delete),
Slack's [signed-request guide](https://api.slack.com/docs/verifying-requests-from-slack),
and OpenAI's [key-visibility guidance](https://help.openai.com/en/articles/4936850-where-%20do-i-find-my-secret-api-key)
support the provider-specific retrieval limits above. Current owner access to
those consoles and any proposed credential changes have not been verified.

## Decision and risk

The earlier approvals covered the exact database backup and exact Edge **source**
package, not a new package of provider/API credentials. This copy would be
more sensitive: the encrypted object plus recovery identity could enable
provider actions after restoration. The public age recipient allows encryption
without a fingerprint, but collecting values from their current source may
require one deliberate 1Password approval. Keep the recovery private key out
of the unattended runner. Delete temporary plaintext buffers/processes and
verify all local restore containers and browser profiles are removed.

If Chris instead accepts a documented, human-led 1Password re-entry during
disaster recovery, retain that as a visible manual dependency. It cannot be
reported as independently recoverable full application configuration.
