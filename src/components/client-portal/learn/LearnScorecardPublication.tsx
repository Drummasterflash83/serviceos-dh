import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadRevisionPublication, publishScorecard } from "@/lib/learn-scorecard-publication";
import type { ScorecardPolicy } from "@/lib/learn-scorecards";
export function LearnScorecardPublication({
  policy,
  unchanged,
}: {
  policy: ScorecardPolicy;
  unchanged: boolean;
}) {
  const [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false);
  const pending = useRef<{ requestId: string; reason: string } | null>(null);
  useEffect(() => {
    let active = true;
    loadRevisionPublication(getSupabaseClient(), policy).then(
      (at) => {
        if (active) {
          setPublished(at);
          setReady(true);
        }
      },
      () => {
        if (active)
          setMessage("Publication history is unavailable. Reload saved rules before publishing.");
      },
    );
    return () => {
      active = false;
    };
  }, [policy]);
  if (published)
    return (
      <div className="lp-review">
        <h4>Saved revision {policy.version} is published</h4>
        <p>
          Effective from {new Date(published).toLocaleString("en-GB")}. Editing and saving creates a
          separate draft; earlier published rules remain available.
        </p>
      </div>
    );
  return (
    <form
      className="lp-review"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !ready || !unchanged || !checked || !reason.trim()) return;
        pending.current ??= { requestId: crypto.randomUUID(), reason: reason.trim() };
        setBusy(true);
        setMessage("");
        try {
          const r = await publishScorecard(getSupabaseClient(), { policy, ...pending.current });
          setPublished(r.effectiveFrom);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Publication failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h4>Publish saved revision {policy.version}</h4>
      <p>
        Publishing makes these exact rules available for advisory assessments from this moment
        onward. Earlier periods retain their earlier rules. This does not confirm evidence or change
        pay.
      </p>
      {!unchanged && <p>Save or discard your edits before publishing the saved revision.</p>}
      <label>
        Publication reason
        <textarea
          value={reason}
          maxLength={1000}
          required
          disabled={busy || !!pending.current}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <label className="lp-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy || !!pending.current}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I reviewed the saved criteria, weights, scale and evidence requirements.
      </label>
      <button
        className="cp-secondary"
        type="submit"
        disabled={busy || !ready || !unchanged || !checked || !reason.trim()}
      >
        {busy ? "Publishing…" : pending.current ? "Retry same publication" : "Publish saved rules"}
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
