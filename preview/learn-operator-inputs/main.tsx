import React from "react";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import { OperatorLearnInputs } from "../../src/components/app/OperatorLearnInputs";
import type { OperatorInputClient, InputOverview } from "../../src/lib/learn-operator-inputs";
import "../../src/styles/client-workspace.css";
import "../../src/styles/learn-launch.css";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  actor = id(2),
  scenario = new URLSearchParams(location.search).get("scenario");
const state: InputOverview = {
  tenant_id: tenant,
  checked_at: new Date().toISOString(),
  flags: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
  connections: [
    {
      id: id(5),
      status: "configured",
      revision: "2026-10-10T09:00:00Z",
      verified_at: "2026-10-10T09:00:00Z",
      revoked: false,
      account_key: "Drummonds · synthetic account",
      region: "uk",
      credential_bound: true,
    },
  ],
  accounts: [
    {
      id: id(6),
      status: "active",
      connector_enabled: true,
      connection_id: id(5),
      resource: "properties",
      approval_id: id(7),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      max_pages: 10,
      checkpoint: { approvalId: id(7), pages: 3, after: 150, complete: false },
      latest_job: {
        id: id(8),
        status: "dead_letter",
        error_code: "commusoft_authority_unavailable",
        attempt_count: 2,
        available_at: null,
        lease_expires_at: null,
        completed_at: null,
        stop_reason: null,
      },
    },
  ],
};
const key = "synthetic-operator-receipts:1",
  stateKey = "synthetic-operator-state:1";
let refreshFailed = false;
const client: OperatorInputClient = {
  rpc: async (name, args) => {
    if (scenario === "unavailable") return { data: null, error: { code: "42883" } };
    if (name === "learn_operator_inputs") {
      if (refreshFailed) return { data: null, error: { code: "synthetic_refresh_failure" } };
      const stored = localStorage.getItem(stateKey);
      return {
        data: stored ? { ...JSON.parse(stored), checked_at: new Date().toISOString() } : state,
        error: null,
      };
    }
    const receipts = JSON.parse(localStorage.getItem(key) ?? "{}");
    const requestId = String(args.p_request),
      definition = args.p_definition as any;
    if (receipts[requestId]) return { data: receipts[requestId], error: null };
    if (args.p_mode === "check")
      return { data: { tenant_id: tenant, request_id: requestId, state: "pending" }, error: null };
    const receipt =
      args.p_mode === "cancel"
        ? { tenant_id: tenant, request_id: requestId, state: "cancelled" }
        : {
            tenant_id: tenant,
            request_id: requestId,
            state: "recorded",
            kind: definition.kind,
            ...(definition.kind === "set_modules"
              ? { flags: definition.values }
              : { account_id: id(6), job_id: id(9) }),
          };
    receipts[requestId] = receipt;
    localStorage.setItem(key, JSON.stringify(receipts));
    if (args.p_mode === "apply") {
      if (scenario === "refresh_failure") refreshFailed = true;
      const updated = JSON.parse(localStorage.getItem(stateKey) ?? JSON.stringify(state));
      if (definition.kind === "set_modules") updated.flags = definition.values;
      else
        updated.accounts[0].latest_job = {
          ...updated.accounts[0].latest_job,
          id: id(9),
          status: "queued",
          error_code: null,
          attempt_count: 0,
        };
      localStorage.setItem(stateKey, JSON.stringify(updated));
      if (scenario === "uncertain")
        throw Error("Synthetic lost reply. The saved request remains available.");
    }
    return { data: receipt, error: null };
  },
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main
      className="cp-root op-embedded"
      style={{ maxWidth: 1050, margin: "2rem auto", padding: "1rem" }}
    >
      <p style={{ padding: "1rem" }} role="status">
        Synthetic OpenFolk preview · network disabled · no hosted changes
      </p>
      <OperatorLearnInputs
        tenantId={tenant}
        actorId={actor}
        client={client}
        backend="https://synthetic-operator.invalid"
      />
    </main>
  </React.StrictMode>,
);
