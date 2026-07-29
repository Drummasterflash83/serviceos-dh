// Universal Automation Engine — connector adapter contract + registry.
//
// An adapter is the ONLY place a connector-specific operation runs. It is
// deliberately DUMB about business policy: it validates its operation, executes it
// with server-side-resolved credentials, and returns a universal, SANITIZED
// ConnectorExecutionResult. It NEVER decides approval, authority or Operational
// Mode, NEVER creates Actions/Decisions, NEVER mutates intent lifecycle tables, and
// NEVER publishes platform events — the universal executor (worker handler) owns all
// of that. Registering a connector is a new adapter file + one registry line.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";

/** The resolved, immutable operation to execute (built from the persisted intent). */
export interface ConnectorExecutionInput {
  tenantId: string;
  intentId: string;
  intentType: string;
  capabilityKey: string;
  operationType: string;
  /** The intent's IMMUTABLE parameters — an adapter may read, never expand scope. */
  parameters: Record<string, unknown>;
  /** Deterministic idempotency key — passed to the provider where supported. */
  idempotencyKey: string;
  correlationId: string | null;
}

/** Secure server-side context. Credentials/clients are resolved here, NEVER passed
 *  through the job payload. Internal adapters may use the admin client; external
 *  adapters receive resolved provider credentials (added when such adapters land). */
export interface ConnectorExecutionContext {
  supabaseAdmin: SupabaseClient;
  now: string;
  signal?: AbortSignal;
}

export interface ValidationResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface AutomationConnectorAdapter {
  connectorType: string;
  supportedIntentTypes: string[];
  /** Adapter code version — bound into the execution envelope hash + recorded on the
   *  attempt. Must match the capability's registered contract adapter_version to execute. */
  adapterVersion: string;
  validate(input: ConnectorExecutionInput): ValidationResult;
  execute(
    input: ConnectorExecutionInput,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult>;
  /** Optional: reconcile an UNKNOWN external result. Only where the provider
   *  supports status lookup; otherwise the executor routes for review. */
  getStatus?(
    externalReference: string,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult>;
}

import { controlledTestAdapter } from "./controlled_test.ts";
import { internalNoteAdapter } from "./internal_note.ts";
import { emailReplyDraftAdapter } from "./email_reply_draft.ts";
import { marketingEmailAdapter } from "./marketing_email.ts";

// Registry. The three internal adapters are SAFE and side-effect-free
// (email.reply_draft PREPARES a reply artifact, it never transmits). The
// marketing email adapter (Marketing Phase 4) is the FIRST — and only —
// registered EXTERNAL adapter: the governed Marketing email capability,
// external_side_effect = true, fully registered (contract row, intent type,
// per-tenant enablement via verified sender setup only) and executable solely
// through the untouched universal executor. Adding any further transmitting
// connector remains an explicit, reviewed change.
export const AUTOMATION_ADAPTERS: AutomationConnectorAdapter[] = [
  controlledTestAdapter,
  internalNoteAdapter,
  emailReplyDraftAdapter,
  marketingEmailAdapter,
];

/** Resolve the adapter that supports an intent type, or null if none (unsupported
 *  intents — e.g. schedule_engineer_visit — resolve to null and never execute). */
export function getAdapterForIntentType(intentType: string): AutomationConnectorAdapter | null {
  return AUTOMATION_ADAPTERS.find((a) => a.supportedIntentTypes.includes(intentType)) ?? null;
}
