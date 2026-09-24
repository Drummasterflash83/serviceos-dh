import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  addPhoneToGroup,
  decodePhonePlan,
  describePhonePlan,
  emptyPhonePlan,
  encodePhonePlan,
  type PhonePlan,
} from "@/lib/phone-plan";
import "./phone-planner.css";

type Request = {
  id: string;
  title: string;
  body: string;
  status: string;
  response: string;
  created_at: string;
};
export function PhonePlanner({ tenant, demo }: { tenant: string; demo: boolean }) {
  const { user } = useAuth();
  const db = getSupabaseClient();
  const qc = useQueryClient();
  const [plan, setPlan] = useState(emptyPhonePlan);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requests = useQuery({
    queryKey: ["phone-plan-requests", user?.id, tenant],
    enabled: !demo && !!user,
    queryFn: async () => {
      const rows: Request[] = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await db
          .from("receptionist_feedback")
          .select("id,title,body,status,response,created_at")
          .eq("tenant_id", tenant)
          .eq("category", "routing")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + 99);
        if (error)
          throw Error("Saved phone requests are unavailable. Please refresh before submitting.");
        rows.push(...(data as Request[]));
        if (data.length < 100) return rows.filter((r) => decodePhonePlan(r.body));
      }
    },
    refetchInterval: 30000,
  });
  const update = (next: PhonePlan) => {
    setPlan(next);
    setReview(false);
    setMessage("");
  };
  function reviewPlan() {
    try {
      encodePhonePlan(plan);
      setReview(true);
      setMessage("");
    } catch (e) {
      setMessage(
        e instanceof Error && "issues" in e
          ? "Check the plan: every phone needs a name and unique 2–8 digit extension; every group needs members, a name, a 5–120 second ring time and a fallback. Include working hours and time zone."
          : (e as Error).message,
      );
    }
  }
  async function submit() {
    if (busy || uncertain) return;
    if (demo) {
      setMessage("Preview only — nothing was saved, sent or changed in Birchills.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const body = encodePhonePlan(plan);
      const { error } = await db.from("receptionist_feedback").insert({
        tenant_id: tenant,
        category: "routing",
        priority: "normal",
        title: "Birchills · phone configuration request",
        body,
      });
      if (error)
        throw Error(
          "Save could not be confirmed. Check request history before trying again; Birchills has not been changed.",
        );
      setReview(false);
      setPlan(emptyPhonePlan());
      setMessage(
        "Request saved for OpenFolk review. Birchills has not changed. Slack delivery is tracked separately under Make Emma better.",
      );
      await qc.invalidateQueries({ queryKey: ["phone-plan-requests"] });
      await qc.invalidateQueries({ queryKey: ["receptionist-feedback"] });
      await qc.invalidateQueries({ queryKey: ["receptionist-delivery"] });
    } catch (e) {
      setUncertain(true);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pp">
      <section className="rw-panel pp-intro">
        <span className="rw-pill">Birchills · managed by OpenFolk</span>
        <h2>Your phones. Your team. One simple plan.</h2>
        <p>
          Drag phones into call groups, name them clearly and tell us what should happen next.
          OpenFolk reviews and applies the changes for you.
        </p>
        <p className="pp-caution">
          <strong>Proposal builder — not live configuration.</strong> Current Birchills settings are
          not synchronised here. Start a proposed plan or copy a previous request. Nothing changes
          on your phone system when you move a card.
        </p>
      </section>
      <div className="pp-flow" aria-label="Change process">
        <span>1 · Arrange</span>
        <span>2 · Review & submit</span>
        <span>3 · OpenFolk applies</span>
        <span>4 · Test & confirm</span>
      </div>
      <fieldset disabled={busy || uncertain} className="pp-editor">
        <div className="pp-columns">
          <section className="rw-panel">
            <h3>People & phones</h3>
            <p>Add existing extensions. These are proposed labels, not new phone accounts.</p>
            {plan.phones.map((p) => (
              <article
                className="pp-phone"
                key={p.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/openfolk-phone", p.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <span className="pp-grip" aria-hidden="true">
                  ⠿
                </span>
                <label>
                  Phone name
                  <input
                    aria-label={`Phone name ${p.extension || "new"}`}
                    maxLength={80}
                    value={p.name}
                    onChange={(e) =>
                      update({
                        ...plan,
                        phones: plan.phones.map((x) =>
                          x.id === p.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Extension
                  <input
                    inputMode="numeric"
                    maxLength={8}
                    value={p.extension}
                    onChange={(e) =>
                      update({
                        ...plan,
                        phones: plan.phones.map((x) =>
                          x.id === p.id ? { ...x, extension: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="rw-text-btn"
                  onClick={() =>
                    update({
                      ...plan,
                      phones: plan.phones.filter((x) => x.id !== p.id),
                      groups: plan.groups.map((g) => ({
                        ...g,
                        members: g.members.filter((id) => id !== p.id),
                      })),
                    })
                  }
                >
                  Remove from plan
                </button>
              </article>
            ))}
            {!plan.phones.length && (
              <p className="pp-empty">No phones added. No live inventory is being claimed.</p>
            )}
            <button
              className="rw-btn"
              disabled={plan.phones.length >= 40}
              onClick={() =>
                update({
                  ...plan,
                  phones: [...plan.phones, { id: crypto.randomUUID(), name: "", extension: "" }],
                })
              }
            >
              + Add phone
            </button>
          </section>
          <section className="pp-groups">
            {plan.groups.map((g) => (
              <article
                className="rw-panel pp-group"
                key={g.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && !uncertain)
                    update(
                      addPhoneToGroup(
                        plan,
                        e.dataTransfer.getData("application/openfolk-phone"),
                        g.id,
                      ),
                    );
                }}
              >
                <label>
                  Call group name
                  <input
                    maxLength={80}
                    value={g.name}
                    onChange={(e) =>
                      update({
                        ...plan,
                        groups: plan.groups.map((x) =>
                          x.id === g.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <p>
                  Drop phones here, or add one using the menu. A phone can belong to several groups.
                </p>
                <ol className="pp-members">
                  {g.members.map((id, index) => (
                    <li key={id}>
                      <span>
                        {plan.phones.find((p) => p.id === id)?.name || "Unnamed phone"} ·{" "}
                        {plan.phones.find((p) => p.id === id)?.extension}
                      </span>
                      <button
                        aria-label={`Move member ${index + 1} earlier in ${g.name || "group"}`}
                        disabled={index === 0}
                        onClick={() => {
                          const members = [...g.members];
                          [members[index - 1], members[index]] = [
                            members[index]!,
                            members[index - 1]!,
                          ];
                          update({
                            ...plan,
                            groups: plan.groups.map((x) => (x.id === g.id ? { ...x, members } : x)),
                          });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Remove member ${index + 1} from ${g.name || "group"}`}
                        onClick={() =>
                          update({
                            ...plan,
                            groups: plan.groups.map((x) =>
                              x.id === g.id
                                ? { ...x, members: x.members.filter((i) => i !== id) }
                                : x,
                            ),
                          })
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
                <label>
                  Add phone to {g.name || "group"}
                  <select
                    value=""
                    onChange={(e) => update(addPhoneToGroup(plan, e.target.value, g.id))}
                  >
                    <option value="">Choose a phone…</option>
                    {plan.phones
                      .filter((p) => !g.members.includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || "Unnamed"} · {p.extension}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="pp-two">
                  <label>
                    Ring pattern
                    <select
                      value={g.strategy}
                      onChange={(e) =>
                        update({
                          ...plan,
                          groups: plan.groups.map((x) =>
                            x.id === g.id
                              ? { ...x, strategy: e.target.value as "Together" | "In order" }
                              : x,
                          ),
                        })
                      }
                    >
                      <option>Together</option>
                      <option>In order</option>
                    </select>
                  </label>
                  <label>
                    Ring time (seconds)
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={g.seconds}
                      onChange={(e) =>
                        update({
                          ...plan,
                          groups: plan.groups.map((x) =>
                            x.id === g.id ? { ...x, seconds: Number(e.target.value) } : x,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  If nobody answers
                  <textarea
                    maxLength={300}
                    value={g.fallback}
                    placeholder="For example: send to the scheduling voicemail. OpenFolk will verify the destination."
                    onChange={(e) =>
                      update({
                        ...plan,
                        groups: plan.groups.map((x) =>
                          x.id === g.id ? { ...x, fallback: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="rw-text-btn"
                  onClick={() =>
                    update({ ...plan, groups: plan.groups.filter((x) => x.id !== g.id) })
                  }
                >
                  Remove group from proposal
                </button>
              </article>
            ))}
            <button
              className="rw-btn"
              disabled={plan.groups.length >= 12}
              onClick={() =>
                update({
                  ...plan,
                  groups: [
                    ...plan.groups,
                    {
                      id: crypto.randomUUID(),
                      name: "",
                      members: [],
                      strategy: "Together",
                      seconds: 25,
                      fallback: "",
                    },
                  ],
                })
              }
            >
              + Add call group
            </button>
          </section>
        </div>
        <section className="rw-panel pp-instructions">
          <label>
            Working hours, time zone & out-of-hours behaviour
            <textarea
              maxLength={500}
              value={plan.hours}
              placeholder="Include weekdays, hours, time zone and what should happen outside these hours."
              onChange={(e) => update({ ...plan, hours: e.target.value })}
            />
          </label>
          <label>
            What else should OpenFolk know?
            <textarea
              maxLength={1000}
              value={plan.notes}
              placeholder="Which incoming number should use these groups? Which existing settings must stay unchanged?"
              onChange={(e) => update({ ...plan, notes: e.target.value })}
            />
          </label>
          <p>
            Unlisted groups and routes must remain unchanged. OpenFolk will confirm extension
            identities, existing routes, emergency handling and provider support before applying any
            proposal.
          </p>
          <button className="rw-btn" onClick={reviewPlan}>
            Review my request →
          </button>
        </section>
      </fieldset>
      {review && (
        <section className="rw-panel pp-review">
          <h3>Review before sending</h3>
          <pre>{describePhonePlan(plan)}</pre>
          <p>
            This sends the proposal to OpenFolk, not to Birchills. It does not book a delivery date
            or agree a price.
          </p>
          <button
            className="rw-btn"
            disabled={busy || uncertain || (!demo && (!requests.isSuccess || requests.isFetching))}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Submit to OpenFolk"}
          </button>
        </section>
      )}
      {message && (
        <p role="status" className="pp-message">
          {message}
        </p>
      )}
      <section className="rw-panel">
        <h3>Request history</h3>
        <p>
          Saved requests and OpenFolk responses. A closed request is not an automatic
          live-configuration certificate. Check the response for application and test evidence.
        </p>
        {requests.isPending && !demo && <p>Loading saved requests…</p>}
        {requests.isError && (
          <p role="alert">
            {requests.error.message} <button onClick={() => void requests.refetch()}>Retry</button>
          </p>
        )}
        {uncertain && (
          <button
            onClick={async () => {
              const result = await requests.refetch();
              if (result.isSuccess) {
                setUncertain(false);
                setMessage(
                  "History refreshed. Check whether your request is already present before submitting again.",
                );
              }
            }}
          >
            Refresh history to check the save
          </button>
        )}
        {(requests.data ?? []).map((r) => (
          <details key={r.id} className="pp-history">
            <summary>
              {new Date(r.created_at).toLocaleString("en-GB")} · {r.status}
            </summary>
            <pre>{describePhonePlan(decodePhonePlan(r.body)!)}</pre>
            {r.response && <p className="pp-message">OpenFolk: {r.response}</p>}
            <button
              className="rw-text-btn"
              disabled={busy || uncertain || plan.phones.length > 0 || plan.groups.length > 0}
              onClick={() => update(decodePhonePlan(r.body)!)}
            >
              Copy as a new proposal
            </button>
          </details>
        ))}
        {((requests.isSuccess && !requests.data.length) || demo) && (
          <p>No saved phone plans{demo ? " in this preview" : " yet"}.</p>
        )}
        <p className="pp-footnote">
          OpenFolk manages requests in “Make Emma better”. Draft edits stay on this page until
          submitted; leaving the page discards them. No automated Birchills connection is enabled.
        </p>
      </section>
    </div>
  );
}
