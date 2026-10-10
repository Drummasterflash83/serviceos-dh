import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/styles/client-workspace.css";
import { OperatorCaptureHealth } from "../../src/components/app/OperatorCaptureHealth";
import type { CaptureHealthRow } from "../../src/lib/learn-operator-capture-health";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
let fail = false;
const rows: CaptureHealthRow[] = Array.from({ length: 50 }, (_, i) => ({
  key: `email:${id(i + 1)}`,
  id: id(i + 1),
  source: "email",
  provider: i === 0 ? "google_workspace" : "gmail",
  label:
    i === 0
      ? "Office · synthetic Workspace"
      : i === 1
        ? "Service desk · synthetic stale mailbox"
        : i === 2
          ? "Bookings · synthetic reconnect"
          : `Synthetic mailbox ${i + 1}`,
  enabled: null,
  account_state: "active",
  auth_state: i === 2 ? "needs_reconnect" : "unknown",
  last_success_at: stamp(i === 1 ? 90 : 1),
  last_attempt_at: stamp(1),
  last_failure_at: null,
  latest_job: null,
  bounded_complete: null,
}));
const extra: CaptureHealthRow[] = [
  {
    ...rows[0],
    id: id(51),
    key: `phone:${id(51)}`,
    source: "phone",
    provider: "simwood",
    label: "Phone · synthetic account",
    enabled: true,
  },
  {
    ...rows[0],
    id: id(52),
    key: `slack:${id(52)}`,
    source: "slack",
    provider: "slack",
    label: "Operations · synthetic channel",
    enabled: true,
    last_success_at: null,
    bounded_complete: true,
    latest_job: {
      id: id(90),
      status: "succeeded",
      available_at: stamp(10),
      lease_expires_at: null,
      completed_at: stamp(2),
    },
  },
];
const client = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== "learn_operator_capture_health") throw Error("Unexpected synthetic call");
    if (fail) return { data: null, error: { code: "denied" } };
    return {
      data: {
        version: "learn-operator-capture-health/1",
        tenant_id: args.p_tenant,
        checked_at: stamp(0),
        rows: args.p_after ? extra : rows,
        next_cursor: args.p_after ? null : rows.at(-1)!.key,
      },
      error: null,
    };
  },
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main style={{ maxWidth: 1200, margin: "2rem auto", padding: "1rem" }}>
      <p>Synthetic OpenFolk capture preview · network disabled · no hosted changes</p>
      <button
        onClick={() => {
          fail = true;
        }}
      >
        Simulate unavailable service
      </button>
      <OperatorCaptureHealth tenantId={id(100)} actorId={id(182)} client={client} />
    </main>
  </React.StrictMode>,
);
