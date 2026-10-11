/**
 * OpenFolk Control Plane — Team roster (Directory → Roster).
 *
 * The editable office-team configuration surface: people, formal/proposed titles, target
 * roles, authority levels, responsibilities (shared, weekday cover, cover-for), scoped
 * authority grants, and lifecycle (end / reactivate). Every write goes through the gated
 * openfolk-control-plane function → change-logged cp_* RPCs, requires a reason, and is
 * effective-dated — staff moves never require code changes. Titles and duties start
 * PROPOSED and stay visibly unconfirmed until an operator confirms them.
 *
 * Engineers are the next roster phase: adding one is this same Add-person flow (no schema
 * change); the office team is configured first per the activation brief.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, Pencil, Plus, ShieldCheck, UserMinus, UserPlus, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CpAuthorityGrant,
  CpIdentity,
  CpMember,
  CpResponsibility,
  Workspace,
} from "@/lib/openfolk";

// ── Action contract (wired by the route through the gated edge function) ─────
export interface RosterActions {
  memberUpsert?: (input: {
    member_id?: string;
    display_name?: string;
    formal_role?: string;
    formal_role_status?: "proposed" | "confirmed";
    target_role?: string;
    authority_level?: CpMember["authority_level"];
    reason: string;
  }) => Promise<boolean>;
  memberLifecycle?: (input: {
    member_id: string;
    op: "end" | "reactivate";
    reason: string;
  }) => Promise<boolean>;
  responsibilityUpsert?: (input: {
    assignment_id?: string;
    member_id?: string;
    kind?: CpResponsibility["kind"];
    label?: string;
    raci_role?: string;
    is_shared?: boolean;
    weekday_mask?: number;
    cover_for?: string;
    confirmed?: boolean;
    reason: string;
  }) => Promise<boolean>;
  responsibilityEnd?: (input: { assignment_id: string; reason: string }) => Promise<boolean>;
  authorityGrant?: (input: {
    member_id: string;
    permission: string;
    scope?: "self" | "team" | "company";
    scope_ref?: string;
    confirmed?: boolean;
    reason: string;
  }) => Promise<boolean>;
  authorityEnd?: (input: { grant_id: string; reason: string }) => Promise<boolean>;
}

const AUTHORITY_LEVELS = ["individual", "lead", "manager", "director", "owner"] as const;
const RESP_KINDS: CpResponsibility["kind"][] = [
  "responsibility_area",
  "workflow",
  "escalation",
  "team",
  "customer_segment",
  "cover",
];
const RACI_ROLES = ["responsible", "accountable", "consulted", "informed", "approver"];
// The governed permission vocabulary (authority_permissions registry).
const PERMISSIONS = [
  "work.approve",
  "work.assign",
  "objective.publish",
  "ownership.confirm",
  "agent.view",
  "agent.interact",
  "agent.approve_action",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const maskToDays = (mask: number | null): string =>
  mask == null ? "all days" : WEEKDAYS.filter((_, i) => mask & (1 << i)).join("/") || "no days";

function Badge({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]",
        cls ?? "border-hairline text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-[11px] text-muted-foreground">
      Reason (required — recorded in the audit log)
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
        placeholder="e.g. Role confirmed with Heidi on the phone"
      />
    </label>
  );
}

// ── Add / edit member form ───────────────────────────────────────────────────
function MemberForm({
  member,
  busy,
  onSubmit,
  onCancel,
}: {
  member: CpMember | null; // null = create
  busy: boolean;
  onSubmit: (input: {
    member_id?: string;
    display_name?: string;
    formal_role?: string;
    formal_role_status?: "proposed" | "confirmed";
    target_role?: string;
    authority_level?: CpMember["authority_level"];
    reason: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member?.display_name ?? "");
  const [role, setRole] = useState(member?.formal_role ?? "");
  const [status, setStatus] = useState<"proposed" | "confirmed">(
    member?.formal_role_status ?? "proposed",
  );
  const [target, setTarget] = useState(member?.target_role ?? "");
  const [level, setLevel] = useState<CpMember["authority_level"]>(
    member?.authority_level ?? "individual",
  );
  const [reason, setReason] = useState("");
  const valid = name.trim().length > 0 && reason.trim().length > 0;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-muted-foreground">
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          Formal title
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          Title status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "proposed" | "confirmed")}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          >
            <option value="proposed">proposed (unconfirmed)</option>
            <option value="confirmed">confirmed</option>
          </select>
        </label>
        <label className="block text-[11px] text-muted-foreground">
          Target role (optional)
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          />
        </label>
        <label className="block text-[11px] text-muted-foreground">
          Authority level
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as CpMember["authority_level"])}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          >
            {AUTHORITY_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ReasonField value={reason} onChange={setReason} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() =>
            onSubmit({
              member_id: member?.id,
              display_name: name.trim(),
              formal_role: role.trim() || undefined,
              formal_role_status: status,
              target_role: target.trim() || undefined,
              authority_level: level,
              reason: reason.trim(),
            })
          }
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          {member ? "Save changes" : "Add person"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hairline bg-white px-3 py-1 text-xs text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Add responsibility form ──────────────────────────────────────────────────
function ResponsibilityForm({
  member,
  allMembers,
  busy,
  onSubmit,
  onCancel,
}: {
  member: CpMember;
  allMembers: CpMember[];
  busy: boolean;
  onSubmit: (input: {
    member_id: string;
    kind: CpResponsibility["kind"];
    label: string;
    raci_role: string;
    is_shared: boolean;
    weekday_mask?: number;
    cover_for?: string;
    reason: string;
  }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<CpResponsibility["kind"]>("responsibility_area");
  const [label, setLabel] = useState("");
  const [raci, setRaci] = useState("responsible");
  const [shared, setShared] = useState(false);
  const [days, setDays] = useState<number>(0); // 0 = all days (mask omitted)
  const [coverFor, setCoverFor] = useState("");
  const [reason, setReason] = useState("");
  const valid =
    label.trim().length > 0 && reason.trim().length > 0 && (kind !== "cover" || coverFor);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-[11px] text-muted-foreground">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CpResponsibility["kind"])}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          >
            {RESP_KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] text-muted-foreground">
          RACI
          <select
            value={raci}
            onChange={(e) => setRaci(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          >
            {RACI_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[11px] text-muted-foreground">
        Description
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          placeholder="e.g. Routine bookings and maintenance appointments"
        />
      </label>
      {kind === "cover" && (
        <label className="block text-[11px] text-muted-foreground">
          Covers for
          <select
            value={coverFor}
            onChange={(e) => setCoverFor(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
          >
            <option value="">— choose person —</option>
            {allMembers
              .filter((m) => m.id !== member.id && m.effective_to === null)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          shared with team
        </label>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">Days:</span>
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays((v) => v ^ (1 << i))}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[10px]",
                days & (1 << i)
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-hairline text-muted-foreground",
              )}
            >
              {d}
            </button>
          ))}
          <span className="text-[10px] italic text-muted-foreground">
            {days === 0 ? "(none picked = all days)" : maskToDays(days)}
          </span>
        </div>
      </div>
      <ReasonField value={reason} onChange={setReason} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() =>
            onSubmit({
              member_id: member.id,
              kind,
              label: label.trim(),
              raci_role: raci,
              is_shared: shared,
              weekday_mask: days || undefined,
              cover_for: kind === "cover" ? coverFor : undefined,
              reason: reason.trim(),
            })
          }
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Add responsibility
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-hairline bg-white px-3 py-1 text-xs text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── One member card ──────────────────────────────────────────────────────────
function MemberCard({
  member,
  allMembers,
  responsibilities,
  grants,
  identities,
  writeCapable,
  busy,
  actions,
  onPreview,
  onOpenHub,
}: {
  member: CpMember;
  allMembers: CpMember[];
  responsibilities: CpResponsibility[];
  grants: CpAuthorityGrant[];
  identities: CpIdentity[];
  writeCapable: boolean;
  busy: boolean;
  actions: RosterActions;
  onPreview: (memberId: string) => void;
  onOpenHub: (memberId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [addingResp, setAddingResp] = useState(false);
  const [granting, setGranting] = useState(false);
  const [permission, setPermission] = useState(PERMISSIONS[0]);
  const [scope, setScope] = useState<"self" | "team" | "company">("self");
  const [grantReason, setGrantReason] = useState("");
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const ended = member.effective_to !== null;
  const verified = identities.filter((i) => i.verification_state === "verified").length;
  const nameOf = (id: string | null) => allMembers.find((m) => m.id === id)?.display_name ?? "—";

  return (
    <div
      className={cn(
        "rounded-xl border bg-white p-4",
        "border-hairline",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 basis-full">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-display">{member.display_name}</span>
            {member.formal_role_status !== "confirmed" ? (
              <Badge cls="border-amber-500/40 bg-amber-500/10 text-amber-700">
                title proposed — unconfirmed
              </Badge>
            ) : (
              <Badge cls="border-success/40 bg-success/10 text-success">title confirmed</Badge>
            )}
            {ended && <Badge cls="border-hairline text-muted-foreground">ended</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {member.formal_role ?? <em>no title recorded</em>}
            {member.target_role && (
              <span className="text-muted-foreground/70"> → target: {member.target_role}</span>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge>authority: {member.authority_level ?? "individual"}</Badge>
            <Badge>
              identities: {verified} verified / {identities.length} linked
            </Badge>
            {member.profile_id ? <Badge>login linked</Badge> : <Badge>no login (ok)</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onPreview(member.id)}
            className="inline-flex items-center gap-1 rounded-md border border-hairline bg-white px-2 py-1 text-[11px] font-medium text-accent hover:border-accent/50"
          >
            <Eye className="h-3 w-3" /> Preview Command Centre
          </button>
          <button
            type="button"
            onClick={() => onOpenHub(member.id)}
            className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px] font-medium text-accent hover:border-accent/50"
          >
            Open hub →
          </button>
          {writeCapable && !ended && (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-white px-2 py-1 text-[11px] text-muted-foreground hover:text-display"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
        </div>
      </div>

      {editing && (
        <MemberForm
          member={member}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => {
            void actions.memberUpsert?.(input).then((ok) => ok && setEditing(false));
          }}
        />
      )}

      {/* Responsibilities */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Responsibilities
          </h4>
          {writeCapable && !ended && (
            <button
              type="button"
              onClick={() => setAddingResp((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-white px-1.5 py-0.5 text-[10px] text-accent"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )}
        </div>
        <ul className="mt-1 space-y-1">
          {responsibilities.map((r) => (
            <li key={r.id} className="flex items-start gap-1.5 text-xs text-display">
              <span className="min-w-0 flex-1">
                {r.label}
                <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                  <Badge>{r.kind.replace(/_/g, " ")}</Badge>
                  {r.raci_role !== "responsible" && (
                    <Badge cls="border-accent/40 text-accent">{r.raci_role}</Badge>
                  )}
                  {r.is_shared && <Badge cls="border-accent/40 text-accent">shared</Badge>}
                  {r.cover_for && (
                    <Badge cls="border-accent/40 text-accent">covers {nameOf(r.cover_for)}</Badge>
                  )}
                  {r.weekday_mask != null && <Badge>{maskToDays(r.weekday_mask)}</Badge>}
                  {!r.confirmed && (
                    <Badge cls="border-amber-500/40 bg-amber-500/10 text-amber-700">proposed</Badge>
                  )}
                </span>
              </span>
              {writeCapable && !ended && !r.confirmed && actions.responsibilityUpsert && (
                <ReviewButton
                  label="Confirm responsibility"
                  busy={busy}
                  onReview={(reason) =>
                    actions.responsibilityUpsert!({ assignment_id: r.id, confirmed: true, reason })
                  }
                />
              )}
              {writeCapable && !ended && actions.responsibilityEnd && (
                <EndButton
                  label="end responsibility"
                  busy={busy}
                  onEnd={(reason) => actions.responsibilityEnd!({ assignment_id: r.id, reason })}
                />
              )}
            </li>
          ))}
          {responsibilities.length === 0 && (
            <li className="text-xs italic text-muted-foreground">
              No active responsibilities recorded.
            </li>
          )}
        </ul>
        {addingResp && (
          <ResponsibilityForm
            member={member}
            allMembers={allMembers}
            busy={busy}
            onCancel={() => setAddingResp(false)}
            onSubmit={(input) => {
              void actions.responsibilityUpsert?.(input).then((ok) => ok && setAddingResp(false));
            }}
          />
        )}
      </div>

      {/* Authority */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Authority
          </h4>
          {writeCapable && !ended && (
            <button
              type="button"
              onClick={() => setGranting((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-white px-1.5 py-0.5 text-[10px] text-accent"
            >
              <Plus className="h-3 w-3" /> Grant
            </button>
          )}
        </div>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {grants.map((g) => (
            <li key={g.id} className="inline-flex items-center gap-1">
              <Badge cls="border-accent/40 text-accent">
                <ShieldCheck className="h-3 w-3" />
                {g.permission} · {g.scope}
                {!g.confirmed && <span className="text-amber-700"> (proposed)</span>}
              </Badge>
              {writeCapable && !ended && !g.confirmed && actions.authorityGrant && (
                <ReviewButton
                  label="Confirm authority"
                  busy={busy}
                  onReview={(reason) =>
                    actions.authorityGrant!({
                      member_id: member.id,
                      permission: g.permission,
                      scope: g.scope,
                      scope_ref: g.scope_ref ?? undefined,
                      confirmed: true,
                      reason,
                    })
                  }
                />
              )}
              {writeCapable && !ended && actions.authorityEnd && (
                <EndButton
                  label="end grant"
                  busy={busy}
                  onEnd={(reason) => actions.authorityEnd!({ grant_id: g.id, reason })}
                />
              )}
            </li>
          ))}
          {grants.length === 0 && (
            <li className="text-xs italic text-muted-foreground">No scoped permissions granted.</li>
          )}
        </ul>
        {granting && (
          <div className="mt-2 space-y-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] text-muted-foreground">
                Permission
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value)}
                  className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
                >
                  {PERMISSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Scope
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "self" | "team" | "company")}
                  className="mt-0.5 w-full rounded-md border border-hairline bg-white px-2 py-1 text-xs text-display"
                >
                  <option value="self">self</option>
                  <option value="team" disabled={!member.org_unit_id}>
                    this person’s team
                  </option>
                  <option value="company">company</option>
                </select>
              </label>
            </div>
            <ReasonField value={grantReason} onChange={setGrantReason} />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!grantReason.trim() || busy || (scope === "team" && !member.org_unit_id)}
                onClick={() =>
                  void actions
                    .authorityGrant?.({
                      member_id: member.id,
                      permission,
                      scope,
                      scope_ref: scope === "team" ? member.org_unit_id! : undefined,
                      reason: grantReason.trim(),
                    })
                    .then((ok) => {
                      if (ok) {
                        setGranting(false);
                        setGrantReason("");
                      }
                    })
                }
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Grant
              </button>
              <button
                type="button"
                onClick={() => setGranting(false)}
                className="rounded-md border border-hairline bg-white px-3 py-1 text-xs text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lifecycle */}
      {writeCapable && (
        <div className="mt-3 border-t border-hairline pt-2">
          {!confirmingEnd ? (
            <button
              type="button"
              onClick={() => setConfirmingEnd(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
            >
              {ended ? (
                <>
                  <UserPlus className="h-3 w-3" /> Reactivate person…
                </>
              ) : (
                <>
                  <UserMinus className="h-3 w-3" /> End person (leaver)…
                </>
              )}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                {ended
                  ? "Reactivation restores the person; their previous duties are NOT restored automatically (re-propose deliberately)."
                  : "Ending a person closes their open responsibilities and authority the same instant. History is preserved; past work stays attributed to them."}
              </p>
              <ReasonField value={lifecycleReason} onChange={setLifecycleReason} />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!lifecycleReason.trim() || busy}
                  onClick={() =>
                    void actions
                      .memberLifecycle?.({
                        member_id: member.id,
                        op: ended ? "reactivate" : "end",
                        reason: lifecycleReason.trim(),
                      })
                      .then((ok) => {
                        if (ok) {
                          setConfirmingEnd(false);
                          setLifecycleReason("");
                        }
                      })
                  }
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium text-white disabled:opacity-40",
                    ended ? "bg-accent" : "bg-destructive",
                  )}
                >
                  {ended ? "Reactivate" : "End person"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEnd(false)}
                  className="rounded-md border border-hairline bg-white px-3 py-1 text-xs text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Small inline end-with-reason affordance used for responsibilities + grants.
function EndButton({
  label,
  busy,
  onEnd,
}: {
  label: string;
  busy: boolean;
  onEnd: (reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
        title={label}
      >
        end
      </button>
    );
  return (
    <span className="flex shrink-0 items-center gap-1">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="reason"
        className="w-28 rounded border border-hairline px-1 py-0.5 text-[10px]"
      />
      <button
        type="button"
        disabled={!reason.trim() || busy}
        onClick={() => {
          void onEnd(reason.trim()).then((ok) => {
            if (ok) {
              setOpen(false);
              setReason("");
            }
          });
        }}
        className="text-[10px] font-medium text-destructive disabled:opacity-40"
      >
        confirm
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] text-muted-foreground"
      >
        ×
      </button>
    </span>
  );
}

function ReviewButton({
  label,
  busy,
  onReview,
}: {
  label: string;
  busy: boolean;
  onReview: (reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button type="button" className="text-[11px] text-accent" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <span className="flex flex-wrap gap-1">
      <input
        aria-label={`${label} reason`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for confirmation"
        className="w-40 rounded border border-hairline px-1 py-0.5 text-xs"
      />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        className="text-xs text-accent disabled:opacity-40"
        onClick={() =>
          void onReview(reason.trim()).then((ok) => {
            if (ok) {
              setOpen(false);
              setReason("");
            }
          })
        }
      >
        Confirm
      </button>
      <button type="button" className="text-xs" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

// ── The roster section ───────────────────────────────────────────────────────
export function OpenfolkRoster({
  workspace,
  writeCapable,
  busy,
  actions,
  onPreview,
  onOpenHub,
}: {
  workspace: Workspace;
  writeCapable: boolean;
  busy: boolean;
  actions: RosterActions;
  onPreview: (memberId: string) => void;
  onOpenHub: (memberId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"active" | "former" | "all">("active");
  const [page, setPage] = useState(0);
  useEffect(() => {
    setQuery("");
    setCategory("active");
    setPage(0);
    setAdding(false);
  }, [workspace.summary.tenant_id]);
  const members = useMemo(() => workspace.members ?? [], [workspace.members]);
  const responsibilities = workspace.responsibilities ?? [];
  const grants = workspace.authorityGrants ?? [];
  const identities = workspace.identities ?? [];
  const active = useMemo(() => members.filter((m) => m.effective_to === null), [members]);
  const endedMembers = useMemo(() => members.filter((m) => m.effective_to !== null), [members]);
  const matching = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (category === "active" ? active : category === "former" ? endedMembers : members).filter(
      (m) =>
        !term ||
        [m.display_name, m.formal_role, m.target_role].some((value) =>
          value?.toLocaleLowerCase().includes(term),
        ),
    );
  }, [query, category, active, endedMembers, members]);
  const pageSize = 24;
  const lastPage = Math.max(0, Math.ceil(matching.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = matching.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  return (
    <section className="rounded-xl border border-hairline bg-white p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-display">Team roster</h3>
        <span className="text-[11px] text-muted-foreground">{active.length} active member(s)</span>
        {writeCapable && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-accent hover:border-accent/50"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add person
          </button>
        )}
      </header>
      <p className="mb-3 text-xs text-muted-foreground">
        People, titles, responsibilities, cover and authority — editable here so staff moves never
        need code changes. Everything starts <em>proposed</em> until confirmed; every change
        requires a reason and is recorded in the audit history. Engineers join through this same
        Add-person flow as the next roster phase (office team first).
      </p>
      {adding && (
        <MemberForm
          member={null}
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(input) => {
            void actions.memberUpsert?.(input).then((ok) => ok && setAdding(false));
          }}
        />
      )}
      <div
        className="my-4 flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Find roster members"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Find a person or role
          <input
            type="search"
            maxLength={120}
            value={query}
            disabled={busy}
            className="min-h-10 rounded-md border border-hairline bg-white px-3 text-display"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Membership
          <select
            value={category}
            disabled={busy}
            className="min-h-10 rounded-md border border-hairline bg-white px-3 text-display"
            onChange={(e) => {
              setCategory(e.target.value as typeof category);
              setPage(0);
            }}
          >
            <option value="active">Active members ({active.length})</option>
            <option value="former">Former members ({endedMembers.length})</option>
            <option value="all">All members ({members.length})</option>
          </select>
        </label>
        {query && (
          <button
            type="button"
            disabled={busy}
            className="min-h-10 rounded-md border border-hairline px-3 text-xs"
            onClick={() => {
              setQuery("");
              setPage(0);
            }}
          >
            Clear roster search
          </button>
        )}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {matching.length} matching member(s).{" "}
        {category === "former" && "Former members retain their history."}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2" aria-label="Roster members">
        {visible.map((m) => (
          <MemberCard
            key={m.id}
            member={m}
            allMembers={members}
            responsibilities={responsibilities.filter((r) => r.member_id === m.id)}
            grants={grants.filter((g) => g.member_id === m.id)}
            identities={identities.filter((i) => i.team_member_id === m.id)}
            writeCapable={writeCapable}
            busy={busy}
            actions={actions}
            onPreview={onPreview}
            onOpenHub={onOpenHub}
          />
        ))}
        {matching.length === 0 && (
          <p className="text-xs italic text-muted-foreground">
            {query
              ? "No people match this name or role in the selected membership group."
              : category === "former"
                ? "No former members recorded."
                : "No members in this selection."}
          </p>
        )}
      </div>
      <div
        className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
        aria-label="Roster pages"
      >
        <span className="mr-auto">
          Page {currentPage + 1} of {lastPage + 1} · up to {pageSize} people per page
        </span>
        <button
          type="button"
          className="min-h-10 rounded-md border border-hairline px-3"
          disabled={busy || currentPage === 0}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous people
        </button>
        <button
          type="button"
          className="min-h-10 rounded-md border border-hairline px-3"
          disabled={busy || currentPage >= lastPage}
          onClick={() => setPage(currentPage + 1)}
        >
          Next people
        </button>
      </div>
    </section>
  );
}
