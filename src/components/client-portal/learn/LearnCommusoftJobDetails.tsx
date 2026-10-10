import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  JOB_DETAIL_FIELDS,
  JOB_DETAIL_DATES,
  loadCommusoftJobDetails,
  type JobDetails,
} from "@/lib/learn-commusoft-job-details";
export function LearnCommusoftJobDetails({
  tenant,
  connection,
  version,
  external,
}: {
  tenant: string;
  connection: string;
  version: string;
  external: string;
}) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<JobDetails | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setData(null);
    setError("");
    void loadCommusoftJobDetails(getSupabaseClient(), tenant, connection, version, external)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open, revision, tenant, connection, version, external]);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Inspect retained job {external}</summary>
      {busy && <p role="status">Reading retained job details…</p>}
      {error && <p role="status">{error}</p>}
      {open && !busy && (
        <button type="button" className="cp-secondary" onClick={() => setRevision((n) => n + 1)}>
          {error ? "Retry job details" : "Refresh job details"}
        </button>
      )}
      {data && (
        <section aria-label={`Retained job ${external} details`} className="space-y-3">
          <p>
            Source details retained from Commusoft. This view does not link the job, confirm its
            accuracy or calculate a score.
          </p>
          {!data.current && (
            <p role="status">
              This selected source version has changed or its latest observation is ambiguous.
              Refresh the job list before linking.
            </p>
          )}
          <p>
            Last observed for this version: {new Date(data.observed_at).toISOString()} · Property{" "}
            {data.property_reference ?? "not verified"}
          </p>
          <dl>
            {Object.entries(JOB_DETAIL_FIELDS).map(([key, label]) => {
              const field = data.fields[key as keyof typeof JOB_DETAIL_FIELDS];
              return (
                <div key={key}>
                  <dt>
                    <strong>{label}</strong>
                  </dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {field.value || "Not provided"}
                    {field.shortened && " [Excerpt shortened; full source retained]"}
                  </dd>
                </div>
              );
            })}
          </dl>
          <h4>Source dates</h4>
          <dl>
            {Object.entries(JOB_DETAIL_DATES).map(([key, label]) => {
              const date = data.dates[key as keyof typeof JOB_DETAIL_DATES];
              return (
                <div key={key}>
                  <dt>
                    <strong>{label}</strong>
                  </dt>
                  <dd className="break-words">
                    {date.source ?? "Not provided"}
                    {date.state === "zoned" && <p>UTC: {date.instant}</p>}
                    {date.state === "timezone_required" && (
                      <p>
                        Timezone not supplied. This is the original source text, excluded from
                        elapsed-time calculations.
                      </p>
                    )}
                    {date.state === "invalid" && (
                      <p>The source date format needs review. No time has been inferred.</p>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p>Source version: {data.version_id}</p>
        </section>
      )}
    </details>
  );
}
