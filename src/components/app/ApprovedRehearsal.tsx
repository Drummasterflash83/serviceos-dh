import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { DeskIssue } from "@/lib/feedback-desk";
type Receipt = {
  id: string;
  state: string;
  created_at: string;
  issue_version: number;
  caller: string;
  opening: string;
  proposal: string;
  safe_error: string | null;
  result: { baseline: { reply: string }; candidate: { reply: string }; limits: string } | null;
};
export function ApprovedRehearsal({ issue }: { issue: DeskIssue }) {
  const db = getSupabaseClient(),
    qc = useQueryClient(),
    { user } = useAuth();
  const [caller, setCaller] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const receipts = useQuery({
    queryKey: ["approved-rehearsals", user?.id, issue.tenant_id, issue.id],
    queryFn: async () => {
      const r = await db
        .from("receptionist_rehearsals")
        .select("id,state,created_at,issue_version,caller,opening,proposal,safe_error,result")
        .eq("tenant_id", issue.tenant_id)
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (r.error) throw Error("Rehearsal history could not be loaded.");
      return r.data as Receipt[];
    },
    refetchInterval: busy ? 3000 : 30000,
  });
  async function run() {
    setBusy(true);
    setError("");
    try {
      const r = await db.functions.invoke("receptionist-rehearsal", {
        body: { tenantId: issue.tenant_id, issueId: issue.id, version: issue.version, caller },
      });
      let message = r.data?.error;
      if (r.error?.context instanceof Response)
        message =
          (
            await r.error.context
              .clone()
              .json()
              .catch(() => null)
          )?.error ?? message;
      if (r.error || message)
        throw Error(message || "The rehearsal could not complete. Emma is unchanged.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["approved-rehearsals"] });
      await qc.invalidateQueries({ queryKey: ["feedback-desk"] });
    }
  }
  return (
    <section className="fd-block fd-form">
      <h3>4. Test the approved wording</h3>
      <p>
        Compare Emma’s current reply with the approved change in an isolated Vapi text rehearsal.
        Both start after her configured welcome. No phone calls, transfers or live changes.
      </p>
      {issue.stage === "approved" ? (
        <>
          <label>
            What does the caller say next?
            <textarea
              value={caller}
              onChange={(e) => setCaller(e.target.value)}
              maxLength={2000}
              disabled={busy}
              placeholder="For example: I’d like to leave a message for Heidi, please."
            />
          </label>
          <button
            className="fd-primary"
            disabled={busy || !caller.trim()}
            onClick={() => void run()}
          >
            {busy ? "Comparing replies…" : "Run approved rehearsal"}
          </button>
        </>
      ) : (
        <p>Save and approve a proposal before testing it.</p>
      )}
      {error && (
        <p className="fd-error" role="alert">
          {error}
        </p>
      )}
      {receipts.isError && <p role="alert">{receipts.error.message}</p>}
      {receipts.data?.map((r) => (
        <details key={r.id} className="fd-finding" open={r.id === receipts.data?.[0]?.id}>
          <summary>
            {new Date(r.created_at).toLocaleString("en-GB")} ·{" "}
            {r.state === "completed" ? "Ready for your review" : r.state} · proposal version{" "}
            {r.issue_version}
          </summary>
          {r.safe_error && <p role="alert">{r.safe_error}</p>}
          <p>
            <b>Welcome used:</b> {r.opening || "No configured welcome"}
          </p>
          <p>
            <b>Caller:</b> {r.caller}
          </p>
          {r.result && (
            <>
              <article>
                <h4>Current wording</h4>
                <p className="fd-preserve">{r.result.baseline.reply}</p>
              </article>
              <article>
                <h4>With the approved change</h4>
                <p className="fd-preserve">{r.result.candidate.reply}</p>
              </article>
              <p>{r.result.limits}</p>
            </>
          )}
          <details>
            <summary>Exact proposal tested</summary>
            <p className="fd-preserve">{r.proposal}</p>
          </details>
        </details>
      ))}
      <p>
        OpenFolk reviews every result during this initial supervised period. Completion means
        evidence is saved—not that a fix has passed or been released. Progress goes to the
        configured Slack channel.
      </p>
    </section>
  );
}
