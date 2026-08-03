// Gmail Marketing adapter — the ONE registered external-side-effect connector
// (the governed Marketing email capability). It executes exactly two intent
// types through the same single provider call: the Phase-4 delegated TEST
// send (send_marketing_test_email) and the Phase-5 approval-required
// BROADCAST recipient send (send_marketing_broadcast_email). The two frozen
// envelope shapes are disjoint exact allowlists discriminated by `purpose` —
// neither can smuggle the other's fields. Broadcast sends additionally
// recheck the ONE canonical SQL authority (campaign active, exact bound
// revision/snapshot/member, launch approval still valid, sender ready,
// capability enabled, endpoint unchanged, CURRENT eligibility exactly
// 'subscribed') immediately before the provider call; a refusal is a
// pre-provider POLICY SKIP, never a false failure and never a silent rewrite.
//
// Discipline (same contract as every adapter, enforced by conformance G6):
//  - executes ONLY the claimed immutable envelope the engine hands it. The
//    provider message is built EXCLUSIVELY from the FROZEN envelope values
//    (from name, reply-to, signature, subject, body, recipient) — editing a
//    sender after the request can never change what is sent. The sender row
//    is re-read ONLY to confirm current operational eligibility (ownership,
//    source attachment, readiness); if the frozen envelope is no longer
//    safely executable the send is BLOCKED before the provider call, never
//    silently altered;
//  - re-checks the REQUESTING ACTOR'S CURRENT AUTHORITY before any provider
//    call, through the canonical SQL resolver (marketing_effective_permissions)
//    — never an independent permission model: an actor who was removed, moved
//    tenant, or lost marketing.campaigns.test blocks permanently;
//  - resolves credentials SERVER-SIDE (OAuth token row / a minimal DWD
//    gmail.send-only token) — nothing rides the job payload and no token ever
//    appears in a result;
//  - re-validates CURRENT state at execution time: marketing enabled, sender
//    enabled + canonical READINESS (marketing_sender_readiness — the same
//    derivation used by enablement/capability sync), envelope↔sender source
//    agreement, capability still enabled for the tenant, recipient still the
//    same same-tenant profile email;
//  - for the RESEND SANDBOX identity (onboarding@resend.dev) additionally
//    proves GENUINE TEST-TO-SELF at the final pre-provider boundary: purpose
//    'test', recipient_profile_id === actor_profile_id, recipient in the same
//    tenant, recipient email still the frozen envelope address, and the actor's
//    own current profile email present, valid and that same address. Campaign
//    and sequence use is refused. Every refusal returns before the provider
//    call, so a refused sandbox send makes ZERO network requests — the rule is
//    never delegated to Resend's own sandbox rejection;
//  - performs NO writes of any kind and emits nothing — it returns one
//    sanitized result; the engine records it and the marketing reconciler
//    projects it;
//  - classifies conservatively: 429 is proof of provider rejection (safe
//    bounded retry); a 5xx or lost response is UNKNOWN — Gmail has no
//    idempotency key for messages.send, so an uncertain result FREEZES for
//    reconciliation/human review rather than risking a duplicate send;
//  - FAILS CLOSED on every mandatory pre-provider read: a database/resolver
//    ERROR is never conflated with a negative answer — it becomes a SAFE
//    RETRYABLE pre-provider failure (nothing was sent), while a genuine
//    missing/moved/denied actor, sender, capability or recipient is a
//    PERMANENT refusal. The adapter never proceeds on absent or partial
//    authority data.
//
// Envelope integrity note: the claim RPC has already verified the envelope
// hash against the authorised payload hash (engine P1-5) — the parameters
// this adapter receives ARE the authorised envelope; shape is still
// re-validated against the EXACT declared allowlist.

