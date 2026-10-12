// ServiceOS — Shared Worker Handlers (Deno). The ONE place each job type's
// business logic lives.
//
// A handler is PURE business logic: given a validated tenant, a service-role
// client, the job payload and the authoritative platform_jobs id, it does the
// work and returns a structured result. Durable email handlers settle the queue
// atomically and return queueOutcome; other handlers leave settlement to the caller.
// No handler derives the
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

import type { WorkerHandler, WorkerHandlerError } from "../worker_contract.ts";

import { handleSlackHistorySync } from './slack_history.ts';
import { handleMicrosoftCapture } from "../microsoft_capture_handler.ts";
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
import { handleIntelligenceEvaluate } from "./intelligence_evaluate.ts";
import { handleIntelligenceIngest } from "./intelligence_ingest.ts";
import { handleIntelligenceObserve } from "./intelligence_observe.ts";
import { handleIntelligenceReviewResolve } from "./intelligence_review_resolve.ts";
import { handleObjectiveEvaluate } from "./objective_evaluate.ts";
import { handleAutomationExecute } from "./automation_execute.ts";
import { handleMarketingDeliverySync } from "./marketing_delivery_sync.ts";
import { handleMarketingBroadcastDispatch } from "./marketing_broadcast_dispatch.ts";
import { handleMarketingSequenceAdvance } from "./marketing_sequence_advance.ts";
import { handleMarketingAdLeadProcess } from "./marketing_ad_lead.ts";
import { handleMarketingProviderSync } from "./marketing_provider_sync.ts";
import { handleMarketingProviderConnect } from "./marketing_provider_connect.ts";

export type { WorkerHandlerContext, WorkerHandlerError, WorkerHandlerContinuation, WorkerHandlerResult, WorkerHandler } from "../worker_contract.ts";

/**
 * job_type → shared handler. The generic worker holds NO provider logic and runs
 * every supported job type IN-PROCESS (no worker→orchestrator HTTP). A future
 * connector registers here with no worker change.
 */
export const WORKER_HANDLERS: Record<string, WorkerHandler> = {
  "email.microsoft_discovery": handleMicrosoftCapture,
  "email.microsoft_sync": handleMicrosoftCapture,
  "slack.history_sync": handleSlackHistorySync,
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
  "intelligence.evaluate": handleIntelligenceEvaluate,
  "intelligence.ingest_interaction": handleIntelligenceIngest,
  "intelligence.observe": handleIntelligenceObserve,
  "intelligence.review_resolve": handleIntelligenceReviewResolve,
  "objective.evaluate": handleObjectiveEvaluate,
  "automation.execute": handleAutomationExecute,
  "marketing.delivery_sync": handleMarketingDeliverySync,
  "marketing.broadcast_dispatch": handleMarketingBroadcastDispatch,
  "marketing.sequence_advance": handleMarketingSequenceAdvance,
  "marketing.ad_lead_process": handleMarketingAdLeadProcess,
  "marketing.provider_sync": handleMarketingProviderSync,
  "marketing.provider_connect": handleMarketingProviderConnect,
};

export function getWorkerHandler(jobType: string): WorkerHandler | null {
  return WORKER_HANDLERS[jobType] ?? null;
}

/** Convenience for wrappers/worker: turn a thrown error into the safe contract. */
export function toHandlerError(e: unknown, fallbackCode: string): WorkerHandlerError {
  const message = e instanceof Error ? e.message : `${fallbackCode} failed`;
  return { code: fallbackCode, message: message.slice(0, 500), retryable: true };
}
