import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { addPhoneToGroup, type PhonePlan } from "@/lib/phone-plan";
import {
  phoneSnapshotSchema,
  phoneChanges,
  encodePhoneChanges,
  type PhoneSnapshot,
} from "@/lib/phone-changes";
import "./phone-planner.css";

export function PhonePlanner({ tenant, demo }: { tenant: string; demo: boolean }) {
  const { user } = useAuth();
  const db = getSupabaseClient(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<{ baseline: PhoneSnapshot; plan: PhonePlan } | null>(null);
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const snapshot = useQuery({
    queryKey: ["phone-snapshot", user?.id, tenant],
    enabled: !!user && !demo,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_workspaces")
        .select("phone_snapshot")
        .eq("tenant_id", tenant)
        .single();
      if (error)
        throw Error(
          "The verified phone setup could not be loaded. OpenFolk needs to check the connection.",
        );
      if (!data.phone_snapshot) return null;
      const parsed = phoneSnapshotSchema.safeParse(data.phone_snapshot);
      if (!parsed.success || Date.parse(parsed.data.observedAt) > Date.now())
        throw Error("The phone inventory needs verification before changes can be requested.");
      return parsed.data;
    },
    refetchInterval: 60000,
  });
  const requests = useQuery({
    queryKey: ["phone-plan-requests", user?.id, tenant],
    enabled: !!user && !demo,
    queryFn: async () => {
      const rows: {
        id: string;
        title: string;
        status: string;
        response: string;
        created_at: string;
      }[] = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await db
          .from("receptionist_feedback")
          .select("id,title,status,response,created_at")
          .eq("tenant_id", tenant)
          .eq("category", "routing")
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 99);
        if (error)
          throw Error("Change history unavailable. Refresh before sending another change.");
        rows.push(...data);
        if (data.length < 100) return rows;
      }
    },
    refetchInterval: 30000,
  });
  const baseline = snapshot.data,
    plan = draft?.plan ?? baseline?.plan;
  const stale = !!draft && JSON.stringify(baseline) !== JSON.stringify(draft.baseline);
  const edit = (next: PhonePlan) => {
    if (!baseline || busy || uncertain || stale || snapshot.isError) return;
    setDraft({ baseline: draft?.baseline ?? baseline, plan: next });
    setReview(false);
    setMessage("");
  };
  let changes: string[] = [],
    validation = "";
  if (draft) {
    try {
      changes = phoneChanges(draft.baseline.plan, draft.plan);
    } catch {
      validation = "Check phone names and group members before saving.";
    }
  }
  async function save() {
    if (!draft || busy || uncertain || stale || !changes.length || demo) return;
    setBusy(true);
    setMessage("");
    try {
      const latest = await snapshot.refetch();
      if (!latest.isSuccess || JSON.stringify(latest.data) !== JSON.stringify(draft.baseline))
        throw Error("The baseline changed or could not be verified. Reload before submitting.");
      const body = encodePhoneChanges(draft.baseline, draft.plan);
      // Once dispatched, any ambiguous failure must be checked in history first.
      setUncertain(true);
      const { error } = await db.from("receptionist_feedback").insert({
        tenant_id: tenant,
        category: "routing",
        priority: "normal",
        title: "Phone system · apply my changes",
        body,
      });
      if (error) {
        setUncertain(true);
        throw Error("Save could not be confirmed. Check the request history before retrying.");
      }
      setDraft(null);
      setUncertain(false);
      setReview(false);
      setMessage(
        "Changes saved · awaiting OpenFolk. Your verified setup stays unchanged until the provider change has been applied and tested.",
      );
      await Promise.all(
        ["phone-plan-requests", "receptionist-feedback", "receptionist-delivery"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pp">
      <section className="rw-panel pp-intro">
        <span className="rw-pill">Your phone system · Birchills</span>
        <h2>The right call. The right people.</h2>
        <p>
          See who rings, who answers and what happens next. Change a phone name or add someone to a
          group; OpenFolk handles the provider update and checks it works.
        </p>
        {baseline && (
          <p className="rw-footnote">
            Last verified{" "}
            {new Date(baseline.observedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} ·{" "}
            {baseline.version}. A verified snapshot, not continuous live synchronisation.
          </p>
        )}
      </section>
      {snapshot.isLoading && <section className="rw-panel">Loading your verified setup…</section>}
      {snapshot.isError && (
        <section className="rw-panel" role="alert">
          {snapshot.error.message} <button onClick={() => void snapshot.refetch()}>Retry</button>
        </section>
      )}
      {!baseline && !snapshot.isLoading && !snapshot.isError && (
        <section className="rw-panel">
          <h3>OpenFolk is verifying your phone setup</h3>
          <p>
            Your actual phones, ring groups and fallback routes will appear here after the current
            Birchills settings have been checked. You do not need to build them yourself.
          </p>
          <p>
            No live configuration is being guessed. Editing becomes available once the baseline is
            verified.
          </p>
        </section>
      )}
      {plan && baseline && (
        <>
          <div className="pp-flow">
            <span>{plan.phones.length} phones</span>
            <span>{plan.groups.length} call groups</span>
            <span>{plan.hours}</span>
          </div>
          <fieldset className="pp-editor" disabled={busy || uncertain || stale || snapshot.isError}>
            <div className="pp-columns">
              <section className="rw-panel">
                <h3>People & phones</h3>
                <p>
                  Rename below. Drag a phone onto a group to add it, or use Add person. To move
                  someone, also remove them from their old group.
                </p>
                {plan.phones.map((p) => (
                  <article
                    className="pp-phone"
                    key={p.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("application/openfolk-phone", p.id)}
                  >
                    <span className="pp-grip" aria-hidden="true">
                      ⠿
                    </span>
                    <label>
                      Extension {p.extension}
                      <input
                        aria-label={`Name for extension ${p.extension}`}
                        value={p.name}
                        maxLength={80}
                        onChange={(e) =>
                          edit({
                            ...plan,
                            phones: plan.phones.map((x) =>
                              x.id === p.id ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </article>
                ))}
              </section>
              <section className="pp-groups" aria-label="Verified ring groups with pending edits">
                {plan.groups.map((g) => (
                  <article
                    className="rw-panel pp-group"
                    key={g.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      edit(
                        addPhoneToGroup(
                          plan,
                          e.dataTransfer.getData("application/openfolk-phone"),
                          g.id,
                        ),
                      );
                    }}
                  >
                    <h3>{g.name}</h3>
                    <p>
                      Rings {g.strategy.toLowerCase()} · {g.seconds} seconds
                    </p>
                    <ol className="pp-members">
                      {g.members.map((id, index) => {
                        const p = plan.phones.find((p) => p.id === id)!;
                        return (
                          <li key={id}>
                            <span>
                              {p.name} · {p.extension}
                            </span>
                            <button
                              aria-label={`Move ${p.name} earlier in ${g.name}`}
                              disabled={index === 0}
                              onClick={() => {
                                const members = [...g.members];
                                [members[index - 1], members[index]] = [
                                  members[index]!,
                                  members[index - 1]!,
                                ];
                                edit({
                                  ...plan,
                                  groups: plan.groups.map((x) =>
                                    x.id === g.id ? { ...x, members } : x,
                                  ),
                                });
                              }}
                            >
                              ↑
                            </button>
                            <button
                              disabled={g.members.length === 1}
                              aria-label={`Remove ${p.name} from ${g.name}`}
                              onClick={() =>
                                edit({
                                  ...plan,
                                  groups: plan.groups.map((x) =>
                                    x.id === g.id
                                      ? { ...x, members: x.members.filter((m) => m !== id) }
                                      : x,
                                  ),
                                })
                              }
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                    <label>
                      Add person
                      <select
                        value=""
                        onChange={(e) => edit(addPhoneToGroup(plan, e.target.value, g.id))}
                      >
                        <option value="">Choose a phone…</option>
                        {plan.phones
                          .filter((p) => !g.members.includes(p.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {p.extension}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="pp-caution">
                      <strong>If nobody answers</strong>
                      <br />
                      {g.fallback}
                    </p>
                  </article>
                ))}
              </section>
            </div>
          </fieldset>
          {draft && (
            <section className="rw-panel">
              <h3>{changes.length} pending changes</h3>
              {validation && <p role="alert">{validation}</p>}
              {stale && (
                <p role="alert">
                  The verified setup has changed. Discard this draft and review the latest version.
                </p>
              )}
              <ul>
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p>
                Pending changes are separate from the verified setup. OpenFolk will apply and test
                them. Automated Mac mini execution is not connected yet.
              </p>
              <button
                className="rw-btn"
                disabled={
                  busy ||
                  uncertain ||
                  stale ||
                  !changes.length ||
                  !!validation ||
                  !requests.isSuccess
                }
                onClick={() => (review ? void save() : setReview(true))}
              >
                {busy ? "Saving…" : review ? "Confirm changes" : "Review changes"}
              </button>{" "}
              <button
                className="rw-text-btn"
                disabled={busy || uncertain}
                onClick={() => {
                  setDraft(null);
                  setReview(false);
                }}
              >
                Discard draft
              </button>
            </section>
          )}
        </>
      )}
      {message && (
        <p className="pp-message" role="status">
          {message}
        </p>
      )}
      <section className="rw-panel">
        <h3>Changes & updates</h3>
        <p>
          Track your request here. “Resolved” alone does not certify a provider change; OpenFolk's
          response and an updated verified snapshot provide the evidence.
        </p>
        {requests.isError && <p role="alert">{requests.error.message}</p>}
        {(requests.isError || uncertain) && (
          <button
            onClick={async () => {
              const r = await requests.refetch();
              if (r.isSuccess) {
                setUncertain(false);
                setMessage("History refreshed. Check for your request before submitting again.");
              }
            }}
          >
            Refresh request history
          </button>
        )}
        {requests.data?.map((r) => (
          <article className="pp-history" key={r.id}>
            <strong>{r.title}</strong>
            <p>
              {new Date(r.created_at).toLocaleString("en-GB")} · {r.status}
            </p>
            {r.response && <p>{r.response}</p>}
          </article>
        ))}
        {requests.isSuccess && !requests.data.length && <p>No changes requested yet.</p>}
        {requests.isLoading && <p>Loading request history…</p>}
      </section>
    </div>
  );
}
