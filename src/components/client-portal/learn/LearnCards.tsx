import { useEffect, useState } from "react";
import { ArrowRight, BriefcaseBusiness, Building2, RefreshCw, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { LearnTeamGroupPicker } from "./LearnTeamGroupPicker";
import { LearnPerformanceCard } from "./LearnPerformanceCard";
import { LearnWorkHistory } from "./LearnWorkHistory";
import { LearnWorkCalendarSettings } from "./LearnWorkCalendarSettings";
import { LearnScorecardSettings } from "./LearnScorecardSettings";
import {
  readLearnCards,
  searchLearnCards,
  CARD_SEARCH_MAX_LENGTH,
  readLearnCardDetail,
  type LearnCardKind,
  type LearnCardPage,
  type LearnCardDetail,
} from "@/lib/learn-cards";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const kinds = [
  { kind: "customer", label: "Customers", Icon: Building2 },
  { kind: "job", label: "Jobs", Icon: BriefcaseBusiness },
  { kind: "member", label: "Team members", Icon: Users },
  { kind: "team", label: "Teams", Icon: Users },
] as const;
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-GB") : "Not established";

export function LearnCards({ tenantId }: { tenantId: string }) {
  const { user, profile } = useAuth();
  // Remount on identity/tenant changes: no prior company's data survives a switch.
  if (!user || profile?.tenant_id !== tenantId)
    return <p role="status">Sign in to this company's workspace to read its cards.</p>;
  return (
    <CardWorkspace
      key={`${user.id}:${tenantId}`}
      tenantId={tenantId}
      actorId={user.id}
      canEdit={["owner", "admin"].includes(profile.role)}
    />
  );
}

function CardWorkspace({
  tenantId,
  actorId,
  canEdit,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [kind, setKind] = useState<LearnCardKind>("customer");
  const [group, setGroup] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [searchInvalid, setSearchInvalid] = useState(false);
  const [page, setPage] = useState(0),
    [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    kind: LearnCardKind;
    group: string;
    page: number;
    revision: number;
    search: string;
    data: LearnCardPage;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    setFailed(false);
    void (async () => {
      try {
        const data = search
          ? await searchLearnCards(
              getSupabaseClient(),
              tenantId,
              kind,
              search,
              page,
              Date.now(),
              ["member", "team"].includes(kind) ? group : undefined,
            )
          : await readLearnCards(
              getSupabaseClient(),
              tenantId,
              kind,
              page,
              Date.now(),
              ["member", "team"].includes(kind) ? group : undefined,
            );
        if (active) setResult({ kind, group, page, revision, search, data });
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId, kind, group, page, revision, search]);
  const current =
    result?.kind === kind &&
    result.group === group &&
    result.page === page &&
    result.revision === revision &&
    result.search === search
      ? result.data
      : null;
  return (
    <section className="lc-section" aria-label="Company cards">
      <div className="lr-section-heading">
        <div>
          <h2>Your company, connected</h2>
          <p>Customers, work and people — with the communications behind each finding.</p>
        </div>
        <button
          className="cp-secondary"
          onClick={() => setRevision((r) => r + 1)}
          aria-label="Refresh company cards"
        >
          <RefreshCw size={15} />
          Refresh cards
        </button>
      </div>
      <div className="lc-tabs" aria-label="Card types">
        {kinds.map(({ kind: value, label, Icon }) => (
          <button
            key={value}
            className={kind === value ? "selected" : ""}
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setGroup("");
              setGroupName("");
              setGroupPickerOpen(false);
              setSettingsOpen(false);
              setPage(0);
              setSelected(null);
              setSearch("");
              setSearchDraft("");
              setSearchInvalid(false);
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <form
        className="lc-search"
        role="search"
        aria-label="Search company cards"
        onSubmit={(e) => {
          e.preventDefault();
          const term = searchDraft.trim();
          if (term.length > CARD_SEARCH_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(term)) {
            setSearchInvalid(true);
            return;
          }
          setSearchInvalid(false);
          setSearch(term);
          setPage(0);
          setSelected(null);
          setRevision((r) => r + 1);
        }}
      >
        <label>
          Search {kinds.find((k) => k.kind === kind)?.label.toLowerCase()}
          <input
            type="search"
            value={searchDraft}
            maxLength={CARD_SEARCH_MAX_LENGTH}
            onChange={(e) => {
              setSearchDraft(e.target.value);
              setSearchInvalid(false);
            }}
            placeholder={
              kind === "job"
                ? "Job title or number"
                : kind === "member"
                  ? "Name or role"
                  : kind === "team"
                    ? "Team name"
                    : "Customer name"
            }
          />
        </label>
        <button type="submit" className="cp-secondary">
          Search cards
        </button>
        {(search || searchDraft) && (
          <button
            type="button"
            className="cp-secondary"
            onClick={() => {
              setSearch("");
              setSearchDraft("");
              setSearchInvalid(false);
              setPage(0);
              setSelected(null);
            }}
          >
            Clear search
          </button>
        )}
        {searchInvalid && <p role="alert">Use up to 120 characters on one line.</p>}
      </form>
      {search && (
        <p className="lc-search-summary" role="status">
          Results for “{search}” across this company's stored{" "}
          {kinds.find((k) => k.kind === kind)?.label.toLowerCase()}
          {group ? " in the selected team group" : ""}.
        </p>
      )}
      {["member", "team"].includes(kind) && (
        <div className="lc-group" aria-label="Company team group">
          <span>
            Company team group:{" "}
            <strong>
              {group ? groupName : kind === "team" ? "All teams" : "All team members"}
            </strong>
          </span>
          <button type="button" className="cp-secondary" onClick={() => setGroupPickerOpen(true)}>
            {group ? "Change team group" : "Choose team group"}
          </button>
          {group && (
            <button
              type="button"
              className="cp-secondary"
              onClick={() => {
                setGroup("");
                setGroupName("");
                setPage(0);
                setSelected(null);
                setSettingsOpen(false);
              }}
            >
              Clear team group
            </button>
          )}
        </div>
      )}
      <Dialog open={groupPickerOpen} onOpenChange={setGroupPickerOpen}>
        <DialogContent className="lc-dialog" overlayClassName="lc-overlay">
          {groupPickerOpen && (
            <LearnTeamGroupPicker
              tenantId={tenantId}
              selectedId={group}
              onSelect={(choice) => {
                setGroup(choice.id);
                setGroupName(choice.name);
                setPage(0);
                setSelected(null);
                setSettingsOpen(false);
                setGroupPickerOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {!current && (
        <p className="lc-empty" role="status">
          {failed
            ? "Cards are temporarily unavailable. Refresh cards to try again."
            : "Reading company records…"}
        </p>
      )}
      {current && current.cards.length === 0 && (
        <div className="lc-empty">
          <h3>
            {search
              ? "No matching cards on this page"
              : `No ${kinds.find((k) => k.kind === kind)?.label.toLowerCase()} on this page`}
          </h3>
          <p>
            {search
              ? "Try a different name or number, clear the search, or check the selected team group. Search covers stored cards; records awaiting import or linking may not have a card yet."
              : kind === "job"
                ? "Job cards appear when operational records are imported and linked. Communications alone do not confirm a job's status."
                : kind === "member"
                  ? "Member cards appear as people are added to the existing company directory."
                  : kind === "team"
                    ? "Team cards appear as groups are added to the company directory."
                    : "Customer cards appear as the existing identity and customer-card pipeline links your communications."}
          </p>
        </div>
      )}
      <div className="lc-grid">
        {current?.cards.map((card) => (
          <button key={card.id} className="lc-card" onClick={() => setSelected(card.id)}>
            <span className="lc-record-state">{card.recordState}</span>
            <h3>{card.title}</h3>
            {card.subtitle && <p>{card.subtitle}</p>}
            <span className="lc-updated">Record updated {when(card.updatedAt)}</span>
            <span className="lc-open">
              Read findings & evidence
              <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
      <div className="lc-pagination">
        <span>Page {page + 1} · stored records, ordered by last update</span>
        <button
          className="cp-secondary"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <button
          className="cp-secondary"
          disabled={!current?.hasMore}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="lc-dialog" overlayClassName="lc-overlay">
          {selected && (
            <CardDetail
              key={`${kind}:${selected}:${group}`}
              tenantId={tenantId}
              actorId={actorId}
              kind={kind}
              id={selected}
              groupId={["member", "team"].includes(kind) ? group || null : null}
              canReview={canEdit}
            />
          )}
        </DialogContent>
      </Dialog>
      <div className="ls-entry">
        <h3>Performance scorecards</h3>
        <p>
          Configure measures, targets and weights for these{" "}
          {kinds.find((k) => k.kind === kind)?.label.toLowerCase()}. Scores remain unassessed until
          approved rules and verified measurements are connected.
        </p>
        <button type="button" className="cp-secondary" onClick={() => setSettingsOpen(true)}>
          Review scoring rules
        </button>
      </div>
      {canEdit && (
        <div className="ls-entry">
          <h3>Company working calendar</h3>
          <p>
            Set company opening hours, timezone and closed dates for future working-time measures.
            Published hours are separate from draft changes.
          </p>
          <button type="button" className="cp-secondary" onClick={() => setCalendarOpen(true)}>
            Manage company calendar
          </button>
        </div>
      )}
      <Dialog open={calendarOpen && canEdit} onOpenChange={setCalendarOpen}>
        <DialogContent className="lc-dialog" overlayClassName="lc-overlay">
          <DialogHeader>
            <DialogTitle>Company working calendar</DialogTitle>
            <DialogDescription>
              Review, preview and publish versioned company hours.
            </DialogDescription>
          </DialogHeader>
          {calendarOpen && canEdit && (
            <LearnWorkCalendarSettings
              key={`${tenantId}:${actorId}`}
              tenantId={tenantId}
              actorId={actorId}
              canEdit={canEdit}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="lc-dialog" overlayClassName="lc-overlay">
          <DialogHeader>
            <DialogTitle>Performance scorecard settings</DialogTitle>
            <DialogDescription>
              Versioned draft rules. Saving does not activate scoring or change anyone's pay.
              {group && ["member", "team"].includes(kind) && <> Selected group: {groupName}.</>}
            </DialogDescription>
          </DialogHeader>
          {settingsOpen && (
            <LearnScorecardSettings
              key={`${tenantId}:${kind}:${group}`}
              tenantId={tenantId}
              kind={kind}
              groupId={["member", "team"].includes(kind) ? group || null : null}
              canEdit={canEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CardDetail({
  tenantId,
  actorId,
  kind,
  id,
  groupId,
  canReview,
}: {
  tenantId: string;
  actorId: string;
  kind: LearnCardKind;
  id: string;
  groupId: string | null;
  canReview: boolean;
}) {
  const [data, setData] = useState<LearnCardDetail | null>(null),
    [failed, setFailed] = useState(false),
    [revision, setRevision] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    void (async () => {
      try {
        const result = await readLearnCardDetail(getSupabaseClient(), tenantId, kind, id);
        if (active) {
          setData(result);
          setClock(Date.now());
        }
      } catch {
        if (active) setFailed(true);
      }
    })();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tenantId, kind, id, revision]);
  const stale = !!data && clock >= Date.parse(data.validUntil);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{data?.card.title ?? "Company card"}</DialogTitle>
        <DialogDescription>
          Stored links and findings from your company's existing records. Inferences remain subject
          to review.
        </DialogDescription>
      </DialogHeader>
      <button className="cp-secondary" onClick={() => setRevision((r) => r + 1)}>
        <RefreshCw size={14} />
        Refresh evidence
      </button>
      {!data ? (
        <p role="status">
          {failed ? "This card could not be read. Refresh to retry." : "Reading linked evidence…"}
        </p>
      ) : (
        <>
          <p className="lc-observed">
            Read {when(data.observedAt)}
            {stale
              ? " · This snapshot has expired. Refresh before relying on it."
              : " · Provider coverage is not established by these records."}
          </p>
          {data.gaps.length > 0 && (
            <aside className="lc-gaps" aria-label="Evidence gaps">
              <strong>What is missing</strong>
              <ul>
                {data.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </aside>
          )}
          <LearnPerformanceCard
            tenantId={tenantId}
            actorId={actorId}
            kind={kind}
            id={id}
            groupId={groupId}
            canReview={canReview}
          />
          <h3>Findings, commitments & blockers</h3>
          {!data.findings.length && (
            <p>
              No linked findings were returned. This does not establish that there is no outstanding
              work.
            </p>
          )}
          <div className="lc-findings">
            {data.findings.map((f) => (
              <article key={f.id}>
                <div className="lc-finding-heading">
                  <span>
                    {f.type} · {f.status}
                  </span>
                  {f.overdue && <strong>Recorded deadline overdue</strong>}
                </div>
                <h4>{f.title}</h4>
                <dl>
                  <div>
                    <dt>Owner</dt>
                    <dd>{f.owner ?? "Ownership not established"}</dd>
                  </div>
                  <div>
                    <dt>Waiting on</dt>
                    <dd>{f.waitingOn ?? "No dependency recorded"}</dd>
                  </div>
                  {f.deadline && (
                    <div>
                      <dt>Deadline</dt>
                      <dd>{when(f.deadline)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Model / rule confidence</dt>
                    <dd>
                      {f.confidence === null
                        ? "Not recorded"
                        : `${Math.round(f.confidence * 100)}% · not confirmation of fact`}
                    </dd>
                  </div>
                </dl>
                <LearnWorkHistory
                  tenantId={tenantId}
                  actorId={actorId}
                  objectId={f.id}
                  canReview={canReview}
                />
                <div className="lc-evidence-links">
                  {f.evidenceIds.map((ref, i) => (
                    <a key={ref} href={`#learn-evidence-${ref}`}>
                      Evidence {i + 1}
                    </a>
                  ))}
                </div>
                {(f.missingEvidence > 0 || !f.evidenceIds.length) && (
                  <p className="lc-missing">
                    {f.missingEvidence
                      ? `${f.missingEvidence} referenced communication(s) unavailable in this read.`
                      : "No accessible communication is linked to this finding."}
                  </p>
                )}
              </article>
            ))}
          </div>
          {data.moreFindings && (
            <p className="lc-missing">
              Showing the latest 50 linked findings. Older work is outside this read.
            </p>
          )}
          <h3>Combined evidence timeline</h3>
          {!data.evidence.length && (
            <p>
              No linked communication was returned. Source ingestion or identity linking may still
              be incomplete.
            </p>
          )}
          <ol className="lc-timeline">
            {data.evidence.map((e) => (
              <li key={e.id} id={`learn-evidence-${e.id}`} tabIndex={-1}>
                <span>
                  {e.source} · {when(e.occurredAt)}
                </span>
                <h4>{e.title}</h4>
                {e.summary && (
                  <p>
                    <strong>Stored summary: </strong>
                    {e.summary}
                  </p>
                )}
                <details>
                  <summary>Inspect source excerpt & provenance</summary>
                  {e.excerpt ? (
                    <blockquote>{e.excerpt}</blockquote>
                  ) : (
                    <p>No source excerpt is stored for this interaction.</p>
                  )}
                  <p>
                    Source record: {e.sourceTable ?? "Unknown table"} / {e.sourceId ?? "Unknown ID"}
                  </p>
                  <p>
                    Interaction: {e.id}. This excerpt may be shorter than the original
                    communication.
                  </p>
                </details>
              </li>
            ))}
          </ol>
          {data.moreEvidence && (
            <p className="lc-missing">
              This is a bounded evidence window; further communications exist outside it.
            </p>
          )}
        </>
      )}
    </>
  );
}
