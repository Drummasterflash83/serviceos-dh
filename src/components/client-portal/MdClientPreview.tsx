import { useEffect, useState } from "react";
import { BookOpen, BriefcaseBusiness, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { ClientHeaderBrand } from "@/components/ClientHeaderBrand";
import { drummondsTenantId, readMdViewReceipt, type MdViewReceipt } from "@/lib/new-dawn-md-view";
import { OpenJobHome } from "./OpenJobHome";
import { LearnDailyStats } from "./learn/LearnDailyStats";
import "@/styles/client-workspace.css";
import "@/styles/md-client-preview.css";

type Review = MdViewReceipt & { reason: string };

/** Chris sees the client presentation without receiving a Drummonds staff
 * profile. Every source read is still authorised and audited as OpenFolk. */
export function MdClientPreview() {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [section, setSection] = useState<"home" | "learn">("home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setReview(null); setSection("home"); setReason(""); }, [user?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  const active = review && review.actorId === user?.id && Date.parse(review.expiresAt) > now
    ? review : null;

  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (!user || busy || reason.trim().length < 3 || reason.trim().length > 500) return;
    setBusy(true); setError("");
    try {
      const selectedReason = reason.trim();
      const { data, error: failure } = await getSupabaseClient().rpc(
        "new_dawn_drummonds_md_view_open",
        { p_tenant: drummondsTenantId, p_reason: selectedReason },
      ).abortSignal(AbortSignal.timeout(15_000));
      if (failure) throw Error("MD preview access unavailable");
      const receipt = readMdViewReceipt(data, user.id);
      setReview({ ...receipt, reason: selectedReason });
      setNow(Date.now());
    } catch { setError("This read-only MD view could not be opened. Check your OpenFolk access and try again."); }
    finally { setBusy(false); }
  }

  return <div className="md-review-shell">
    <aside className="md-review-sidebar">
      <div className="md-review-brand"><ClientHeaderBrand company="Drummonds" /></div>
      <span className="md-review-badge"><ShieldCheck size={16} /> Read-only MD view</span>
      {active && <nav aria-label="MD review pages">
        <button aria-current={section === "home" ? "page" : undefined}
          onClick={() => setSection("home")}><BriefcaseBusiness size={17} /> Home</button>
        <button aria-current={section === "learn" ? "page" : undefined}
          onClick={() => setSection("learn")}><BookOpen size={17} /> LEARN stats</button>
      </nav>}
      <a className="md-review-return" href="/openfolk/drummonds?module=home&tools=false">
        Return to OpenFolk
      </a>
    </aside>
    <main className="md-review-main">
      <header className="md-review-topbar">
        <span>Drummonds / {section === "home" ? "Home" : "LEARN"}</span>
        <span>{user?.email ?? "OpenFolk"}</span>
      </header>
      <div className="md-review-content">
        {!active ? <section className="md-review-gate" aria-label="Open Drummonds MD view">
          <p className="of-eyebrow">OPENFOLK · CLIENT PRESENTATION</p>
          <h1>View as Drummonds MD</h1>
          <p>Review the same client-facing work as an MD, without enabling a Drummonds staff login. This presentation is read-only; your OpenFolk identity and every source read are logged.</p>
          <form onSubmit={open}>
            <label htmlFor="md-review-reason">Reason for reviewing Drummonds</label>
            <input id="md-review-reason" value={reason} maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Review today's client experience" />
            <button className="cp-primary" disabled={!user || busy || reason.trim().length < 3}>
              {busy ? "Checking access…" : "Open read-only MD view"}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </section> : <>
          <div className="md-review-notice" role="status">
            OpenFolk read-only presentation · Access logged · Expires {new Date(active.expiresAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })} UK
            <button type="button" onClick={() => { setReview(null); setSection("home"); }}>Leave view</button>
          </div>
          {section === "home" ? <>
            <div className="md-review-heading"><p className="of-eyebrow">DRUMMONDS</p>
              <h1>Your business, in view.</h1><p>Start with the work that may need attention today.</p></div>
            <OpenJobHome key={`${active.auditId}:home`} tenant={drummondsTenantId}
              company="Drummonds" operator mdReason={active.reason} />
          </> : <>
            <div className="md-review-heading"><p className="of-eyebrow">DRUMMONDS · LEARN</p>
              <h1>What arrived today.</h1><p>Real saved inputs, with a time and source for each count.</p></div>
            <LearnDailyStats key={`${active.auditId}:learn`} tenantId={drummondsTenantId}
              operator mdReason={active.reason} />
          </>}
        </>}
      </div>
    </main>
  </div>;
}