import type {
  AutomationConnectorAdapter,
  ConnectorExecutionContext,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";
import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";
import {
  buildBroadcastMime,
  buildMarketingMime,
  classifyGmailSendFailure,
  composeMarketingBody,
  escapeHtml,
  evaluateActorAuthority,
  evaluateGmailSendScope,
  evaluateSandboxSelfSend,
  RESEND_SANDBOX_ADDRESS,
  sanitizeGmailSendResponse,
  validateMarketingEnvelope,
} from "../marketing_email.ts";
import { getGoogleOAuthConfig, refreshGmailAccessToken } from "../gmail_oauth.ts";
import { DelegationError, getDelegatedGmailSendToken } from "../google_workspace.ts";
import { composeFrom, isPlausibleResendKey, sendViaResend } from "./resend_transport.ts";
import { injectTrackingHtml, isUsableTrackingSecret, openToken } from "../marketing_tracking.ts";

const CAPABILITY = "email.send_marketing";
const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_SKEW_MS = 60_000;

function permanent(code: string, message: string): ConnectorExecutionResult {
  return {
    outcome: "failed_permanent",
    errorCode: code,
    errorMessage: message.slice(0, 200),
    retryable: false,
  };
}
function transient(code: string, message: string): ConnectorExecutionResult {
  return {
    outcome: "failed_transient",
    errorCode: code,
    errorMessage: message.slice(0, 200),
    retryable: true,
  };
}
function unknownResult(code: string, message: string): ConnectorExecutionResult {
  return {
    outcome: "unknown",
    errorCode: code,
    errorMessage: message.slice(0, 200),
    retryable: false,
  };
}

// Simple HTML for a plain-text test envelope: escape, split on blank lines into
// paragraphs, append the signature block. Broadcast/sequence envelopes carry
// their own rendered body_html and never reach this.
function composeTestHtml(bodyText: string, signatureText: string | null): string {
  const paras = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const sig =
    signatureText && signatureText.trim().length > 0
      ? `\n<hr>\n<p>${escapeHtml(signatureText).replace(/\n/g, "<br>")}</p>`
      : "";
  return `<div>\n${paras}${sig}\n</div>`;
}

export const marketingEmailAdapter: AutomationConnectorAdapter = {
  connectorType: "google-gmail",
  supportedIntentTypes: [
    "send_marketing_test_email",
    "send_marketing_broadcast_email",
    "send_marketing_sequence_email",
  ],
  adapterVersion: "1",

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (!input.parameters || typeof input.parameters !== "object") {
      return { ok: false, errorCode: "payload_invalid", errorMessage: "parameters missing" };
    }
    if (input.capabilityKey !== CAPABILITY) {
      return {
        ok: false,
        errorCode: "payload_invalid",
        errorMessage: `capability must be ${CAPABILITY}`,
      };
    }
    const v = validateMarketingEnvelope(input.parameters);
    if (!v.ok) return { ok: false, errorCode: "payload_invalid", errorMessage: v.error };
    // the intent TYPE and the envelope's declared purpose must agree — a test
    // intent can never carry a broadcast envelope, nor the reverse
    const expected =
      v.envelope.purpose === "broadcast"
        ? "send_marketing_broadcast_email"
        : v.envelope.purpose === "sequence"
          ? "send_marketing_sequence_email"
          : "send_marketing_test_email";
    if (input.intentType !== expected) {
      return {
        ok: false,
        errorCode: "payload_invalid",
        errorMessage: `intent type ${input.intentType} does not match envelope purpose ${v.envelope.purpose}`,
      };
    }
    return { ok: true };
  },

  async execute(
    input: ConnectorExecutionInput,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult> {
    const db = context.supabaseAdmin;
    const parsed = validateMarketingEnvelope(input.parameters);
    if (!parsed.ok) return permanent("payload_invalid", parsed.error);
    const env = parsed.envelope;
    const isBroadcast = env.purpose === "broadcast";
    const isSequence = env.purpose === "sequence";
    // both bulk paths execute on the recorded APPROVER's authority; a test
    // send on the requesting actor's delegated test permission
    const isGoverned = isBroadcast || isSequence;

    // ── execution-time rechecks (CURRENT state, never trusted from request
    // time). FAIL-CLOSED READ DISCIPLINE: every mandatory authority/state read
    // distinguishes "the database answered NO" (permanent refusal) from "the
    // database could not answer" (a read/resolver error). A read error before
    // the provider call is proof of NON-submission, so it maps to a SAFE
    // RETRYABLE pre-provider failure under the engine's retry contract —
    // never to proceeding on absent or partial authority data.
    const settingsRes = await db
      .from("marketing_settings")
      .select("marketing_enabled")
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (settingsRes.error) {
      return transient("settings_read_failed", "could not read marketing settings");
    }
    if (settingsRes.data && settingsRes.data.marketing_enabled === false) {
      return permanent("marketing_disabled", "marketing is disabled for this tenant");
    }

    // ACTOR AUTHORITY recheck — canonical resolver, current facts. A MISSING
    // actor (the read succeeded and found nothing) is a genuine permanent
    // refusal; a FAILED read or resolver call is a retryable inability to
    // establish authority — the two are never conflated.
    // `email` is read so the sandbox test-to-self boundary can prove the actor's
    // CURRENT canonical profile email (it is never used to build the message —
    // the frozen envelope is the message).
    const actorRes = await db
      .from("profiles")
      .select("id, tenant_id, email")
      .eq("id", env.actor_profile_id)
      .maybeSingle();
    if (actorRes.error) {
      return transient("actor_read_failed", "could not read the requesting actor");
    }
    const actorRow = (actorRes.data ?? null) as {
      id: string;
      tenant_id: string | null;
      email: string | null;
    } | null;
    const verdictRes = await db.rpc("marketing_effective_permissions", {
      p_profile_id: env.actor_profile_id,
    });
    if (verdictRes.error || verdictRes.data == null || typeof verdictRes.data !== "object") {
      return transient(
        "authority_resolver_unavailable",
        "could not resolve the actor's current authority",
      );
    }
    const authority = evaluateActorAuthority(
      {
        tenantId: input.tenantId,
        actor: actorRow,
        resolverVerdict: verdictRes.data as { enabled?: unknown; permissions?: unknown },
      },
      isGoverned ? "marketing.campaigns.launch" : "marketing.campaigns.test",
    );
    if (!authority.ok) return permanent(authority.code, authority.message);

    // sender: current operational eligibility ONLY (its mutable display
    // configuration is NEVER read into the message — the frozen envelope is
    // the message)
    const senderRes = await db
      .from("marketing_sender_profiles")
      .select(
        "id, tenant_id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address, enabled",
      )
      .eq("id", env.sender_profile_id)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (senderRes.error) {
      return transient("sender_read_failed", "could not read the sender profile");
    }
    const sender = senderRes.data;
    if (!sender) return permanent("sender_missing", "sender profile not found for tenant");
    if (!sender.enabled) return permanent("sender_disabled", "sender is disabled");
    if (
      sender.source_kind !== env.source_kind ||
      (sender.mailbox_address as string) !== env.mailbox_address
    ) {
      return permanent("sender_source_changed", "sender source no longer matches the envelope");
    }
    // canonical readiness — the SAME derivation enablement/capability use.
    // A failed derivation is a PRE-PROVIDER read failure (nothing was sent),
    // so it is a safe retryable refusal — not an unknown, not a pass.
    const readinessRes = await db.rpc("marketing_sender_readiness", {
      p_tenant: input.tenantId,
      p_sender: env.sender_profile_id,
    });
    if (readinessRes.error || readinessRes.data == null) {
      return transient("readiness_unavailable", "sender readiness could not be derived");
    }
    const readinessState = readinessRes.data as { ready?: unknown; state?: unknown };
    if (readinessState.ready !== true) {
      return permanent(
        "sender_not_ready",
        `sender is not ready to send (${String(readinessState.state ?? "unknown")})`,
      );
    }

    // The tenant_connector_capabilities gate is the GOOGLE mailbox enablement
    // flag; it does not apply to the Resend transport, whose sendability is
    // governed entirely by marketing_enabled + actor authority + sender
    // readiness (all already checked above) + the broadcast/sequence SQL
    // authority (below). A resend sender never touches Google connectors.
    if (env.source_kind !== "resend") {
      const capRes = await db
        .from("tenant_connector_capabilities")
        .select("enabled")
        .eq("tenant_id", input.tenantId)
        .eq("connector_id", "google-gmail")
        .eq("capability_key", CAPABILITY)
        .maybeSingle();
      if (capRes.error) {
        return transient("capability_read_failed", "could not read the tenant capability state");
      }
      if (!capRes.data?.enabled) {
        return permanent(
          "capability_disabled",
          "the marketing send capability is not enabled for tenant",
        );
      }
    }

    // the CURRENT recipient row for a test send (null for the bulk paths, which
    // address a Person rather than a tenant profile)
    let recipientRow: { id: string; tenant_id: string | null; email: string | null } | null = null;

    if (isGoverned) {
      // RACE CLOSURE (check 3 of 3): the ONE canonical SQL authority for this
      // path — for a broadcast the campaign/snapshot/member binding, for a
      // sequence the enrolment/revision/step binding —
      // campaign active + exact bound revision/snapshot/member + approval
      // still valid + endpoint/person unchanged + CURRENT eligibility exactly
      // 'subscribed' — IMMEDIATELY before the provider call. A refusal is a
      // pre-provider POLICY SKIP (permanent, policy_-prefixed) so the
      // reconciler records the recipient as skipped, never falsely failed.
      const authRes = await db.rpc(
        isBroadcast ? "marketing_broadcast_send_authority" : "marketing_sequence_send_authority",
        { p_tenant: input.tenantId, p_delivery: env.delivery_id },
      );
      if (authRes.error || authRes.data == null) {
        return transient("send_authority_unavailable", "broadcast authority could not be derived");
      }
      const verdict = authRes.data as { allowed?: unknown; code?: unknown };
      if (verdict.allowed !== true) {
        return permanent(
          `policy_${String(verdict.code ?? "blocked")}`,
          "marketing policy blocked this recipient before the provider call",
        );
      }
    } else {
      // recipient policy recheck: the SAME same-tenant profile, SAME email
      const recipientRes = await db
        .from("profiles")
        .select("id, tenant_id, email")
        .eq("id", env.recipient_profile_id)
        .maybeSingle();
      if (recipientRes.error) {
        return transient("recipient_read_failed", "could not read the recipient profile");
      }
      const recipient = recipientRes.data as {
        id: string;
        tenant_id: string | null;
        email: string | null;
      } | null;
      if (!recipient || recipient.tenant_id !== input.tenantId) {
        return permanent("recipient_invalid", "recipient is not a profile of this tenant");
      }
      if ((recipient.email ?? "").toLowerCase() !== env.recipient_email) {
        return permanent("recipient_changed", "recipient email changed since the request");
      }
      recipientRow = recipient;
    }

    // ── Resend transport branch ──────────────────────────────────────────
    // For a `resend` sender the provider is the platform Resend API keyed by a
    // server-resolved secret (never in the payload). The message is built
    // EXCLUSIVELY from the frozen envelope: subject, recipient, from-address +
    // from-name, reply-to, and the body (html for broadcast/sequence, composed
    // from the plain body + signature for a test). Result classification and
    // the write-free contract are identical to the Gmail path.
    if (env.source_kind === "resend") {
      const denoEnv = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
        .Deno?.env;
      const apiKey = denoEnv?.get("RESEND_API_KEY");
      // FAIL CLOSED: a missing / placeholder / malformed key is an honest,
      // retryable operator-config gap — nothing is sent, no network call, and
      // a simulated value can never become a success.
      if (!isPlausibleResendKey(apiKey ?? null)) {
        return transient(
          "resend_not_configured",
          "RESEND_API_KEY is missing or not a valid Resend key",
        );
      }
      // SANDBOX GUARD — GENUINE TEST-TO-SELF, at the final pre-provider
      // boundary. The resend.dev sandbox identity may ONLY carry a governed
      // test send that the requesting actor addressed to THEMSELVES: same
      // profile id, same tenant, the recipient's current email still equal to
      // the frozen envelope address, and the actor's own current profile email
      // present, valid and that same address. Broadcast/sequence use fails
      // closed. Every refusal returns HERE, before any network call — we never
      // rely on Resend rejecting an unauthorised recipient for us.
      if (env.mailbox_address === RESEND_SANDBOX_ADDRESS) {
        const selfVerdict = evaluateSandboxSelfSend({
          tenantId: input.tenantId,
          purpose: env.purpose,
          actorProfileId: env.actor_profile_id,
          recipientProfileId: env.recipient_profile_id,
          envelopeRecipientEmail: env.recipient_email,
          actor: actorRow,
          recipient: recipientRow,
        });
        if (!selfVerdict.ok) return permanent(selfVerdict.code, selfVerdict.message);
      }
      let text: string;
      let html: string;
      if (env.purpose === "test") {
        text = composeMarketingBody(env.body_text, env.signature_text);
        html = composeTestHtml(env.body_text, env.signature_text);
      } else {
        text = env.body_text;
        html =
          env.body_html && env.body_html.length > 0
            ? env.body_html
            : `<div>${escapeHtml(env.body_text)}</div>`;
      }
      // open/click tracking: signed pixel + destination-bound rewritten links.
      // Write-free — the adapter only SIGNS; the public marketing-track endpoint
      // verifies + records. Enabled only when the secret + functions base exist.
      // the SAME strength bar the public endpoint applies: we never sign with a
      // secret weak enough to guess — tracking is simply omitted instead.
      const rawTrackingSecret = denoEnv?.get("MARKETING_TRACKING_SECRET");
      const trackingSecret = isUsableTrackingSecret(rawTrackingSecret) ? rawTrackingSecret : null;
      const functionsBase = denoEnv?.get("SUPABASE_URL");
      if (trackingSecret && functionsBase) {
        const base = `${functionsBase.replace(/\/$/, "")}/functions/v1/marketing-track`;
        const openTok = await openToken(trackingSecret, env.delivery_id);
        const openUrl = `${base}?d=${encodeURIComponent(env.delivery_id)}&k=open&t=${encodeURIComponent(openTok)}`;
        html = await injectTrackingHtml(html, {
          openUrl,
          clickBase: base,
          deliveryId: env.delivery_id,
          secret: trackingSecret,
        });
      }
      const result = await sendViaResend(
        {
          apiKey,
          from: composeFrom(env.mailbox_address, env.from_name),
          to: env.recipient_email,
          replyTo: env.reply_to ?? null,
          subject: env.subject,
          html,
          text,
          deliveryId: env.delivery_id,
        },
        { signal: context.signal ?? null },
      );
      if (result.outcome === "succeeded") {
        return {
          outcome: "succeeded",
          externalReference: result.id,
          result: {
            message_id: result.id,
            delivery_id: env.delivery_id,
            transport: "resend",
            submitted_at: context.now,
          },
          retryable: false,
        };
      }
      if (result.outcome === "failed_transient") return transient(result.code, result.message);
      if (result.outcome === "failed_permanent") return permanent(result.code, result.message);
      return unknownResult(result.code, result.message);
    }

    // ── credentials, server-side only (Gmail / Workspace) ──
    let accessToken: string;
    if (env.source_kind === "gmail_oauth") {
      if (!sender.email_account_id) {
        return permanent("sender_source_missing", "sender source mailbox is disconnected");
      }
      // the token must belong to THIS TENANT's account — never id-only
      const tokenRes = await db
        .from("email_oauth_tokens")
        .select("access_token, refresh_token, expires_at, scope")
        .eq("email_account_id", sender.email_account_id)
        .eq("tenant_id", input.tenantId)
        .maybeSingle();
      if (tokenRes.error) {
        return transient("gmail_token_read_failed", "could not read the stored authorisation");
      }
      const token = tokenRes.data;
      if (!token?.access_token) {
        return permanent("gmail_auth_missing", "no stored authorisation for this account");
      }
      if (evaluateGmailSendScope(token.scope ?? null) !== "authorized") {
        return permanent(
          "gmail_send_scope_missing",
          "gmail.send is not granted — re-authorisation required",
        );
      }
      accessToken = token.access_token as string;
      const expiresMs = token.expires_at ? Date.parse(token.expires_at as string) : 0;
      if (!expiresMs || expiresMs - Date.now() < TOKEN_SKEW_MS) {
        if (!token.refresh_token) {
          return permanent("gmail_auth_expired", "token expired and no refresh token stored");
        }
        const cfg = getGoogleOAuthConfig();
        if (!cfg) return permanent("config_error", "Google OAuth secrets not configured");
        try {
          // in-memory refresh only: this adapter performs no writes, so the
          // refreshed token is used for this execution and discarded (the
          // ingestion sync path owns durable refresh persistence)
          const refreshed = await refreshGmailAccessToken(cfg, token.refresh_token as string);
          if (evaluateGmailSendScope(refreshed.scope ?? token.scope ?? null) !== "authorized") {
            return permanent(
              "gmail_send_scope_missing",
              "gmail.send missing from refreshed grant — re-authorisation required",
            );
          }
          accessToken = refreshed.accessToken;
        } catch (e) {
          const permanentRefresh =
            typeof e === "object" && e !== null && (e as { permanent?: boolean }).permanent;
          const code =
            typeof e === "object" && e !== null && typeof (e as { code?: string }).code === "string"
              ? (e as { code: string }).code
              : "refresh_failed";
          return permanentRefresh
            ? permanent(`gmail_${code}`, "gmail authorisation revoked — re-connect the account")
            : transient(`gmail_${code}`, "gmail token refresh temporarily unavailable");
        }
      }
    } else {
      if (!sender.workspace_mailbox_id) {
        return permanent("sender_source_missing", "sender source mailbox is disconnected");
      }
      try {
        const minted = await getDelegatedGmailSendToken(env.mailbox_address);
        accessToken = minted.accessToken;
      } catch (e) {
        if (e instanceof DelegationError) {
          return e.permanent
            ? permanent(`dwd_${e.code}`, "workspace delegation refused gmail.send")
            : transient(`dwd_${e.code}`, "workspace delegation temporarily unavailable");
        }
        return unknownResult("dwd_mint_unknown", "delegated token mint failed unexpectedly");
      }
    }

    // ── standards-compliant MIME from the FROZEN ENVELOPE ONLY ──
    let raw: string;
    try {
      if (env.purpose === "broadcast" || env.purpose === "sequence") {
        const mime = buildBroadcastMime({
          fromAddress: env.mailbox_address,
          fromName: env.from_name,
          to: env.recipient_email,
          replyTo: env.reply_to,
          subject: env.subject,
          textBody: env.body_text,
          htmlBody: env.body_html,
          unsubscribeUrl: env.unsubscribe_url,
          deliveryId: env.delivery_id,
        });
        raw = mime.raw;
      } else {
        const mime = buildMarketingMime({
          fromAddress: env.mailbox_address,
          fromName: env.from_name,
          to: env.recipient_email,
          replyTo: env.reply_to,
          subject: env.subject,
          bodyText: env.body_text,
          signatureText: env.signature_text,
          deliveryId: env.delivery_id,
        });
        raw = mime.raw;
      }
    } catch (e) {
      return permanent("mime_rejected", e instanceof Error ? e.message : "mime build failed");
    }

    // ── the ONE provider call ──
    let resp: Response;
    let bodyText = "";
    try {
      resp = await fetch(GMAIL_SEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw }),
        signal: context.signal ?? null,
      });
      bodyText = await resp.text();
    } catch {
      // network failure / lost response: Gmail may or may not have accepted —
      // UNKNOWN, frozen for reconciliation; never an automatic resend
      return unknownResult("gmail_response_lost", "no response from Gmail — result unknown");
    }

    if (resp.ok) {
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        parsedBody = null;
      }
      const sanitized = sanitizeGmailSendResponse(parsedBody);
      if (!sanitized) {
        // 2xx without a message id: submission likely but unproven — unknown
        return unknownResult("gmail_response_unparseable", "accepted response had no message id");
      }
      return {
        outcome: "succeeded",
        externalReference: sanitized.messageId,
        result: {
          message_id: sanitized.messageId,
          thread_id: sanitized.threadId,
          delivery_id: env.delivery_id,
          submitted_at: context.now,
        },
        retryable: false,
      };
    }

    const cls = classifyGmailSendFailure(resp.status, bodyText);
    if (cls.kind === "transient") {
      return transient(cls.code, "Gmail rejected the request (retryable)");
    }
    if (cls.kind === "permanent") {
      return permanent(
        cls.code,
        cls.needsReconsent
          ? "Gmail refused: re-authorisation with gmail.send is required"
          : "Gmail refused the request",
      );
    }
    return unknownResult(cls.code, "Gmail returned an uncertain result — frozen for review");
  },
};
