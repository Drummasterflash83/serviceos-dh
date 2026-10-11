import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadPerformanceEvidence } from "@/lib/learn-performance-evidence";
import type { EvidenceRef } from "@/lib/learn-scorecards";
import { LearnPhoneAudio } from "./LearnPhoneAudio";

/** Remount on source/tenant changes so an earlier source cannot flash on a new card. */
export function LearnStoredEvidence(props: { tenantId: string; reference: EvidenceRef }) {
  return (
    <SourceEvidence
      key={`${props.tenantId}:${props.reference.table}:${props.reference.id}`}
      {...props}
    />
  );
}

const evidenceTitles: Record<string, string> = {
  interactions: "Communication excerpt",
  email_messages: "Email excerpt",
  phone_calls: "Call details",
  phone_recordings: "Recording details",
  jobs: "Job details",
  team_members: "Team member details",
  learn_team_work_measurement_runs: "Retained team workload calculation",
  learn_work_measurement_runs: "Calculation record",
};
const evidenceLabels: Record<string, string> = {
  snippet: "Excerpt",
  "body preview": "Excerpt",
  summary: "Stored summary",
  "sent at": "Sent",
  "received at": "Received",
  "started at": "Started",
  "occurred at": "Occurred",
  "source connector id": "Source",
  direction: "Provider direction",
  outcome: "Provider outcome",
  "duration seconds": "Duration",
};
function evidenceValue(label: string, value: string) {
  if (
    ["sent at", "received at", "started at", "occurred at"].includes(label) &&
    Number.isFinite(Date.parse(value))
  )
    return new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
  return label === "duration seconds" ? value + " seconds" : value;
}
function SourceEvidence({ tenantId, reference }: { tenantId: string; reference: EvidenceRef }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<{ label: string; value: string }[] | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setData(null);
    setError("");
    void loadPerformanceEvidence(getSupabaseClient(), tenantId, reference).then(
      (r) => {
        if (active) setData(r);
      },
      () => {
        if (active) setError("Source unavailable with your current access.");
      },
    );
    return () => {
      active = false;
    };
  }, [open, tenantId, reference.table, reference.id, revision]);
  return (
    <details className="lc-source-evidence" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{evidenceTitles[reference.table] ?? "Supporting evidence"}</summary>
      {open && (
        <p>
          Current retained excerpt or metadata. This does not fetch from the provider or establish
          complete history.
          {reference.table === "phone_recordings" &&
            " Recording metadata does not confirm audio playback."}
        </p>
      )}
      {open &&
        (error ? (
          <div role="status">
            <p>{error}</p>
            <button
              type="button"
              className="cp-secondary"
              onClick={() => setRevision((n) => n + 1)}
            >
              Retry source read
            </button>
          </div>
        ) : data?.length === 0 ? (
          <p>This source record has no excerpt or metadata to display.</p>
        ) : data ? (
          <div>
            <dl>
              {data.map((f) => (
                <div key={f.label}>
                  <dt>{evidenceLabels[f.label] ?? f.label}</dt>
                  <dd>{evidenceValue(f.label, f.value)}</dd>
                </div>
              ))}
            </dl>
            <small>Source reference: {reference.id}</small>
            {(reference.table === "phone_calls" || reference.table === "phone_recordings") && (
              <LearnPhoneAudio
                tenantId={tenantId}
                table={reference.table}
                sourceId={reference.id}
              />
            )}
          </div>
        ) : (
          <p>Reading source…</p>
        ))}
    </details>
  );
}
