import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone, Users, ArrowRight, MessageSquare, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

const referenceSchema = z.object({
  source: z.string(),
  note: z.string(),
  mainNumber: z.string(),
  routes: z.array(z.object({ title: z.string(), detail: z.string(), date: z.string() })),
  phones: z.array(
    z.object({ name: z.string(), extension: z.string(), role: z.string(), note: z.string() }),
  ),
  groups: z.array(
    z.object({ name: z.string(), number: z.string(), members: z.string(), fallback: z.string() }),
  ),
});

/** Reference evidence is tenant-scoped server data, never a fabricated live PBX snapshot. */
export function PhoneSetupOverview({ tenant, demo }: { tenant: string; demo: boolean }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const reference = useQuery({
    queryKey: ["phone-reference", user?.id, tenant],
    enabled: !!user && !demo,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("receptionist_workspaces")
        .select("phone_reference")
        .eq("tenant_id", tenant)
        .single();
      if (error) throw Error("The saved phone directory could not be loaded.");
      return data.phone_reference ? referenceSchema.parse(data.phone_reference) : null;
    },
  });
  async function submit() {
    if (!request.trim() || busy || uncertain || sent || demo) return;
    setBusy(true);
    setMessage("");
    setUncertain(true);
    try {
      const { error } = await getSupabaseClient()
        .from("receptionist_feedback")
        .insert({
          tenant_id: tenant,
          category: "routing",
          priority: "normal",
          title: "Phone system · change request",
          body: `Requested Birchills change — review and approval required. No provider settings have been changed.\n\n${request.trim()}`,
        });
      if (error) throw error;
      setSent(true);
      setUncertain(false);
      setMessage(
        "Request saved. OpenFolk will review it and confirm the next step. Your phone setup has not changed.",
      );
      await Promise.all(
        ["phone-plan-requests", "receptionist-feedback"].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch {
      setMessage(
        "We could not confirm delivery. Check Changes & updates below before sending again; your text is kept here.",
      );
    } finally {
      setBusy(false);
    }
  }
  const setup = reference.data;
  return (
    <>
      {reference.isPending && !demo && <p role="status">Opening your phone directory…</p>}
      {reference.isError && (
        <p role="alert">
          {reference.error.message} <button onClick={() => void reference.refetch()}>Retry</button>
        </p>
      )}
      {setup && (
        <>
          <section className="rw-panel ps-summary">
            <div>
              <span className="ps-eyebrow">YOUR MAIN NUMBER</span>
              <h3>{setup.mainNumber}</h3>
              <p>Your people. Your call routes. One clear view.</p>
            </div>
            <span className="ps-badge">Documented setup · confirmation pending</span>
            <p className="ps-source">{setup.note}</p>
          </section>
          <section className="rw-panel" aria-labelledby="phone-route-title">
            <div className="ps-heading">
              <Phone size={22} />
              <div>
                <h3 id="phone-route-title">How a call reaches your team</h3>
                <p>Follow the recorded route, from the first ring to the fallback.</p>
              </div>
            </div>
            <div className="ps-route-grid">
              {setup.routes.map((route, i) => (
                <article className="ps-route" key={route.title}>
                  <span className="ps-step">{i + 1}</span>
                  <h4>{route.title}</h4>
                  <p>{route.detail}</p>
                  <small>{route.date}</small>
                </article>
              ))}
            </div>
          </section>
          <section className="rw-panel" aria-labelledby="phone-people-title">
            <div className="ps-heading">
              <Users size={22} />
              <div>
                <h3 id="phone-people-title">People & extensions</h3>
                <p>Choose a person to request a change. Their current settings stay protected.</p>
              </div>
            </div>
            <div className="ps-people">
              {setup.phones.map((phone) => (
                <article className="ps-person" key={phone.extension}>
                  <div className="ps-person-top">
                    <span className="ps-avatar">{phone.name[0]}</span>
                    <div>
                      <h4>{phone.name}</h4>
                      <span>{phone.role}</span>
                    </div>
                    <strong className="ps-extension">{phone.extension}</strong>
                  </div>
                  <p>{phone.note}</p>
                  <button
                    className="rw-text-btn"
                    disabled={busy || uncertain || sent}
                    onClick={() => {
                      setRequest(`For ${phone.name}, extension ${phone.extension}: `);
                      document.getElementById("phone-change-request")?.focus();
                    }}
                  >
                    Request a change <ArrowRight size={14} />
                  </button>
                </article>
              ))}
            </div>
          </section>
          <section className="rw-panel" aria-labelledby="phone-groups-title">
            <div className="ps-heading">
              <Users size={22} />
              <div>
                <h3 id="phone-groups-title">Ring groups & queues</h3>
                <p>
                  Membership from the 29 July provider record. Current order and timings need a
                  fresh check.
                </p>
              </div>
            </div>
            <div className="ps-route-grid">
              {setup.groups.map((group) => (
                <article className="ps-route" key={group.number}>
                  <span className="ps-badge">{group.number}</span>
                  <h4>{group.name}</h4>
                  <p>{group.members}</p>
                  <div className="ps-fallback">{group.fallback}</div>
                </article>
              ))}
            </div>
            <details className="ps-evidence">
              <summary>Source notes & items to confirm</summary>
              <p>{setup.source}</p>
              <p>
                The 22 September DH handover describes Mary ringing for 10 seconds, then Julie, Liz
                and Rudi for 15 seconds, then shared voicemail. This differs from the older IVR
                entry record. OpenFolk must check the provider before either is treated as today's
                confirmed main-line route.
              </p>
              <p>
                Group 305 and queue 402 were empty in July. Queue 402 had a 300-second hold and no
                timeout destination; neither is presented here as an active route. Current opening
                hours, holiday schedules, ring strategy and device registration still need checking.
              </p>
            </details>
          </section>
        </>
      )}
      {!setup && reference.isSuccess && (
        <section className="rw-panel">
          <h3>Your directory is being prepared</h3>
          <p>
            OpenFolk will add the confirmed people, extensions and routes here. You can still
            request a change below.
          </p>
        </section>
      )}
      <section className="rw-panel ps-request">
        <div className="ps-heading">
          <MessageSquare size={22} />
          <div>
            <h3>Want something changed?</h3>
            <p>Tell us the outcome. OpenFolk handles the phone settings.</p>
          </div>
        </div>
        <div className="ps-process">
          <span>1 · You request</span>
          <span>2 · OpenFolk approves</span>
          <span>3 · Apply & check</span>
          <span>4 · Your view updates</span>
        </div>
        <label htmlFor="phone-change-request">What would you like to change?</label>
        <textarea
          id="phone-change-request"
          placeholder="For example: add Heidi to the office ring group, or change the name on an extension."
          value={request}
          maxLength={4000}
          disabled={busy || uncertain || sent || demo}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="ps-request-footer">
          <button
            className="rw-btn"
            onClick={() => void submit()}
            disabled={!request.trim() || busy || uncertain || sent || demo}
          >
            {busy ? "Saving…" : sent ? "Request saved" : "Send to OpenFolk"}
          </button>
          <span>
            <ShieldCheck size={16} /> Requests do not change live routing.
          </span>
        </div>
        {message && (
          <p role="status" className="pp-message">
            {message}
          </p>
        )}
        {sent && (
          <button
            className="rw-text-btn"
            onClick={() => {
              setSent(false);
              setRequest("");
              setMessage("");
            }}
          >
            Start another request
          </button>
        )}
      </section>
    </>
  );
}
