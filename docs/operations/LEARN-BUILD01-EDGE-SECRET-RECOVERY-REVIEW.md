# Build 01 — Edge runtime-secret recovery decision

**Prepared 17 October 2026. No runtime secret copy or production change has
been made under this review.** The independently restored database/Auth/Edge
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

[Non-secret reconstruction evidence](evidence/learn-build01-nonsecret-runtime-reconstruction-2026-10-17.json).

This is also a way around per-release approvals: code/source packages and
credential material have different change cycles. Keep the v107 source copy as
its own artifact, compare active credential digests to the protected recovery
inventory without reading plaintext, and refresh an encrypted credential copy
only when an actual credential rotates or a required binding is added. This
does **not** authorise standing secret capture; it limits when a future review
would be needed.

## Proposed smallest recovery path

1. Confirm which of the 16 credential/webhook candidates the actual Build 01
   functions require. Reissue the seven project bindings at restore, use the
   21 digest-matched controls from reviewed material and the database snapshot,
   resolve the remaining three controls, and include only credentials needed
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
