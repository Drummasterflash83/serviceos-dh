// ServiceOS — Shared Worker Handlers (Deno). The ONE place each job type's
// business logic lives.
//
// A handler is PURE business logic: given a validated tenant, a service-role
// client, the job payload and the authoritative platform_jobs id, it does the
// work and returns a structured result. It NEVER creates/completes the
// platform_jobs row (the caller owns the job lifecycle) and NEVER derives the
// tenant from browser input — the caller passes an already-validated tenantId.
//
// Two callers share each handler with NO duplicated logic:
//   • platform-worker  — claims a job, calls the handler DIRECTLY (no HTTP), then
//     completes/retries/dead-letters the claimed row from the result.
//   • the Edge Function — a thin wrapper: CORS + parse + auth + validation, then
//     the same handler, then formats the HTTP response.
//
// Registering a future connector (Slack, Commusoft, M365, Stripe, …) is just a
// new handler file + one registry line — the worker never changes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import { handlePhoneProcessPending } from "./phone_process_pending.ts";
import { handleInteractionsSync } from "./interactions_sync.ts";
import { handleIdentityResolve } from "./identity_resolve.ts";
import { handleBusinessGraphSync } from "./business_graph_sync.ts";
import { handleCustomerCardSync } from "./customer_card_sync.ts";
import { handleRecommendationSync } from "./recommendation_sync.ts";
import {
  handleEmailGmailSync,
  handleEmailWorkspaceSync,
  handleEmailWorkspaceBackfill,
  handleEmailMailboxDiscovery,
} from "./email_sync.ts";

export interface WorkerHandlerContext {
  /** Service-role client (bypasses RLS). Business writes go through this. */
  supabaseAdmin: SupabaseClient;
  /** Already-validated tenant — NEVER trust browser input for this. */
  tenantId: string;
  /** The authoritative platform_jobs row this work belongs to (queue job when
   *  invoked by the worker, manual job in the wrapper), or null when untracked.
   *  Handlers may update PROGRESS on it but never create/complete it. */
  jobId: string | null;
  /** Validated job payload / request body. */
  payload: Record<string, unknown>;
  /** Cooperative cancellation, where a handler chooses to honour it. */
  signal?: AbortSignal;
}

/** Structured error contract the worker uses to decide retry vs dead-letter. */
export interface WorkerHandlerError {
  code: string;
  message: string; // safe: never a secret or customer content
  retryable: boolean;
  failedStep?: string;
}

export interface WorkerHandlerResult {
  success: boolean;
  recordsProcessed?: number;
  result?: Record<string, unknown>;
  /** Present when success === false. */
  error?: WorkerHandlerError;
}

export type WorkerHandler = (ctx: WorkerHandlerContext) => Promise<WorkerHandlerResult>;

/**
 * job_type → shared handler. The generic worker holds NO provider logic and runs
 * every supported job type IN-PROCESS (no worker→orchestrator HTTP). A future
 * connector registers here with no worker change.
 */
export const WORKER_HANDLERS: Record<string, WorkerHandler> = {
  "phone.process_pending": handlePhoneProcessPending,
  "interactions.sync": handleInteractionsSync,
  "identity.resolve": handleIdentityResolve,
  "graph.sync": handleBusinessGraphSync,
  "customer_card.sync": handleCustomerCardSync,
  "recommendation.sync": handleRecommendationSync,
  "email.gmail_sync": handleEmailGmailSync,
  "email.workspace_sync": handleEmailWorkspaceSync,
  "email.workspace_backfill": handleEmailWorkspaceBackfill,
  "email.mailbox_discovery": handleEmailMailboxDiscovery,
};

export function getWorkerHandler(jobType: string): WorkerHandler | null {
  return WORKER_HANDLERS[jobType] ?? null;
}

/** Convenience for wrappers/worker: turn a thrown error into the safe contract. */
export function toHandlerError(e: unknown, fallbackCode: string): WorkerHandlerError {
  const message = e instanceof Error ? e.message : `${fallbackCode} failed`;
  return { code: fallbackCode, message: message.slice(0, 500), retryable: true };
}
