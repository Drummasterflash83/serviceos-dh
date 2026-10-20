import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { WorkSource } from "@/lib/learn-commusoft-work";
import { applyExactSite, restoreExactSite } from "@/lib/new-dawn-exact-site-action";
import { loadExactSiteTarget, type ExactSiteTarget } from "@/lib/new-dawn-exact-site-target";

const holdLabel: Record<string, string> = {
  customer_mapping_missing_or_stale: "The exact parent customer needs a current reviewed link first.",
  customer_source_missing_or_ambiguous: "The parent customer source is missing or ambiguous.",
  site_source_missing_or_ambiguous: "The work-site source is missing or ambiguous.",
  site_source_identity_conflict: "The work-site source identity conflicts with its saved ID.",
  site_identity_already_reviewed: "This site was reviewed elsewhere. Refresh its current link before continuing.",
  site_external_identity_conflict: "Another site uses this exact external ID.",
  legacy_site_identity_conflict: "An earlier site identity conflicts with this source ID.",
  customer_target_conflict: "The reviewed customer card no longer matches its target.",
  site_source_changed: "The saved work-site source changed. Refresh before confirming.",
};

export function ExactSiteReviewAction({ tenant, connection, external, expectedCustomer, source,
  operatorReason, canApply, disabled, onLinked }: {
  tenant: string; connection: string; external: string; expectedCustomer: string;
  source: WorkSource | null; operatorReason: string; canApply: boolean;
  disabled: boolean; onLinked: () => void;
}) {
  const [target, setTarget] = useState<ExactSiteTarget | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const exact = !!target && !!source && source.external_id === external &&
    source.version_id === target.version && target.parent === expectedCustomer &&
    source.property_reference === expectedCustomer && !source.relationship_reason;
  useEffect(() => { generation.current++; setTarget(null); setConfirmed(false); setNotice("");
    return () => { generation.current++; }; },
    [tenant, connection, external, expectedCustomer, source?.version_id]);
  async function inspect() {
    if (busy || disabled || document.hidden) return;
    const ticket = generation.current;
    setBusy(true); setNotice(""); setTarget(null); setConfirmed(false);
    try {
      const read = await loadExactSiteTarget(getSupabaseClient(), {
        tenant, connection, external, reason: operatorReason,
      });
      if (generation.current === ticket && !document.hidden) setTarget(read);
    } catch (error) {
      if (generation.current === ticket) setNotice(error instanceof Error ? error.message : "Exact site review unavailable.");
    } finally { if (generation.current === ticket) setBusy(false); }
  }
  async function confirm() {
    if (!canApply || !target || !source?.version_id || !exact || target.state === "review" ||
      target.state === "linked_current" || target.state === "legacy_current" ||
      !confirmed || reason.trim().length < 3 || busy || disabled || document.hidden) return;
    const ticket = generation.current;
    setBusy(true); setNotice("");
    try {
      const result = target.state === "reversed_valid" && target.linkId
        ? await restoreExactSite(getSupabaseClient(), { tenant, linkId: target.linkId, reason })
        : await applyExactSite(getSupabaseClient(), {
          tenant, connection, external, version: source.version_id, reason,
        });
      if (generation.current !== ticket || document.hidden) return;
      setConfirmed(false);
      if (result.state === "review") {
        setTarget(null);
        setNotice(holdLabel[result.reason] ?? "The exact work-site source or customer mapping needs review before it can link.");
      } else {
        setNotice(`Exact work-site link recorded with audit ${result.auditId}.`);
        onLinked();
      }
    } catch {
      if (generation.current === ticket) {
        setTarget(null); setConfirmed(false);
        setNotice("Result uncertain or source changed. Refresh the exact site and audit before retrying.");
      }
    } finally { if (generation.current === ticket) setBusy(false); }
  }
  return <section className="cp-card space-y-3" aria-label="Confirm exact Commusoft work site">
    <h3 className="font-semibold">Confirm this exact work site</h3>
    <p>Commusoft work-site ID {external} · parent customer ID {expectedCustomer}. The server verifies saved source versions and the customer's one reviewed ServiceOS card. Names and address similarity cannot make this link.</p>
    {source && <p>Saved source address: {source.title} · source version {source.version_id ?? "conflicted"}.</p>}
    {!source && <p role="status">The exact work-site source is unavailable. Reload before reviewing.</p>}
    <button type="button" className="cp-secondary" disabled={busy || disabled || !source?.version_id}
      onClick={() => void inspect()}>{busy ? "Checking exact source…" : "Inspect current site evidence"}</button>
    {target && <p role="status">As of {new Date(target.observedAt).toLocaleString()}: {target.state === "review"
      ? holdLabel[target.reason ?? ""] ?? `Held for review (${target.reason}).`
      : `${target.state.replaceAll("_", " ")} · source version ${target.version} · audit ${target.auditId}.`}</p>}
    {target && !exact && <p role="status">The saved site version or parent customer differs from this job. Hold this review and refresh the source.</p>}
    {target && exact && (target.state === "linked_current" || target.state === "legacy_current") &&
      <button type="button" className="cp-secondary" disabled={disabled} onClick={onLinked}>Current reviewed site link — continue to exact job</button>}
    {target && exact && !canApply && (target.state === "ready" || target.state === "reversed_valid") &&
      <p>Exact-link application is held until the full dry-run counts and conflicts are reviewed.</p>}
    {canApply && target && exact && (target.state === "ready" || target.state === "reversed_valid") &&
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); void confirm(); }}>
        <p>{target.state === "reversed_valid" ? "This previously reviewed site link is reversed. Restore it only after checking the same source and parent." : "This action creates one ServiceOS work site under the reviewed customer."}</p>
        {target.address && <p>Current source address: {target.address}</p>}
        <label className="block">Reason for this exact site decision<textarea className="mt-1 block w-full rounded border p-2" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I checked the saved work-site and parent IDs. This is an OpenFolk source link, not a Commusoft change.</label>
        <button type="submit" className="cp-secondary" disabled={busy || disabled || !confirmed || reason.trim().length < 3}>{target.state === "reversed_valid" ? "Restore reviewed site" : "Confirm reviewed work site"}</button>
      </form>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
