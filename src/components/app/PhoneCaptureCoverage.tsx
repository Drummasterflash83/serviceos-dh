import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Database, AlertCircle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Sync = { status: string; completedAt: string | null; windowComplete: boolean | null };
type Coverage = {
  asOf: string;
  source: string;
  connectionEnabled: boolean;
  localLegsIncluded: boolean;
  note: string;
  calls: {
    total: number | null;
    inbound: number | null;
    outbound: number | null;
    last24Hours: number | null;
  };
  recordings: {
    total: number | null;
    complete: number | null;
    awaitingDownload: number | null;
    awaitingTranscript: number | null;
    awaitingAnalysis: number | null;
    unresolvedFailures: number | null;
    lastProcessedAt: string | null;
  };
  sync: { calls: Sync; recordings: Sync };
  emmaReview?: {
    enabled: boolean;
    state: string;
    lastScanAt: string | null;
    savedReviews: number | null;
    pending: number | null;
    needsReview: number | null;
    alertsNeedReview: number | null;
    liveReviewed: number | null;
    practiceReviewed: number | null;
    feedbackRevisionsReviewed: number | null;
  };
};
const number = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("en-GB") : "Not verified";
const stamp = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Not verified";
export function PhoneCaptureCoverage({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Coverage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await getSupabaseClient().functions.invoke("phone-capture-coverage", {
        body: { tenantId },
      });
      if (response.error || response.data?.error)
        throw Error("Capture evidence could not be refreshed.");
      return response.data as Coverage;
    } catch {
      setError("Capture evidence could not be refreshed. Last known figures are not a live check.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [tenantId]);
  useEffect(() => {
    let active = true;
    setData(null);
    void load().then((next) => {
      if (active && next) setData(next);
    });
    return () => {
      active = false;
    };
  }, [load]);
  return (
    <section
      aria-labelledby="phone-capture-heading"
      className="rounded-2xl border border-purple-200 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-700">
            <Database size={16} aria-hidden="true" /> Call capture
          </div>
          <h2 id="phone-capture-heading" className="text-xl font-semibold text-[#2d243f]">
            What is reaching ServiceOS?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Birchills call records, recordings and understanding—measured separately.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void load().then((next) => {
              if (next) setData(next);
            })
          }
          className="inline-flex items-center gap-2 rounded-lg border border-purple-200 px-3 py-2 text-sm text-purple-900 disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} aria-hidden="true" />
          {busy ? "Checking" : "Refresh"}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-4 text-sm text-slate-600">Reading capture evidence…</p>}
      {data && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              [
                "Call records",
                number(data.calls.total),
                `${number(data.calls.inbound)} inbound · ${number(data.calls.outbound)} outbound`,
              ],
              [
                "Recording records",
                number(data.recordings.total),
                `${number(data.recordings.awaitingDownload)} waiting for audio download`,
              ],
              [
                "Transcribed & analysed",
                number(data.recordings.complete),
                `${number(data.recordings.awaitingTranscript)} awaiting transcript · ${number(data.recordings.awaitingAnalysis)} awaiting analysis`,
              ],
            ].map(([title, value, detail]) => (
              <div key={title} className="rounded-xl bg-[#f5f1f8] p-4">
                <p className="text-sm font-medium text-[#2d243f]">{title}</p>
                <p className="mt-2 text-2xl font-semibold text-[#2d243f]">{value}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">{detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
            <span>Last 24 hours: {number(data.calls.last24Hours)} call records</span>
            <span>
              Unresolved processing failures: {number(data.recordings.unresolvedFailures)}
            </span>
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="flex items-center gap-2 font-semibold">
              <AlertCircle size={16} aria-hidden="true" /> Whole-call coverage still needs
              reconciliation
            </p>
            <p className="mt-2 leading-relaxed">{data.note}</p>
            <p className="mt-2">
              Local-only PBX legs:{" "}
              {data.localLegsIncluded
                ? "included by configuration"
                : "not included in the configured import"}
              .
            </p>
          </div>
          <dl className="mt-4 grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt>Latest call sync</dt>
              <dd>
                {data.sync.calls.status === "success" ? "Completed" : data.sync.calls.status} ·{" "}
                {stamp(data.sync.calls.completedAt)}
              </dd>
            </div>
            <div>
              <dt>Latest recording sync</dt>
              <dd>
                {data.sync.recordings.status === "success"
                  ? "Completed"
                  : data.sync.recordings.status}{" "}
                · {stamp(data.sync.recordings.completedAt)}
              </dd>
            </div>
          </dl>
          <div className="mt-4 rounded-xl bg-[#f5f1f8] p-4 text-sm text-[#2d243f]">
            <p className="font-semibold">Emma’s automatic call reviews</p>
            <p className="mt-1">
              {!data.emmaReview
                ? "Automatic review status has not been verified."
                : data.emmaReview.enabled
                  ? `Configured · last scan ${stamp(data.emmaReview.lastScanAt)}`
                  : "Not enabled. Practice feedback reviews and PBX call analysis are separate."}
            </p>
            {data.emmaReview && (
              <div className="mt-2 space-y-1 text-xs text-slate-600">
                <p>
                  {number(data.emmaReview.savedReviews)} saved call reviews · scan state:{" "}
                  {data.emmaReview.state}
                </p>
                <p>
                  {number(data.emmaReview.liveReviewed)} live calls reviewed ·{" "}
                  {number(data.emmaReview.practiceReviewed)} practice calls reviewed ·{" "}
                  {number(data.emmaReview.pending)} queued or awaiting evidence
                </p>
                <p>
                  {number(data.emmaReview.needsReview)} reviews need attention ·{" "}
                  {number(data.emmaReview.alertsNeedReview)} alert deliveries need checking
                </p>
                <p>
                  {number(data.emmaReview.feedbackRevisionsReviewed)} feedback revisions assessed.
                  New or edited feedback is checked separately without counting the same call twice.
                </p>
                <p>
                  Evidence-based text review, not an audio-quality certification. Up to 100 review
                  attempts per day; excess calls stay queued. Emma is never changed automatically.
                </p>
              </div>
            )}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            All-time imported totals. Checked {stamp(data.asOf)}. No claim that one call equals one
            recording.
          </p>
        </>
      )}
    </section>
  );
}
