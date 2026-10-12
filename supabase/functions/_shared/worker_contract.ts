/** Shared type-only worker contract, independent of the broad handler registry. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface WorkerHandlerContext {
  /** Service-role client (bypasses RLS). Business writes go through this. */
  supabaseAdmin: SupabaseClient;
  /** Already-validated tenant — NEVER trust browser input for this. */
  tenantId: string;
  /** The authoritative platform_jobs row this work belongs to (queue job when
   *  invoked by the worker, manual job in the wrapper), or null when untracked.
   *  Most handlers return work to the caller; durable email handlers settle their
   *  own lease and explicitly return queueOutcome. */
  jobId: string | null;
  /** Type from the claimed durable row; never a browser-selected handler. */
  jobType?: string;
  /** Validated job payload / request body. */
  payload: Record<string, unknown>;
  /** Cooperative cancellation, where a handler chooses to honour it. */
  signal?: AbortSignal;
  /** Queue ownership fence. Required by durable Slack/email worker writes. */
  claim?: { claimedBy: string; attemptCount: number };
}

/** Structured error contract the worker uses to decide retry vs dead-letter. */
export interface WorkerHandlerError {
  code: string;
  message: string; // safe: never a secret or customer content
  retryable: boolean;
  /** Optional provider minimum delay, in addition to queue backoff. */
  retryAfterSeconds?: number;
  failedStep?: string;
}

/** A follow-on job a handler asks the worker to enqueue AFTER the current row
 *  reaches a terminal state. Used for self-continued draining of large backlogs:
 *  strictly serial (the idempotent active job_key means at most one is ever live),
 *  bounded (one batch per run), and self-stopping (the handler simply stops
 *  returning it once a run is not full / makes no progress). */
export interface WorkerHandlerContinuation {
  availableAt?: string;
  jobType: string;
  jobKey: string;
  payload?: Record<string, unknown>;
  connectorId?: string;
  moduleId?: string;
  priority?: number;
}

export interface WorkerHandlerResult {
  success: boolean;
  /** Durable email engine outcome. Never run generic completion/failure again;
   * unknown acknowledgement leaves the lease available for later recovery. */
  queueOutcome?: {
    state: "completed" | "failed" | "waiting" | "retrying" | "unconfirmed";
    jobId: string;
    historicalReceipt?: boolean;
  };
  recordsProcessed?: number;
  result?: Record<string, unknown>;
  /** Present when success === false. */
  error?: WorkerHandlerError;
  /** Present (on success) when the handler has more bounded work of the same kind
   *  queued behind it. The worker enqueues it only AFTER completing the current
   *  job, so the active-key is free and no duplicate active job is created. */
  continuation?: WorkerHandlerContinuation;
}

export type WorkerHandler = (ctx: WorkerHandlerContext) => Promise<WorkerHandlerResult>;
