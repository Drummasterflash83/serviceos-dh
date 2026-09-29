import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  ArrowRight,
  LayoutDashboard,
  Layers,
  MessageSquare,
  LogOut,
  Plus,
  Pencil,
  Check,
  Printer,
  ChevronDown,
  ShieldCheck,
  Receipt,
  X,
  Headphones,
  Bell,
  Menu,
  X as CloseIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ClientHeaderBrand } from "@/components/ClientHeaderBrand";
import { clientDisplayName } from "@/lib/client-brand";
import { OpenFolkAdminLink } from "@/components/OpenFolkAdminLink";
import { WorkspaceHome } from "./WorkspaceHome";
import { receptionistNavigation } from "@/components/receptionist/ReceptionistNavigation";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import {
  receptionistView,
  resolveClientSection,
  selectedWorkspace,
  type ClientSection,
  type ClientSectionInput,
  type ReceptionistView,
} from "@/lib/client-workspace-nav";
import "@/styles/client-investment.css";
import "@/styles/client-workspace.css";
import { getSupabaseClient } from "@/lib/supabase";
import {
  programmeSchema,
  outcomeSchema,
  money,
  pricedSubtotal,
  newOutcome,
  packageStatus,
  systemStatus,
  type Programme,
  type ProgrammeRow,
  type OutcomePackage,
  type ProgrammeNote,
} from "@/lib/client-portal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const ReceptionistWorkspace = lazy(() =>
  import("@/components/receptionist/ReceptionistWorkspace").then((module) => ({
    default: module.ReceptionistWorkspace,
  })),
);
const ClientInvestment = lazy(() =>
  import("./ClientInvestment").then((module) => ({ default: module.ClientInvestment })),
);
const ClientDeliverySummary = lazy(() =>
  import("./ClientDeliverySummary").then((module) => ({ default: module.ClientDeliverySummary })),
);
const ClientNotifications = lazy(() =>
  import("./ClientNotifications").then((m) => ({ default: m.ClientNotifications })),
);
const nav = [
  { id: "home", label: "Workspace home", Icon: LayoutDashboard },
  { id: "receptionist", label: "AI Receptionist", Icon: Headphones },
  { id: "modules", label: "Modules", Icon: Layers },
  { id: "invoices", label: "Invoices", Icon: Receipt },
  { id: "notes", label: "Review & feedback", Icon: MessageSquare },
  { id: "notifications", label: "Notifications", Icon: Bell },
] as const;
function Status({ children }: { children: ReactNode }) {
  return (
    <span
      className={`cp-status ${children === "Delivered" || children === "Operational" ? "cp-status-good" : ""}`}
    >
      {children}
    </span>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="cp-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cp-detail">
      <dt>{label}</dt>
      <dd>{children || "To agree"}</dd>
    </div>
  );
}
function date(value: string) {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ClientPortal({
  tenantId,
  section: requestedSection = "home",
  receptionistPage = "today",
  operatorEmbedded = false,
}: {
  tenantId?: string;
  section?: ClientSectionInput;
  receptionistPage?: ReceptionistView;
  operatorEmbedded?: boolean;
}) {
  const section = resolveClientSection(requestedSection);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [operatorTools, setOperatorTools] = useState(false);
  const [healthFeedbackId, setHealthFeedbackId] = useState<string | undefined>();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [receptionistMenuOpen, setReceptionistMenuOpen] = useState(section === "receptionist");
  const receptionistExpanded = section === "receptionist" && receptionistMenuOpen;
  useEffect(() => {
    setReceptionistMenuOpen(section === "receptionist");
  }, [section, tenantId]);
  const pull = usePullToRefresh(() => qc.refetchQueries({ type: "active" }), !mobileMenuOpen);
  function setSection(next: ClientSection) {
    setMobileMenuOpen(false);
    void navigate({ to: "/client", search: { tenant: tenantId ?? tenant, section: next } });
  }
  function openReceptionist(view: ReceptionistView) {
    setMobileMenuOpen(false);
    void navigate({
      to: "/client",
      search: { tenant: tenantId ?? tenant, section: "receptionist", view },
    });
  }
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [section, receptionistPage, tenantId]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [mobileMenuOpen]);
  const [editing, setEditing] = useState<OutcomePackage | null>(null);
  const [settings, setSettings] = useState(false);
  const [editorVersion, setEditorVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const db = getSupabaseClient();
  const programmes = useQuery({
    queryKey: ["client-programmes", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db
        .from("client_programmes")
        .select("tenant_id,content,version,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw new Error("Your workspace could not be loaded. Please try again.");
      return (data ?? []).map((row) => ({
        ...row,
        content: programmeSchema.parse(row.content),
      })) as ProgrammeRow[];
    },
  });
  const operator = useQuery({
    queryKey: ["client-programme-editor", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await db.rpc("current_user_is_openfolk_operator", {
        required_permission: "platform.controlplane.admin",
      });
      return !error && data === true;
    },
  });
  const row = selectedWorkspace(programmes.data, tenantId);
  // Existing receptionist-only accounts keep their authorised access when old
  // /receptionist links enter the shared shell; a programme is not an access grant.
  const receptionistAccess = useQuery({
    queryKey: ["client-receptionist-access", user?.id],
    enabled: !!user && section === "receptionist" && !row,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_workspaces")
        .select("tenant_id,company")
        .order("company");
      if (error) throw Error("Your receptionist workspace could not be loaded.");
      return data ?? [];
    },
  });
  const receptionistWorkspace =
    section === "receptionist"
      ? selectedWorkspace(receptionistAccess.data, tenantId ?? row?.tenant_id)
      : undefined;
  const tenant = row?.tenant_id ?? receptionistWorkspace?.tenant_id;
  const notes = useQuery({
    queryKey: ["client-programme-notes", user?.id, tenant],
    enabled: !!user && !!tenant && section === "notes",
    queryFn: async () => {
      const { data, error } = await db
        .from("client_programme_notes")
        .select("id,author_id,body,created_at")
        .eq("tenant_id", tenant!)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error("Feedback could not be loaded. Please try again.");
      return (data ?? []) as ProgrammeNote[];
    },
  });
  useEffect(() => {
    setOperatorTools(false);
    setNotice("");
    setError("");
    setNote("");
    setEditing(null);
    setSettings(false);
  }, [tenant]);

  async function save(content: Programme) {
    if (!row || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const valid = programmeSchema.parse(content);
      const { data, error } = await db
        .from("client_programmes")
        .update({ content: valid })
        .eq("tenant_id", row.tenant_id)
        .eq("version", editorVersion ?? row.version)
        .select("version");
      if (error) throw new Error("The update was not saved. Please try again.");
      if (!data?.length)
        throw new Error(
          "This workspace changed, or your editing access changed. Reload it before saving. Your edits are still here.",
        );
      await qc.invalidateQueries({ queryKey: ["client-programmes", user?.id] });
      setEditing(null);
      setSettings(false);
      setNotice("Modules updated. Your client can see this version.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The update was not saved.");
    } finally {
      setSaving(false);
    }
  }
  async function postNote(e: FormEvent) {
    e.preventDefault();
    if (!tenant || !note.trim() || posting) return;
    setPosting(true);
    setError("");
    setNotice("");
    try {
      const { error } = await db
        .from("client_programme_notes")
        .insert({ tenant_id: tenant, body: note.trim() });
      if (error) throw new Error("Your feedback was not saved. Please try again.");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["client-programme-notes", user?.id, tenant] });
      setNotice("Feedback saved for OpenFolk to review.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your feedback was not saved.");
    } finally {
      setPosting(false);
    }
  }
  const p = row?.content;
  const company = p?.company ?? receptionistWorkspace?.company ?? "Your workspace";
  const admin = operator.data === true && (operatorTools || operatorEmbedded);
  const receptionistContent = tenant ? (
    <Suspense fallback={<div className="rw-loading">Opening your receptionist…</div>}>
      <ReceptionistWorkspace
        key={tenant}
        tenantId={tenant}
        embedded
        initialView={receptionistPage}
        onViewChange={openReceptionist}
        initialFeedbackId={healthFeedbackId}
      />
    </Suspense>
  ) : (
    <div className="cp-empty" role="status">
      <h1>
        {receptionistAccess.isPending
          ? "Opening your receptionist…"
          : "Your receptionist workspace"}
      </h1>
      <p>
        {receptionistAccess.error?.message ??
          (!receptionistAccess.isPending
            ? "A receptionist has not been assigned to this workspace yet."
            : "")}
      </p>
      {receptionistAccess.isError && (
        <button className="cp-primary" onClick={() => void receptionistAccess.refetch()}>
          Try again
        </button>
      )}
    </div>
  );
  const content = !p ? (
    <div className="cp-empty">
      <Layers size={30} />
      <h1>
        {programmes.isPending
          ? "Loading your workspace…"
          : programmes.isError
            ? "We couldn’t load your workspace"
            : "Your workspace is being prepared."}
      </h1>
      <p>
        {programmes.isError
          ? "Please try again. If the problem continues, contact OpenFolk."
          : !programmes.isPending
            ? "Your login is secure. OpenFolk will link your workspace to this account."
            : ""}
      </p>
      {programmes.isError && (
        <button className="cp-primary" onClick={() => programmes.refetch()}>
          Try again
        </button>
      )}
      <a href="mailto:chris@openfolk.ai">
        Contact OpenFolk <ArrowUpRight size={14} />
      </a>
    </div>
  ) : (
    <>
      <div className="cp-page-heading">
        <div>
          <p className="of-eyebrow">
            {operatorEmbedded ? "SHARED CLIENT RECORD" : "YOUR WORKSPACE"}
          </p>
          <h1>
            {section === "home"
              ? clientDisplayName(p.company)
              : nav.find((n) => n.id === section)?.label}
          </h1>
          <p>
            {section === "home"
              ? "Your business, in view. Start with what matters today."
              : section === "modules"
                ? "Your modules. Clear scope, progress and agreed results."
                : section === "invoices"
                  ? "What you’ve paid, what it delivered and your invoices to download."
                  : section === "notifications"
                    ? "Choose how your team hears from OpenFolk."
                    : "Tell OpenFolk what would make your business work better."}
          </p>
        </div>
        <div className="cp-heading-actions">
          {admin && (
            <button
              className="cp-secondary"
              onClick={() => {
                setError("");
                setEditorVersion(row.version);
                setSettings(true);
              }}
            >
              <Pencil size={14} />
              Edit workspace details
            </button>
          )}
          <button
            className="cp-icon-button"
            aria-label="Print this view"
            onClick={() => window.print()}
          >
            <Printer size={17} />
          </button>
        </div>
      </div>
      <div aria-live="polite">
        {notice && (
          <div className="cp-notice">
            <Check size={16} />
            {notice}
          </div>
        )}
      </div>
      {error && !editing && !settings && (
        <div role="alert" className="cp-error">
          {error}
        </div>
      )}
      {section === "invoices" && tenant && user && (
        <Suspense fallback={<p role="status">Opening invoices…</p>}>
          <ClientInvestment tenant={tenant} userId={user.id} showDelivery={false} />
        </Suspense>
      )}
      {section === "notifications" && tenant && user && (
        <Suspense fallback={<p role="status">Opening notifications…</p>}>
          <ClientNotifications tenant={tenant} userId={user.id} />
        </Suspense>
      )}
      {section === "home" && tenant && user && (
        <WorkspaceHome
          tenant={tenant}
          userId={user.id}
          company={clientDisplayName(p.company)}
          open={setSection}
          openFeedback={(issue) => {
            setHealthFeedbackId(issue?.feedback_id ?? undefined);
            openReceptionist("improvements");
          }}
        />
      )}
      {section === "modules" && (
        <>
          {!operatorEmbedded && tenant && user && (
            <Suspense fallback={<p role="status">Opening module progress…</p>}>
              <ClientDeliverySummary tenant={tenant} userId={user.id} />
            </Suspense>
          )}
          <div className="cp-investment">
            <div>
              <p className="of-eyebrow">PROPOSED INVESTMENT</p>
              <h2>Pay for a defined result.</h2>
              <p>
                Every package has its own scope and success criteria. Optional additions are
                excluded from the module subtotal. Prices shown are proposed until agreed in
                writing.
              </p>
            </div>
            {(["setup", "monthly"] as const).map((field) => {
              const s = pricedSubtotal(p.outcomes, field);
              return (
                <div className="cp-price-summary" key={field}>
                  <span>{field === "setup" ? "One-off modules" : "Ongoing monthly"}</span>
                  <strong>
                    {s.count === 0
                      ? "Not scoped"
                      : s.pending === s.count
                        ? "To be agreed"
                        : money(s.amount)}
                  </strong>
                  <small>
                    {s.pending > 0
                      ? `${s.pending} package${s.pending === 1 ? "" : "s"} awaiting pricing${s.pending < s.count ? " · subtotal incomplete" : ""}`
                      : "Proposed subtotal"}{" "}
                    · GBP
                  </small>
                </div>
              );
            })}
          </div>
          <div className="cp-section-title">
            <h2>Your modules</h2>
            {admin && (
              <button
                className="cp-secondary"
                onClick={() => {
                  setError("");
                  setEditorVersion(row.version);
                  setEditing({ ...newOutcome(), optional: false });
                }}
              >
                <Plus size={14} />
                Add module
              </button>
            )}
          </div>
          {p.outcomes
            .filter((o) => !o.optional)
            .map((o, i) => (
              <OutcomeCard
                key={o.id}
                outcome={o}
                index={i}
                edit={
                  admin
                    ? () => {
                        setError("");
                        setEditorVersion(row.version);
                        setEditing(o);
                      }
                    : undefined
                }
              />
            ))}
          <div className="cp-section-title">
            <div>
              <h2>Build on your foundation</h2>
              <p>Optional modules to add when the business is ready.</p>
            </div>
            {admin && (
              <button
                className="cp-secondary"
                onClick={() => {
                  setError("");
                  setEditorVersion(row.version);
                  setEditing(newOutcome());
                }}
              >
                <Plus size={14} />
                Add opportunity
              </button>
            )}
          </div>
          {p.outcomes
            .filter((o) => o.optional)
            .map((o, i) => (
              <OutcomeCard
                key={o.id}
                outcome={o}
                index={i}
                edit={
                  admin
                    ? () => {
                        setError("");
                        setEditorVersion(row.version);
                        setEditing(o);
                      }
                    : undefined
                }
              />
            ))}
          <p className="cp-footnote">
            {p.commercialNote} Tax treatment, third-party charges, payment milestones and any
            result-linked fees must be agreed in the final quotation. This page does not accept a
            contract or authorise implementation.
          </p>
        </>
      )}
      {section === "notes" && (
        <>
          <section className="cp-card">
            <h2>What would you like to improve?</h2>
            <p>
              Ask a question, share an idea or flag something that needs attention. Your notes stay
              here for you, your authorised team and OpenFolk.
            </p>
            <form onSubmit={postNote} className="cp-note-form">
              <label htmlFor="programme-note">Your feedback or findings</label>
              <textarea
                id="programme-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={10000}
                rows={6}
                placeholder="What should we know or focus on next?"
                required
              />
              <div>
                <span>{note.length.toLocaleString()} / 10,000 · Saved here, no email sent</span>
                <button className="cp-primary" disabled={posting || !note.trim()}>
                  {posting ? "Saving…" : "Save feedback"}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </form>
          </section>
          <h2 className="cp-section-title">Your feedback</h2>
          {notes.isError ? (
            <div role="alert" className="cp-error">
              Feedback could not be loaded.{" "}
              <button onClick={() => notes.refetch()}>Try again</button>
            </div>
          ) : notes.isPending ? (
            <p className="cp-footnote">Loading feedback…</p>
          ) : notes.data?.length ? (
            notes.data.map((n) => (
              <article className="cp-card cp-note" key={n.id}>
                <div>
                  <strong>{n.author_id === user?.id ? "You" : "Workspace member"}</strong>
                  <time dateTime={n.created_at}>{date(n.created_at)}</time>
                </div>
                <p>{n.body}</p>
              </article>
            ))
          ) : (
            <p className="cp-footnote">No feedback yet. Your first note will appear here.</p>
          )}
        </>
      )}
      <footer className="cp-content-footer">
        <span>{clientDisplayName(p.company)}</span>
        <span>
          Workspace version {row.version} · Updated {date(row.updated_at)}
        </span>
      </footer>
      {editing && (
        <OutcomeEditor
          outcome={editing}
          busy={saving}
          error={error}
          onClose={() => {
            if (!saving) setEditing(null);
          }}
          onSave={(o) =>
            save({
              ...p,
              outcomes: p.outcomes.some((x) => x.id === o.id)
                ? p.outcomes.map((x) => (x.id === o.id ? o : x))
                : [...p.outcomes, o],
            })
          }
        />
      )}
      {settings && (
        <ProgrammeEditor
          programme={p}
          busy={saving}
          error={error}
          onClose={() => {
            if (!saving) setSettings(false);
          }}
          onSave={save}
        />
      )}
    </>
  );
  if (operatorEmbedded) return <div className="cp-root op-embedded">{content}</div>;
  return (
    <div className={`cp-root ${section === "home" ? "cp-home-section" : ""}`}>
      <a href="#client-main" className="of-skip">
        Skip to workspace
      </a>
      <aside className={`cp-sidebar ${mobileMenuOpen ? "is-mobile-open" : ""}`}>
        <Link
          to="/client"
          search={{ tenant: tenantId ?? tenant, section: "home" }}
          className="of-wordmark"
          aria-label={`${clientDisplayName(company)} — workspace home`}
        >
          <ClientHeaderBrand company={company} />
        </Link>
        <button
          type="button"
          className="of-mobile-menu-toggle"
          aria-label={mobileMenuOpen ? "Close workspace menu" : "Open workspace menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="client-mobile-navigation"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <CloseIcon size={23} /> : <Menu size={23} />}
        </button>
        <div id="client-mobile-navigation" className="cp-mobile-menu-panel">
          <p className="of-mobile-company">Your Workspace</p>
          {(programmes.data?.length ?? 0) > 1 && (
            <label className="cp-field">
              <span>Client workspace</span>
              <select
                aria-label="Client workspace"
                value={tenant ?? ""}
                onChange={(e) =>
                  void navigate({
                    to: "/client",
                    search: { tenant: e.target.value, section: "home" },
                  })
                }
              >
                {programmes.data?.map((r) => (
                  <option value={r.tenant_id} key={r.tenant_id}>
                    {r.content.company}
                  </option>
                ))}
              </select>
            </label>
          )}
          <nav aria-label="Client workspace">
            {nav.map(({ id, label, Icon }) => (
              <Fragment key={id}>
                <button
                  className={section === id ? "is-active" : ""}
                  aria-current={section === id ? "page" : undefined}
                  aria-expanded={id === "receptionist" ? receptionistExpanded : undefined}
                  aria-controls={id === "receptionist" ? "client-receptionist-pages" : undefined}
                  onClick={() => {
                    if (id === "receptionist" && section === "receptionist") {
                      setReceptionistMenuOpen((open) => !open);
                      return;
                    }
                    setSection(id);
                    setNotice("");
                    setError("");
                  }}
                >
                  <Icon size={17} />
                  {label}
                  {id === "receptionist" && (
                    <ChevronDown
                      size={14}
                      className={receptionistExpanded ? "cp-nav-chevron is-open" : "cp-nav-chevron"}
                    />
                  )}
                </button>
                {id === "receptionist" && receptionistExpanded && (
                  <div
                    id="client-receptionist-pages"
                    className="cp-receptionist-nav"
                    aria-label="AI Receptionist pages"
                  >
                    {receptionistNavigation.map(({ id: page, label: title }) => (
                      <button
                        key={page}
                        type="button"
                        className={receptionistView(receptionistPage) === page ? "is-current" : ""}
                        aria-current={
                          receptionistView(receptionistPage) === page ? "page" : undefined
                        }
                        onClick={() => openReceptionist(page)}
                      >
                        {title}
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            ))}
          </nav>
          <div className="cp-sidebar-bottom">
            <div className="cp-private">
              <ShieldCheck size={16} />
              Private client workspace
            </div>
            <a href="mailto:chris@openfolk.ai">
              Your OpenFolk contact <ArrowUpRight size={14} />
            </a>
            {operator.data === true && (
              <div className="cp-operator-controls">
                <button
                  aria-pressed={operatorTools}
                  onClick={() => setOperatorTools(!operatorTools)}
                >
                  {operatorTools ? "Return to client view" : "OpenFolk editing tools"}
                </button>
              </div>
            )}
            <OpenFolkAdminLink email={user?.email} authorised={operator.data} />
            <button
              onClick={async () => {
                await signOut();
                qc.removeQueries({ queryKey: ["client-programmes"] });
                qc.removeQueries({ queryKey: ["client-programme-notes"] });
              }}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="cp-main">
        <div className="of-pull-status" role="status" aria-live="polite">
          {pull.refreshing
            ? "Updating workspace…"
            : pull.ready
              ? "Release to refresh"
              : pull.distance > 0
                ? "Pull to refresh"
                : ""}
        </div>
        <header className="cp-topbar">
          <Link
            className="cp-home-breadcrumb"
            to="/client"
            search={{ tenant: tenantId ?? tenant, section: "home" }}
          >
            {clientDisplayName(company)} <span>/</span> {nav.find((n) => n.id === section)?.label}
          </Link>
          <span className="cp-user">{user?.email}</span>
        </header>
        <main
          id="client-main"
          className={`cp-content${section === "receptionist" ? " cp-receptionist-content" : ""}`}
        >
          {section === "receptionist" ? receptionistContent : content}
        </main>
      </div>
    </div>
  );
}

function OutcomeCard({
  outcome: o,
  index,
  edit,
}: {
  outcome: OutcomePackage;
  index: number;
  edit?: () => void;
}) {
  return (
    <article className="cp-card cp-outcome">
      <div className="cp-outcome-heading">
        <span className="cp-package-number">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <div className="cp-package-meta">
            <Status>{o.status}</Status>
            {o.optional && <span>Optional addition</span>}
          </div>
          <h3>{o.title}</h3>
          <p>{o.outcome}</p>
        </div>
        {edit && (
          <button className="cp-icon-button" aria-label={`Edit ${o.title}`} onClick={edit}>
            <Pencil size={16} />
          </button>
        )}
      </div>
      <div className="cp-outcome-bottom">
        <div>
          <span>One-off investment</span>
          <strong>{money(o.setup)}</strong>
        </div>
        <div>
          <span>Monthly support</span>
          <strong>{money(o.monthly)}</strong>
        </div>
        <div>
          <span>Delivery window</span>
          <strong>{o.timing || "To agree"}</strong>
        </div>
      </div>
      <details>
        <summary>
          Scope & success criteria <ChevronDown size={15} />
        </summary>
        <dl className="cp-outcome-details">
          <Detail label="What we deliver">{o.scope}</Detail>
          <Detail label="Success measure">{o.measure}</Detail>
          <Detail label="Starting point">{o.baseline}</Detail>
          <Detail label="Target result">{o.target}</Detail>
          <Detail label="Dependencies">{o.dependencies}</Detail>
          <Detail label="Completion criteria">{o.acceptance}</Detail>
        </dl>
      </details>
    </article>
  );
}
function OutcomeEditor({
  outcome,
  busy,
  error,
  onClose,
  onSave,
}: {
  outcome: OutcomePackage;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (o: OutcomePackage) => void;
}) {
  const [value, setValue] = useState(outcome);
  const [validation, setValidation] = useState("");
  const update = (key: keyof OutcomePackage, v: unknown) =>
    setValue((prev) => ({ ...prev, [key]: v }));
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = outcomeSchema.safeParse(value);
    if (!result.success) {
      setValidation("Check all fields and use positive amounts, or leave prices blank.");
      return;
    }
    onSave(result.data);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="cp-dialog">
        <DialogHeader>
          <DialogTitle>Edit outcome package</DialogTitle>
          <DialogDescription>
            Saving updates the client’s modules. Leave prices blank until scoped.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="cp-edit-form">
          <Field label="Package name">
            <input required value={value.title} onChange={(e) => update("title", e.target.value)} />
          </Field>
          {(
            [
              "outcome",
              "scope",
              "measure",
              "baseline",
              "target",
              "dependencies",
              "acceptance",
            ] as const
          ).map((key) => (
            <Field
              key={key}
              label={
                {
                  outcome: "Business result",
                  scope: "Deliverables",
                  measure: "Success measure",
                  baseline: "Starting point",
                  target: "Target result",
                  dependencies: "Dependencies",
                  acceptance: "Completion criteria",
                }[key]
              }
            >
              <textarea rows={2} value={value[key]} onChange={(e) => update(key, e.target.value)} />
            </Field>
          ))}
          <div className="cp-form-grid">
            <Field label="Status">
              <select value={value.status} onChange={(e) => update("status", e.target.value)}>
                {packageStatus.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Delivery window">
              <input value={value.timing} onChange={(e) => update("timing", e.target.value)} />
            </Field>
            {(["setup", "monthly"] as const).map((key) => (
              <Field
                key={key}
                label={key === "setup" ? "One-off investment (£)" : "Monthly support (£)"}
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max="1000000000"
                  value={value[key] ?? ""}
                  placeholder="To be agreed"
                  onChange={(e) =>
                    update(key, e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </Field>
            ))}
          </div>
          <label className="cp-checkbox">
            <input
              type="checkbox"
              checked={value.optional}
              onChange={(e) => update("optional", e.target.checked)}
            />
            Optional addition (excluded from module subtotal)
          </label>
          {(error || validation) && (
            <p role="alert" className="cp-error">
              {error || validation}
            </p>
          )}
          <div className="cp-form-actions">
            <button type="button" className="cp-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="cp-primary" disabled={busy}>
              {busy ? "Saving…" : "Save package"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function ProgrammeEditor({
  programme,
  busy,
  error,
  onClose,
  onSave,
}: {
  programme: Programme;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (p: Programme) => void;
}) {
  const [value, setValue] = useState(() => structuredClone(programme));
  const [validation, setValidation] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = programmeSchema.safeParse(value);
    if (!result.success) {
      setValidation(result.error.issues.map((i) => i.message).join(". "));
      return;
    }
    onSave(result.data);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="cp-dialog">
        <DialogHeader>
          <DialogTitle>Edit workspace details</DialogTitle>
          <DialogDescription>
            Saved details are shared with this workspace’s authorised client members.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="cp-edit-form">
          {(["company", "title", "objective", "nextStep", "commercialNote"] as const).map((key) => (
            <Field
              key={key}
              label={
                {
                  company: "Company name",
                  title: "Programme title",
                  objective: "Proposed direction",
                  nextStep: "Next step",
                  commercialNote: "Commercial approach",
                }[key]
              }
            >
              <textarea
                rows={key === "objective" || key === "nextStep" ? 3 : 2}
                required
                value={value[key]}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            </Field>
          ))}
          <h3>Systems register</h3>
          {value.systems.map((s, i) => (
            <fieldset className="cp-edit-group" key={s.id}>
              <legend>{s.name || "New system"}</legend>
              {(["name", "purpose", "owner", "checkedAt", "nextAction"] as const).map((key) => (
                <Field
                  key={key}
                  label={
                    {
                      name: "System name",
                      purpose: "Purpose",
                      owner: "Owner",
                      checkedAt: "Last verified (date and evidence)",
                      nextAction: "Next action",
                    }[key]
                  }
                >
                  <input
                    value={s[key]}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        systems: value.systems.map((x, j) =>
                          j === i ? { ...x, [key]: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
              <Field label="Reviewed status">
                <select
                  value={s.status}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      systems: value.systems.map((x, j) =>
                        j === i ? { ...x, status: e.target.value as typeof s.status } : x,
                      ),
                    })
                  }
                >
                  {systemStatus.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="cp-text-button"
                onClick={() =>
                  setValue({ ...value, systems: value.systems.filter((_, j) => j !== i) })
                }
              >
                <X size={14} />
                Remove from register
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="cp-secondary"
            onClick={() =>
              setValue({
                ...value,
                systems: [
                  ...value.systems,
                  {
                    id: crypto.randomUUID(),
                    name: "",
                    purpose: "",
                    owner: "To confirm",
                    checkedAt: "",
                    nextAction: "",
                    status: "Awaiting review",
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            Add system
          </button>
          <h3>Shared links</h3>
          {value.links.map((l, i) => (
            <fieldset className="cp-edit-group" key={l.id}>
              <legend>{l.title || "New link"}</legend>
              {(["title", "url", "description"] as const).map((key) => (
                <Field
                  key={key}
                  label={
                    { title: "Title", url: "Link (https://)", description: "Description" }[key]
                  }
                >
                  <input
                    type={key === "url" ? "url" : "text"}
                    required
                    value={l[key]}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        links: value.links.map((x, j) =>
                          j === i ? { ...x, [key]: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
              <button
                type="button"
                className="cp-text-button"
                onClick={() => setValue({ ...value, links: value.links.filter((_, j) => j !== i) })}
              >
                <X size={14} />
                Remove link
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="cp-secondary"
            onClick={() =>
              setValue({
                ...value,
                links: [
                  ...value.links,
                  { id: crypto.randomUUID(), title: "", url: "", description: "" },
                ],
              })
            }
          >
            <Plus size={14} />
            Add link
          </button>
          {(error || validation) && (
            <p role="alert" className="cp-error">
              {error || validation}
            </p>
          )}
          <div className="cp-form-actions">
            <button type="button" className="cp-secondary" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="cp-primary" disabled={busy}>
              {busy ? "Saving…" : "Save workspace details"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
