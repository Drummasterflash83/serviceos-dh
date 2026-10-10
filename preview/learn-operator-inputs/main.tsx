import React from "react";
import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import { OperatorLearnInputs } from "../../src/components/app/OperatorLearnInputs";
import type { InputOverview } from "../../src/lib/learn-operator-inputs";
import type { ConnectionControlClient } from "../../src/lib/learn-commusoft-connection-outbox";
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
let writeAllowed = scenario !== "viewer";
if (scenario?.startsWith("connection_") || scenario?.startsWith("verification_")) {
  state.accounts = [];
  state.connections[0].verified_at = null;
  if (scenario === "connection_empty") state.connections = [];
}
const client: ConnectionControlClient = {
  rpc: async (name, args) => {
    if (scenario === "unavailable") return { data: null, error: { code: "42883" } };
    if (name === "current_user_is_openfolk_operator") {
      if (scenario === "permission_unavailable")
        return { data: null, error: { code: "synthetic_unavailable" } };
      return {
        data: writeAllowed,
        error: null,
      };
    }
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
    if (name === "learn_commusoft_configure" || name === "learn_commusoft_verify_request") {
      if (!writeAllowed) return { data: null, error: { code: "synthetic_forbidden" } };
      const previous = receipts[requestId];
      if (
        previous &&
        (args.p_mode !== "cancel" || ["recorded", "cancelled"].includes(previous.state))
      )
        return { data: previous, error: null };
      if (args.p_mode === "check")
        return {
          data: previous ?? { tenant_id: tenant, request_id: requestId, state: "pending" },
          error: null,
        };
      if (
        scenario === "connection_missing" &&
        name === "learn_commusoft_configure" &&
        args.p_mode === "apply" &&
        definition.credential_mode === "reuse"
      )
        return {
          data: null,
          error: { code: "55000", message: "learn_connection_credential_missing" },
        };
      if (args.p_mode === "cancel") {
        receipts[requestId] = { tenant_id: tenant, request_id: requestId, state: "cancelled" };
      } else if (name === "learn_commusoft_configure") {
        const revision = new Date().toISOString();
        receipts[requestId] = {
          tenant_id: tenant,
          request_id: requestId,
          state: "recorded",
          connection_id: id(5),
          revision,
          credential_bound: true,
          verification: "required",
        };
        const updated = JSON.parse(localStorage.getItem(stateKey) ?? JSON.stringify(state));
        updated.connections = [
          {
            id: id(5),
            revision,
            verified_at: null,
            revoked: false,
            status: "configured",
            credential_bound: true,
            account_key: definition.account_key,
            region: definition.region,
          },
        ];
        localStorage.setItem(stateKey, JSON.stringify(updated));
      } else throw Error("Synthetic verification apply must use the execution endpoint.");
      localStorage.setItem(key, JSON.stringify(receipts));
      if (scenario === "connection_uncertain" && args.p_mode === "apply")
        throw Error("Synthetic lost setup reply");
      return { data: receipts[requestId], error: null };
    }
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
              : {
                  account_id: id(6),
                  job_id: id(9),
                  ...(definition.kind === "resume_commusoft"
                    ? { approval_id: definition.approval_id, checkpoint: definition.checkpoint }
                    : {}),
                }),
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
      if (definition.kind === "resume_commusoft") {
        updated.accounts[0].max_pages = definition.max_pages;
        updated.accounts[0].expires_at = definition.expires_at;
      }
      localStorage.setItem(stateKey, JSON.stringify(updated));
      if (scenario === "uncertain")
        throw Error("Synthetic lost reply. The saved request remains available.");
    }
    return { data: receipt, error: null };
  },
  functions: {
    invoke: async (_name, options) => {
      if (!writeAllowed) return { data: null, error: { code: "synthetic_forbidden" } };
      const request = options.body.request as any;
      const receipts = JSON.parse(localStorage.getItem(key) ?? "{}");
      const requestId = request.requestId,
        revision = new Date().toISOString();
      const waiting = scenario === "verification_waiting",
        running = scenario === "verification_running";
      const code =
        scenario === "verification_failed" ? "authentication_required" : "access_verified";
      const receipt =
        waiting || running
          ? {
              tenant_id: tenant,
              request_id: requestId,
              state: waiting ? "approved" : "running",
              expires_at: new Date(Date.now() + 120000).toISOString(),
            }
          : {
              tenant_id: tenant,
              request_id: requestId,
              state: "recorded",
              connection_id: id(5),
              code,
              revision,
              verified_at: code === "access_verified" ? revision : null,
            };
      receipts[requestId] = receipt;
      localStorage.setItem(key, JSON.stringify(receipts));
      if (!waiting && !running) {
        const updated = JSON.parse(localStorage.getItem(stateKey) ?? JSON.stringify(state));
        updated.connections[0] = {
          ...updated.connections[0],
          revision,
          verified_at: receipt.verified_at,
        };
        localStorage.setItem(stateKey, JSON.stringify(updated));
      }
      if (scenario === "verification_uncertain") throw Error("Synthetic lost verification reply");
      return {
        data: { receipt, ...(waiting ? { retry_at: Date.now() + 60000 } : {}) },
        error: null,
      };
    },
  },
};
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main
      className="cp-root op-embedded"
      style={{ display: "block", maxWidth: 1050, margin: "2rem auto", padding: "1rem" }}
    >
      <p style={{ padding: "1rem" }} role="status">
        Synthetic OpenFolk preview · network disabled · no hosted changes
      </p>
      <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
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
        <button
          onClick={() => {
            writeAllowed = true;
          }}
        >
          Restore synthetic administrator access
        </button>
      </div>
      <OperatorLearnInputs
        tenantId={tenant}
        actorId={actor}
        client={client}
        backend="https://synthetic-operator.invalid"
      />
    </main>
  </React.StrictMode>,
);
