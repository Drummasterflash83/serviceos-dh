# Source Adapter Pattern

**One pattern for every source.** Telephony, email, Slack and Commusoft all reach ServiceOS the same way. New sources (Microsoft 365, Teams, Calendar, HR, CRM, access control, …) are added by writing an *adapter*, not by adding a screen, a person model, or a bespoke pipeline. This is what lets the platform scale to 15 sources / 500 staff / 250k customers without fragmenting.

## The pipeline

```text
PROVIDER  →  ADAPTER (evidence)  →  CANONICAL NORMALISATION  →  CANDIDATE  →  OPERATOR REVIEW  →  CONFIRMED LINK  →  USE
```

| Stage | Rule | Where it lives |
|---|---|---|
| **Provider** | The external system (Sipcentric, Google, Slack, Commusoft). | — |
| **Adapter** | Understands provider quirks and field names. **Read-only.** Emits a provider-neutral, normalised record. This is the ONLY place a provider's shape is known. | `_shared/<provider>/…` |
| **Canonical normalisation** | Provider-neutral. Turns normalised evidence into a **candidate** against a canonical entity, with **confidence + evidence + provenance + ambiguity**. | `_shared/controlplane/<domain>_identity.ts` |
| **Candidate** | A *proposal*, never a fact. Unresolved/ambiguous are preserved; nothing is auto-confirmed. | projection output |
| **Operator review** | A human confirms / rejects / replaces, governed + audited. | `cp_review_identity`, `endpoint_identity_reviews` |
| **Confirmed link** | Only now does a canonical link exist. | `member_integration_identities` |
| **Use** | Downstream (Health, Command Centre, preview) consumes **confirmed** evidence only. | projections |

## Invariants (every adapter obeys these)

1. **The adapter is the only provider-aware code.** Downstream never learns a provider's field names. Swap providers ⇒ new adapter, nothing else changes. *(e.g. `caller_id_labels.ts` knows `"Name <ext>"`; `slack_users.ts` knows `is_bot`/`USLACKBOT`; the canonical suggesters know neither.)*
2. **A source id is never a canonical id.** A Slack user id, a telephony extension, a Commusoft `UUID`, a mailbox — all are *evidence for a link*, never the canonical person/customer id.
3. **Evidence ≠ identity.** A provider label (`"Mary - Clients <103>"`, a mailbox display name, a Slack handle) is evidence carrying confidence, never the identity itself.
4. **Never auto-confirm.** Even an exact verified-email match is *high confidence, still reviewable*. Confirmation is an explicit, governed operator action.
5. **Confidence + provenance on every candidate.** `high | medium | low | unresolved`; provenance names the source of truth (provider inference / operator / manual review).
6. **Preserve unresolved & ambiguous.** Multiple matches ⇒ `unresolved` + `ambiguity[]`, surfaced for review — never a forced (possibly wrong) link.
7. **Links are temporal.** Effective-dated; reassignment (an extension/mailbox/Slack account moving between people) is preserved, never overwritten.
8. **Read-only, least privilege, phased.** Discover identity before touching content; request the narrowest scopes; fail **closed** on a missing/revoked connection.
9. **Secrets stay in Vault.** Only non-secret metadata + `has_secrets: boolean` ever reach OpenFolk. Tokens are never displayed.
10. **Reuse canonical models.** `team_members`, `communication_endpoints`, `member_integration_identities`, `endpoint_ownership_assignments`, `endpoint_identity_reviews`, `provider_connections`. A new source almost never needs a new table.

## The pattern instantiated

| Source | Adapter (evidence) | Canonical suggester | Endpoint kind | Notes |
|---|---|---|---|---|
| **Telephony** (Sipcentric) | `_shared/telephony/caller_id_labels.ts` (parse `Name <ext>`) | `_shared/controlplane/telephony_identity.ts` | `extension` / `ddi` | candidates derived from call activity |
| **Email** (Google Workspace) | `_shared/google_workspace.ts` + discovery | `_shared/controlplane/identity_resolution.ts` | `email` / `shared_mailbox` | default-deny domain boundary |
| **Slack** | `_shared/slack/slack_users.ts` (classify person/bot/app/system) | `_shared/controlplane/slack_identity.ts` | `slack_user` | Workspace Discovery = identity only, no messages |
| **Commusoft** (backup) | universal CSV/XLSX import profile | canonical jobs/sites + entity resolution | — | operational truth; batch, idempotent by `UUID`+`LastModifiedDateTime` |
| **future** (M365/Teams/Calendar/HR/CRM/…) | new `_shared/<provider>/…` adapter | reuse or extend a canonical suggester | new endpoint kind if needed | **no new screen** |

## Adding a new source (checklist)

1. Write a **read-only adapter** under `_shared/<provider>/…` that normalises the provider directory/records (pure, unit-tested with fixtures).
2. Classify non-people (bots/apps/system/shared) so they are *seen but never suggested as people*.
3. Reuse (or extend) a **canonical suggester** to emit candidates with confidence/evidence/provenance/ambiguity.
4. Reuse the connection model (`provider_connections` + Vault broker + OAuth state) — request the **narrowest phased scopes**.
5. Project candidates into `communication_endpoints`; **never** write ownership from discovery.
6. Surface the source in the **Person Intelligence Hub** Connected-systems section (states: not connected → connection available → discovery pending → candidate → ambiguous → confirmed → deactivated → revoked/error). No per-source screen.
7. Confirm via the existing `cp_review_identity` review path.
8. Downstream consumes **confirmed** evidence only.

## Why this proves the platform

Because the *interesting* work — canonical entities, identity confirmation, ownership, Health, the Command Centre, the operator preview — is written **once** and is provider-agnostic. Each source is a thin, testable adapter feeding the same machine. Adding Slack changed no downstream logic; adding the next source won't either. That is the difference between building a platform and accumulating integrations.
