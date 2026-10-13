import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import type { ReviewClient } from "@/lib/learn-commusoft-review";
import {
  loadJobRefresh,
  prepareJobRefresh,
  readJobRefreshDraft,
  resolveJobRefresh,
  type RefreshPlan,
  type RefreshDraft,
  type RefreshFields,
} from "@/lib/learn-job-refresh";
const labels: Record<keyof RefreshFields, string> = {
  title: "Job description",
  description: "Description",
  status: "Status",
  created_date: "Created time",
  completed_date: "Completed time",
};
export function LearnJobRefresh({
  tenant,
  actor,
  link,
  canEdit,
  client,
  onSaved,
}: {
  tenant: string;
  actor: string;
  link: string;
  canEdit: boolean;
  client?: ReviewClient;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [plan, setPlan] = useState<RefreshPlan | null>(null),
    [draft, setDraft] = useState<RefreshDraft | null>(null),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    working = useRef(false),
    editable = useRef(canEdit);
  editable.current = canEdit;
  const scope = {
    backend: supabaseConfig.url.replace(/\/$/, ""),
    tenant,
    actor,
  };
  useEffect(() => {
    generation.current++;
    setPlan(null);
    setDraft(null);
    setBusy(false);
    setOpen(false);
    setReason("");
    setApproved(false);
    setNotice("");
    return () => {
      generation.current++;
    };
  }, [tenant, actor, link, canEdit]);
  async function run(work: (active: () => boolean) => Promise<void>) {
    if (working.current || !editable.current) return;
    working.current = true;
    setBusy(true);
    setApproved(false);
    setNotice("");
    const ticket = ++generation.current;
    const active = () => generation.current === ticket && editable.current;
    try {
      await work(active);
    } catch (e) {
      if (active()) setNotice(e instanceof Error ? e.message : "Unable to verify this job update.");
    } finally {
      if (active()) {
        try {
          setDraft(readJobRefreshDraft(localStorage, scope, link));
        } catch (e) {
          setPlan(null);
          setNotice(e instanceof Error ? e.message : "Saved review unavailable.");
        }
        setBusy(false);
      }
      working.current = false;
    }
  }
  async function read() {
    await run(async (active) => {
      setOpen(true);
      setPlan(null);
      const saved = readJobRefreshDraft(localStorage, scope, link);
      if (!active()) return;
      setDraft(saved);
      const result = await loadJobRefresh(client ?? getSupabaseClient(), scope, link);
      if (active()) setPlan(result);
    });
  }
  async function resolve(apply: boolean) {
    if (apply && !draft && (!approved || plan?.state !== "ready" || reason.trim().length < 3))
      return;
    await run(async (active) => {
      const pending =
        draft ??
        (plan?.state === "ready"
          ? prepareJobRefresh(scope, plan, crypto.randomUUID(), reason)
          : null);
      if (!pending) return;
      const receipt = await resolveJobRefresh(
        client ?? getSupabaseClient(),
        localStorage,
        pending,
        apply,
        async (name, work) => {
          if (!navigator.locks)
            throw Error("This browser cannot coordinate saved reviews. Use a current browser.");
          return navigator.locks.request(name, work);
        },
        active,
      );
      if (!active()) return;
      if (receipt.state === "pending") {
        setNotice(
          "No saved result yet. Keep this request and check again or retry the same reviewed update.",
        );
        return;
      }
      setDraft(null);
      setPlan(null);
      setNotice(
        "The job was updated from Commusoft. Its earlier record and source history are retained.",
      );
      onSaved?.();
    });
  }
  return (
    <section aria-label="Review published job update" className="space-y-3">
      <button
        type="button"
        className="cp-secondary"
        disabled={busy || !canEdit}
        onClick={() => void read()}
      >
        {open ? "Reload job update" : "Review job update"}
      </button>
      {busy && <p role="status">Checking the saved job and its latest source…</p>}
      {notice && <p role="status">{notice}</p>}
      {open && draft && (
        <div className="space-y-2">
          <p>
            A reviewed update has a saved request. Check its result before preparing another update.
          </p>
          <p>Review reason: {draft.reason}</p>
          <button
            type="button"
            className="cp-secondary"
            disabled={busy || !canEdit}
            onClick={() => void resolve(false)}
          >
            Check saved update
          </button>
          <button
            type="button"
            className="cp-secondary"
            disabled={busy || !canEdit}
            onClick={() => void resolve(true)}
          >
            Retry reviewed update
          </button>
        </div>
      )}
      {open && !draft && plan?.state === "current" && (
        <p>This job already uses the latest retained Commusoft version.</p>
      )}
      {open && !draft && plan?.state === "held" && (
        <p role="status">
          This update needs additional review. The saved job has not changed.{" "}
          {plan.reason === "local_fields_changed"
            ? "Someone has edited the published fields; those edits will be preserved."
            : plan.reason?.includes("owner")
              ? "Customer or site ownership needs checking before this update can proceed."
              : "Check the source record and its linked customer in OpenFolk."}
        </p>
      )}
      {open && !draft && plan?.state === "ready" && (
        <div className="space-y-3">
          <p>
            Review the latest Commusoft changes for job {plan.job_number}. The job identity and
            customer stay the same; previous evidence is retained.
          </p>
          {plan.changed_fields.length ? (
            <dl>
              {plan.changed_fields.map((field) => (
                <div key={field}>
                  <dt>
                    <strong>{labels[field as keyof RefreshFields]}</strong>
                  </dt>
                  <dd className="whitespace-pre-wrap break-words">
                    Saved: {plan.before[field as keyof RefreshFields] ?? "Not recorded"}
                    <br />
                    Latest source: {plan.after[field as keyof RefreshFields] ?? "Not recorded"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>The retained source changed without changing the published job fields.</p>
          )}
          {!!plan.timing_limitations.length && (
            <p>
              The {plan.timing_limitations.join(" and ")} time has no confirmed timezone. It will
              remain excluded from duration and performance calculations.
            </p>
          )}
          <label className="block">
            Reason for accepting this update
            <input
              className="cp-input"
              value={reason}
              maxLength={1000}
              disabled={busy || !canEdit}
              onChange={(e) => {
                setReason(e.target.value);
                setApproved(false);
              }}
            />
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={approved}
              disabled={busy || !canEdit}
              onChange={(e) => setApproved(e.target.checked)}
            />{" "}
            I have reviewed these changes against the source.
          </label>
          <button
            type="button"
            className="cp-primary"
            disabled={busy || !canEdit || !approved || reason.trim().length < 3}
            onClick={() => void resolve(true)}
          >
            Save reviewed job update
          </button>
        </div>
      )}
    </section>
  );
}
