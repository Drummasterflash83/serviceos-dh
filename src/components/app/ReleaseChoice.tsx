import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { DeskIssue } from "@/lib/feedback-desk";
import { ApprovedRehearsal } from "./ApprovedRehearsal";
type Release = {
  id: string;
  state: string;
  operation: string;
  instruction: string;
  safe_error: string | null;
  created_at: string;
};
export function ReleaseChoice({ issue, unsaved }: { issue: DeskIssue; unsaved: boolean }) {
  const db = getSupabaseClient(),
    qc = useQueryClient(),
    { user } = useAuth();
  const [mode, setMode] = useState<"test" | "publish" | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<{ id: string; instruction: string } | null>(null),
    [confirm, setConfirm] = useState(false),
    [rollback, setRollback] = useState<string | null>(null);
  const releases = useQuery({
    queryKey: ["emma-releases", user?.id, issue.id],
    queryFn: async () => {
      const r = await db
        .from("receptionist_releases")
        .select("id,state,operation,instruction,safe_error,created_at")
        .eq("tenant_id", issue.tenant_id)
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (r.error) throw Error("Release history unavailable.");
      return r.data as Release[];
    },
    refetchInterval: 30000,
  });
  async function invoke(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      const r = await db.functions.invoke("receptionist-release", {
        body: {
          tenantId: issue.tenant_id,
          issueId: issue.id,
          version: issue.version,
          action,
          ...extra,
        },
      });
      let msg = r.data?.error;
      if (r.error?.context instanceof Response)
        msg =
          (
            await r.error.context
              .clone()
              .json()
              .catch(() => null)
          )?.error ?? msg;
      if (r.error || msg)
        throw Error(msg || "The result needs checking. Reload this task before trying again.");
      if (action === "prepare") {
        setPreview(r.data);
        setConfirm(false);
      } else {
        setPreview(null);
        setRollback(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["emma-releases"] });
      await qc.invalidateQueries({ queryKey: ["feedback-desk"] });
      await qc.invalidateQueries({ queryKey: ["client-care-progress"] });
    }
  }
  async function test() {
    setError("");
    setBusy(true);
    try {
      if (issue.stage === "approval") {
        const r = await db.rpc("care_issue_action", {
          p_tenant: issue.tenant_id,
          p_issue: issue.id,
          p_version: issue.version,
          p_action: "approve",
          p_content: {},
        });
        if (r.error) throw Error("The proposal changed. Reload it before approving.");
        await qc.invalidateQueries({ queryKey: ["feedback-desk"] });
      } else setMode("test");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const eligible = ["approval", "approved"].includes(issue.stage);
  const blocked = releases.data?.some((r) =>
    ["publishing", "rolling_back", "uncertain"].includes(r.state),
  );
  return (
    <section className="fd-block fd-release">
      <h3>3. Choose the next step</h3>
      <p>
        You decide: rehearse first, or publish the saved instructions directly. A published update
        stays open until its results are checked.
      </p>
      {unsaved && (
        <p className="fd-error">Save your edited proposal before testing or publishing.</p>
      )}
      {error && (
        <p className="fd-error" role="alert">
          {error}
        </p>
      )}
      {eligible && (
        <div className="fd-choice-grid">
          <button
            className="fd-secondary"
            disabled={busy || unsaved || blocked}
            onClick={() => void test()}
          >
            <strong>
              {issue.stage === "approval" ? "Approve for testing" : "Test the change"}
            </strong>
            <span>Try it without changing live Emma.</span>
          </button>
          <button
            className="fd-primary"
            disabled={busy || unsaved || blocked}
            onClick={() => {
              setMode("publish");
              void invoke("prepare");
            }}
          >
            <strong>Publish to Vapi</strong>
            <span>Review the exact addition, then confirm.</span>
          </button>
        </div>
      )}
      {mode === "publish" && preview && (
        <div className="fd-approval">
          <h4>These exact instructions will be added</h4>
          <p className="fd-preserve">{preview.instruction}</p>
          <p>
            This updates Emma’s response instructions for new calls. Voice, greeting, tools, phone
            numbers and hours configuration are not edited. The previous configuration is saved
            privately for rollback. Please do not edit Emma in the Vapi dashboard while publishing
            here.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            I approve this exact live change. I am choosing to publish without requiring a
            rehearsal.
          </label>
          <button
            className="fd-primary"
            disabled={!confirm || busy || unsaved}
            onClick={() =>
              void invoke("publish", { releaseId: preview.id, confirm: "PUBLISH_TO_VAPI" })
            }
          >
            {busy ? "Checking Vapi…" : "Confirm and publish to Vapi"}
          </button>
        </div>
      )}
      {issue.stage === "approved" && (
        <details
          open={mode === "test"}
          onToggle={(e) => {
            if (e.currentTarget.open) setMode("test");
            else if (mode === "test") setMode(null);
          }}
        >
          <summary>Test results and voice rehearsal</summary>
          <ApprovedRehearsal issue={issue} />
        </details>
      )}
      {releases.isError && <p role="alert">{releases.error.message}</p>}
      {releases.data
        ?.filter((r) => r.state !== "prepared")
        .map((r) => (
          <article className="fd-finding" key={r.id}>
            <strong>
              {
                (
                  {
                    applied: "Published · results need checking",
                    rolled_back: "Previous version restored",
                    publishing: "Publishing · do not resend",
                    rolling_back: "Restoring · do not resend",
                    uncertain: "Outcome needs checking",
                    conflict: "Newer configuration found",
                  } as Record<string, string>
                )[r.state]
              }
            </strong>
            <p>{new Date(r.created_at).toLocaleString("en-GB")}</p>
            {r.safe_error && <p>{r.safe_error}</p>}
            <details>
              <summary>Instructions in this release</summary>
              <p className="fd-preserve">{r.instruction}</p>
            </details>
            {["publishing", "rolling_back", "uncertain"].includes(r.state) && (
              <button
                className="fd-secondary"
                disabled={busy}
                onClick={() => void invoke("reconcile", { releaseId: r.id })}
              >
                Check Vapi result
              </button>
            )}
            {r.state === "applied" && (
              <>
                <button
                  className="fd-secondary"
                  disabled={busy}
                  onClick={() => setRollback(rollback === r.id ? null : r.id)}
                >
                  Restore previous version…
                </button>
                {rollback === r.id && (
                  <div className="fd-approval">
                    <p>
                      This restores the instructions from immediately before this release, only if
                      no other configuration has changed.
                    </p>
                    <button
                      className="fd-primary"
                      disabled={busy}
                      onClick={() =>
                        void invoke("rollback", {
                          releaseId: r.id,
                          confirm: "RESTORE_PREVIOUS_VERSION",
                        })
                      }
                    >
                      Confirm restore
                    </button>
                  </div>
                )}
              </>
            )}
          </article>
        ))}
    </section>
  );
}
