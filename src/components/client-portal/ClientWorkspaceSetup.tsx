import { useState, type FormEvent } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { programmeSchema } from "@/lib/client-portal";

/** Creates only the shared programme. Existing RLS, preview-write restrictions,
 * revision history and configured notifications still apply on the server.
 */
export function ClientWorkspaceSetup({
  tenantId,
  company,
  onCreated,
}: {
  tenantId: string;
  company: string;
  onCreated: () => Promise<unknown>;
}) {
  const [name, setName] = useState(company);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  async function refresh() {
    setChecking(true);
    try {
      await onCreated();
    } finally {
      setChecking(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const db = getSupabaseClient();
      const existing = await db
        .from("client_programmes")
        .select("tenant_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (existing.error) throw new Error("The workspace could not be checked. Please try again.");
      if (!existing.data) {
        const content = programmeSchema.parse({
          company: name.trim(),
          title: "Your workspace",
          objective: "",
          nextStep: "",
          commercialNote: "",
          outcomes: [],
          systems: [],
          links: [],
        });
        // Insert, never upsert: another operator's concurrent setup must survive.
        const result = await db.from("client_programmes").insert({ tenant_id: tenantId, content });
        if (result.error)
          throw new Error("Setup was not confirmed. Check the workspace before trying again.");
      }
      await onCreated();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Setup was not confirmed. Check the workspace before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cp-card">
      <h2>Prepare this client’s workspace</h2>
      <p>
        Create the shared workspace, then add agreed outcomes and details. Existing authorised
        members can see it.
      </p>
      <p>
        Account access and input capture stay under their separate controls. Configured workspace
        notifications may be sent.
      </p>
      <form className="cp-edit-form" onSubmit={create}>
        <label className="cp-field">
          <span>Company name</span>
          <input
            required
            maxLength={10000}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button className="cp-primary" disabled={busy || checking || !name.trim()}>
            {busy ? "Preparing workspace…" : "Prepare workspace"}
          </button>
          {error && (
            <button
              type="button"
              className="cp-secondary"
              disabled={busy || checking}
              onClick={() => void refresh()}
            >
              {checking ? "Checking…" : "Check workspace"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
