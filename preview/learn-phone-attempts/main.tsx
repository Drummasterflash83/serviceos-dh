import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/styles/client-workspace.css";
import { OperatorPhoneAttempts } from "../../src/components/app/OperatorPhoneAttempts";
import type { PhoneAttempt } from "../../src/lib/learn-phone-attempt-review";
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const scenario = new URLSearchParams(location.search).get("scenario") ?? "normal";
const storageKey = "synthetic-phone-review:" + scenario;
const timestamp = new Date().toISOString();
const rows: PhoneAttempt[] = [
  {
    run_id: id(10),
    recording_id: id(20),
    stage: "transcription",
    state: "prepared",
    started_at: timestamp,
    completed_at: null,
    review_after: timestamp,
    has_prepared_result: true,
    has_receipt: false,
    error_code: null,
    retained_previous_result: false,
    retained_previous_attribution: false,
    can_reconcile: true,
  },
  {
    run_id: id(11),
    recording_id: id(21),
    stage: "analysis",
    state: "needs_review",
    started_at: timestamp,
    completed_at: null,
    review_after: timestamp,
    has_prepared_result: false,
    has_receipt: false,
    error_code: "processing_unconfirmed",
    retained_previous_result: false,
    retained_previous_attribution: false,
    can_reconcile: false,
  },
  {
    run_id: id(12),
    recording_id: id(22),
    stage: "download",
    state: "prepared",
    started_at: timestamp,
    completed_at: null,
    review_after: timestamp,
    has_prepared_result: true,
    has_receipt: false,
    error_code: null,
    retained_previous_result: false,
    retained_previous_attribution: false,
    can_reconcile: false,
  },
];
const client = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "current_user_is_openfolk_operator")
      return { data: scenario !== "viewer", error: null };
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (name === "learn_operator_phone_attempts") {
      const result = rows
        .map((r) =>
          r.run_id === saved.run_id
            ? {
                ...r,
                state: "succeeded",
                has_receipt: true,
                retained_previous_result: true,
                can_reconcile: false,
              }
            : r,
        )
        .filter((r) => !args.p_held_only || r.state !== "succeeded");
      return {
        data: {
          version: "learn-operator-phone-attempts/1",
          tenant_id: args.p_tenant,
          recording_id: null,
          held_only: args.p_held_only,
          checked_at: timestamp,
          capture_allowed: true,
          rows: result,
          next_cursor: null,
        },
        error: null,
      };
    }
    if (name === "learn_operator_phone_reconcile") {
      if (saved.request_id === args.p_request) return { data: saved, error: null };
      const receipt = {
        version: "learn-operator-phone-reconciliation/1",
        tenant_id: args.p_tenant,
        request_id: args.p_request,
        run_id: args.p_run,
        state:
          args.p_mode === "check" ? "pending" : args.p_mode === "cancel" ? "cancelled" : "recorded",
        ...(args.p_mode === "apply"
          ? { stage: "transcription", recording_id: id(20), already_completed: false }
          : {}),
      };
      if (args.p_mode !== "check") localStorage.setItem(storageKey, JSON.stringify(receipt));
      if (scenario === "lost-reply" && args.p_mode === "apply") throw Error("Synthetic lost reply");
      return { data: receipt, error: null };
    }
    return { data: null, error: { message: "Unsupported synthetic request" } };
  },
};
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-5xl p-6 space-y-4">
    <h1 className="text-2xl font-semibold">OpenFolk · Phone recovery preview</h1>
    <p>
      Synthetic local interface check. No real accounts, provider requests or hosted writes.
      Scenario: {scenario}.
    </p>
    <button
      className="cp-secondary"
      onClick={() => {
        localStorage.removeItem(storageKey);
        location.reload();
      }}
    >
      Reset synthetic scenario
    </button>
    <OperatorPhoneAttempts
      tenantId={id(1)}
      actorId={id(2)}
      backend="https://synthetic-phone.invalid"
      client={client}
    />
  </main>,
);
