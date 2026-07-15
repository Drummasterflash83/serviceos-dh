// Remote Verification Harness — impure client.
//
// The ONLY module that touches the network. It lazily imports the already-present
// @supabase/supabase-js (so dry-run and unit tests load no dependency and make no
// calls) and exposes a narrow set of allowlisted operations: table reads, controlled
// fixture writes, "expect this mutation to be rejected" behavioural probes, cleanup
// deletes, and invoking the deployed platform-worker via WORKER_SECRET. There is NO
// arbitrary-SQL surface — see docs/REMOTE_VERIFICATION_HARNESS.md.

import type { SupabaseClient } from "@supabase/supabase-js"; // type-only — erased at runtime
import type { VerifyEnv } from "./lib.ts";

export interface RejectionProbe {
  rejected: boolean;
  code: string | null;
  message: string | null;
}

export interface VerifyClient {
  db: SupabaseClient;
  env: VerifyEnv;
  /** Invoke the deployed platform-worker to process queued jobs now (bounded). */
  invokeWorker(jobTypes?: string[]): Promise<{ ok: boolean; status: number }>;
  /** Run a mutation expected to be REJECTED by a DB guard (append-only / immutable /
   *  illegal transition). Returns whether it was rejected + the pg error code. */
  expectRejected(op: () => PromiseLike<{ error: unknown }>): Promise<RejectionProbe>;
  /** Acquire the tenant+suite mutating-run lease (atomic; reclaims expired leases). */
  acquireLock(
    suite: string,
    runId: string,
    ttlSeconds: number,
  ): Promise<{ acquired: boolean; holder: string | null; expiresAt: string | null }>;
  /** Release the lease — owner-only (a wrong run id releases nothing). */
  releaseLock(suite: string, runId: string): Promise<boolean>;
}

export async function makeClient(env: VerifyEnv): Promise<VerifyClient> {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as SupabaseClient;

  return {
    db,
    env,
    async invokeWorker(jobTypes) {
      if (!env.workerSecret) {
        throw new Error("WORKER_SECRET is required to invoke the platform-worker");
      }
      const res = await fetch(`${env.supabaseUrl}/functions/v1/platform-worker`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-schedule-secret": env.workerSecret,
        },
        body: JSON.stringify({ batch_size: 5, ...(jobTypes ? { job_types: jobTypes } : {}) }),
      });
      return { ok: res.ok, status: res.status };
    },
    async expectRejected(op) {
      const { error } = await op();
      const e = (error ?? null) as { code?: unknown; message?: unknown } | null;
      return {
        rejected: !!error,
        code: e && e.code != null ? String(e.code) : null,
        message: e && e.message != null ? String(e.message) : null,
      };
    },
    async acquireLock(suite, runId, ttlSeconds) {
      const { data, error } = await db.rpc("verification_acquire_lock", {
        p_tenant_id: env.tenantId,
        p_suite: suite,
        p_verification_run_id: runId,
        p_ttl_seconds: ttlSeconds,
      });
      if (error) throw new Error(`lock acquire RPC failed: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as
        { acquired?: boolean; holder?: string; lock_expires_at?: string } | undefined;
      return {
        acquired: !!row?.acquired,
        holder: row?.holder ?? null,
        expiresAt: row?.lock_expires_at ?? null,
      };
    },
    async releaseLock(suite, runId) {
      const { data, error } = await db.rpc("verification_release_lock", {
        p_tenant_id: env.tenantId,
        p_suite: suite,
        p_verification_run_id: runId,
      });
      return !error && data === true;
    },
  };
}
