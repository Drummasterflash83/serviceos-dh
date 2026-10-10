import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/styles/client-workspace.css";
import { OperatorCaptureControls } from "../../src/components/app/OperatorCaptureControls";
import type { OperatorInputClient } from "../../src/lib/learn-operator-inputs";
import type { CaptureControls, CaptureValues } from "../../src/lib/learn-operator-capture-controls";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scenario = new URLSearchParams(location.search).get("scenario") ?? "normal";
const key = "synthetic-capture-preview:" + scenario;
const initial = {
  "learn.enabled": true,
  "learn.inputs.email.enabled": true,
  "learn.inputs.phone.enabled": true,
  "learn.inputs.slack.enabled": false,
};
let writeAllowed = scenario !== "viewer";
function current(): CaptureControls {
  const data = JSON.parse(
    localStorage.getItem(key) ?? JSON.stringify({ values: initial, revision: "a".repeat(32) }),
  );
  const flags = data.values as CaptureValues;
  return {
    version: "learn-capture-controls/1",
    tenant_id: id(1),
    revision: data.revision,
    flags,
    sources: {
      email: {
        allowed: flags["learn.enabled"] && flags["learn.inputs.email.enabled"],
        inherited: false,
        invalid: false,
      },
      phone: {
        allowed: flags["learn.enabled"] && flags["learn.inputs.phone.enabled"],
        inherited: false,
        invalid: false,
      },
      slack: {
        allowed: flags["learn.enabled"] && flags["learn.inputs.slack.enabled"],
        inherited: false,
        invalid: false,
      },
    },
  };
}
const client: OperatorInputClient = {
  rpc: async (name, args) => {
    if (scenario === "unavailable")
      return { data: null, error: { message: "synthetic_unavailable" } };
    if (name === "current_user_is_openfolk_operator") return { data: writeAllowed, error: null };
    if (name === "learn_operator_capture_controls") return { data: current(), error: null };
    if (name !== "learn_operator_capture_control_request") throw Error("Unexpected synthetic RPC");
    if (!writeAllowed) return { data: null, error: { message: "synthetic_forbidden" } };
    const receipts = JSON.parse(localStorage.getItem(key + ":receipts") ?? "{}");
    const requestId = String(args.p_request),
      definition = args.p_definition as { revision: string; values: CaptureValues };
    if (receipts[requestId]) return { data: receipts[requestId], error: null };
    const receipt = { tenant_id: id(1), request_id: requestId, state: "pending" } as any;
    if (args.p_mode === "check") return { data: receipt, error: null };
    if (args.p_mode === "cancel") receipt.state = "cancelled";
    else {
      if (scenario === "stale" || definition.revision !== current().revision)
        return { data: null, error: { message: "learn_capture_flags_changed" } };
      localStorage.setItem(
        key,
        JSON.stringify({ values: definition.values, revision: "b".repeat(32) }),
      );
      receipt.state = "recorded";
      receipt.controls = current();
    }
    receipts[requestId] = receipt;
    localStorage.setItem(key + ":receipts", JSON.stringify(receipts));
    if (scenario === "lost" && args.p_mode === "apply") throw Error("Synthetic lost response");
    return { data: receipt, error: null };
  },
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main
      className="cp-root op-embedded"
      style={{ display: "block", maxWidth: 1000, margin: "24px auto", padding: 24 }}
    >
      <p style={{ padding: "16px 0" }}>
        Synthetic preview · no hosted changes · real component, in-browser fixtures
      </p>
      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <button
          onClick={() => {
            localStorage.clear();
            location.reload();
          }}
        >
          Reset synthetic fixture
        </button>
        <button
          onClick={() => {
            writeAllowed = false;
          }}
        >
          Revoke synthetic administrator access
        </button>
      </div>
      <OperatorCaptureControls
        tenantId={id(1)}
        actorId={id(2)}
        backend="https://synthetic-capture.invalid"
        client={client}
      />
    </main>
  </React.StrictMode>,
);
