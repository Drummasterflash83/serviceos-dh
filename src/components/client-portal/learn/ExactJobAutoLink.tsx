import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { applyExactJobLink, reverseExactJobLink, type ExactJobLinkReceipt } from "@/lib/new-dawn-exact-job-action";
import { exactLinkReviewLabel } from "@/lib/new-dawn-m2-link-review";

export function ExactJobAutoLink({ tenant, connection, external, version, canApply, onInspect }: {
  tenant: string; connection: string; external: string; version: string;
  canApply: boolean;
  onInspect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<Extract<ExactJobLinkReceipt, { state: "linked" | "already_linked" }> | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseConfirmed, setReverseConfirmed] = useState(false);
  const [reversed, setReversed] = useState(false);
  async function apply() {
    if (!canApply || !confirmed || busy || document.hidden) return;
    setBusy(true); setNotice("");
    try {
      const result = await applyExactJobLink(getSupabaseClient(), { tenant, connection, external, version, reason });
      if (result.state === "review") {
        setNotice(exactLinkReviewLabel({ externalId: external, state: "review", reason: result.reason, sourceVersionId: null }));
        setConfirmed(false);
      } else {
        setReceipt(result); setOpen(false);
        setNotice("The exact-ID job link is recorded. The saved source, rule and audit remain available for reversal.");
      }
    } catch {
      setNotice("Result uncertain or source changed. Refresh the exact-link queue and audit before retrying this version.");
    } finally { setBusy(false); }
  }
  async function reverse() {
    if (!receipt || !reverseConfirmed || busy || document.hidden) return;
    setBusy(true); setNotice("");
    try {
      const result = await reverseExactJobLink(getSupabaseClient(), { tenant, link: receipt.linkId, reason: reverseReason });
      if (result.state === "review") setNotice(`Reversal held: ${result.reason.replaceAll("_", " ")}.`);
      else { setReversed(true); setNotice("The job source link is reversed; its source and audit records remain retained. Refresh the queue to see its current state."); }
    } catch {
      setNotice("Reversal result uncertain. Check the saved link and audit before retrying.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 text-sm">
    {onInspect && <button type="button" className="cp-secondary" onClick={onInspect}>Inspect retained job source</button>}
    {!canApply && <p>Exact-link application is held until the full dry-run counts and conflicts are reviewed.</p>}
    {canApply && !receipt && !open && <button type="button" className="cp-secondary" onClick={() => setOpen(true)}>Apply exact-ID job link</button>}
    {!receipt && open && <form className="space-y-2 rounded border p-3" onSubmit={e => { e.preventDefault(); void apply(); }}>
      <p>Only job {external} at saved source version {version} will be considered. The server rechecks that its Commusoft customer ID and work-site ID each have one current, non-conflicting ServiceOS mapping. Anything else stays held.</p>
      <label className="block">Reason for this exact link<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed the retained source IDs and understand that only an exact current match can link this job.</label>
      <div className="flex gap-2"><button type="submit" className="cp-secondary" disabled={busy || !confirmed || reason.trim().length < 3}>{busy ? "Checking exact IDs…" : "Confirm exact job link"}</button>
        <button type="button" className="cp-secondary" disabled={busy} onClick={() => { setOpen(false); setConfirmed(false); }}>Cancel</button></div>
    </form>}
    {receipt && <div className="space-y-2 rounded border p-3">
      <p>Job link {receipt.linkId} · {receipt.state === "linked" ? `audit ${receipt.auditId}` : "already linked at this source version"}.</p>
      {!reversed && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void reverse(); }}>
        <label className="block">Reason to reverse this job link<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={reverseReason} onChange={e => setReverseReason(e.target.value)} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={reverseConfirmed} onChange={e => setReverseConfirmed(e.target.checked)} /> I intend to reverse this exact source link; the saved source and audit will remain.</label>
        <button type="submit" className="cp-secondary" disabled={busy || !reverseConfirmed || reverseReason.trim().length < 3}>{busy ? "Checking reversal…" : "Reverse exact job link"}</button>
      </form>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
