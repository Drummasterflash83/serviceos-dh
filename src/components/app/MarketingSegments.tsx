/**
 * Marketing Segments — versioned dynamic segments with a STRUCTURED NESTED
 * builder (AND/OR groups + per-node NOT, no raw-JSON editing) that supports
 * the full validated grammar. The builder's state IS the definition tree
 * (deep-cloned on open, saved verbatim), so nested definitions round-trip
 * WITHOUT LOSS. A definition the builder cannot faithfully represent renders
 * READ-ONLY — never flattened, discarded or rewritten. Unsupported filters
 * (campaign engagement, ad attribution) stay honest Preview options.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, RefreshCw, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import { eligibilityLanguage } from "@/lib/marketing/eligibility-language";
import { listTags, listOwners, listCompanies, type MarketingTag } from "@/lib/marketing/contacts";
import {
  listSegments,
  createSegment,
  updateSegment,
  setSegmentStatus,
  evaluateSegment,
  type MarketingSegment,
  type SegmentNode,
} from "@/lib/marketing/segments";
import {
  canEditNode,
  cloneNode,
  addChildAt,
  removeAt,
  replaceAt,
  setGroupOp,
  toggleNotAt,
  nodeCount,
  nodeDepth,
  GROUP_MAX_CHILDREN,
  MAX_DEPTH,
  type NodePath,
} from "@/lib/marketing/segment-builder";

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-accent";

type Leaf = Extract<SegmentNode, { field: string }>;

interface OwnerOpt {
  id: string;
  label: string;
}
interface CompanyOpt {
  id: string;
  name: string;
}

function leafSummary(n: Leaf, tags: MarketingTag[], companies: CompanyOpt[]): string {
  switch (n.field) {
    case "search":
      return `matches “${n.value}”`;
    case "relationship": {
      const m = n.match;
      const bits = [
        m.lifecycle && `stage ${m.lifecycle}`,
        m.type && `type ${m.type}`,
        m.status && `status ${m.status}`,
        m.source && `source ${m.source}`,
        m.owner_id && (m.owner_id === "unassigned" ? "unassigned" : "owner set"),
      ].filter(Boolean);
      return `one relationship with ${bits.join(" + ") || "any values"}`;
    }
    case "company":
      return n.value === null
        ? "no company"
        : `company ${companies.find((c) => c.id === n.value)?.name ?? "selected"}`;
    case "created":
      return `created ${n.from ? `after ${n.from.slice(0, 10)}` : ""}${n.to ? ` before ${n.to.slice(0, 10)}` : ""}`;
    case "last_contact":
      return n.never
        ? "never contacted"
        : `last contact ${n.from ? `after ${n.from.slice(0, 10)}` : ""}${n.to ? ` before ${n.to.slice(0, 10)}` : ""}`;
    case "tag": {
      const names = n.tag_ids.map((id) => tags.find((t) => t.id === id)?.label ?? "tag").join(", ");
      return `${n.mode === "none" ? "not tagged" : n.mode === "all" ? "all of" : "any of"} ${names}`;
    }
    case "eligibility":
      return `${n.channel} eligibility is ${n.value}`;
    default:
      return "condition";
  }
}

/** Read-only recursive rendering — the safe representation for definitions the
 *  builder cannot faithfully edit (and the summary inside groups). */
function NodeSummary({
  node,
  tags,
  companies,
}: {
  node: SegmentNode;
  tags: MarketingTag[];
  companies: CompanyOpt[];
}) {
  if ("op" in node) {
    if (node.op === "not")
      return (
        <span>
          NOT (<NodeSummary node={node.child} tags={tags} companies={companies} />)
        </span>
      );
    return (
      <span>
        (
        {node.children.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="font-medium"> {node.op.toUpperCase()} </span>}
            <NodeSummary node={c} tags={tags} companies={companies} />
          </span>
        ))}
        )
      </span>
    );
  }
  return <span>{leafSummary(node as Leaf, tags, companies)}</span>;
}

export function MarketingSegments() {
  const { can } = useMarketingAccess();
  const canManage = can("marketing.tags.manage");
  const [segments, setSegments] = useState<MarketingSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<MarketingTag[]>([]);
  const [owners, setOwners] = useState<OwnerOpt[]>([]);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [editing, setEditing] = useState<MarketingSegment | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await listSegments();
    if (r.ok) {
      setSegments(r.data.segments);
      setError(null);
    } else setError(r.error.message);
  }, []);
  useEffect(() => {
    void reload();
    void listTags().then((r) => r.ok && setTags(r.data.tags));
    void listOwners().then(
      (r) =>
        r.ok &&
        setOwners(r.data.owners.map((o) => ({ id: o.id, label: o.full_name ?? o.email ?? o.id }))),
    );
    void listCompanies().then((r) => r.ok && setCompanies(r.data.companies));
  }, [reload]);

  if (error)
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertTriangle className="mr-1 inline h-4 w-4 text-destructive" /> Segments unavailable —{" "}
        {error}
        <button onClick={() => void reload()} className="ml-2 text-xs underline">
          retry
        </button>
      </div>
    );
  if (!segments)
    return (
      <div className="grid min-h-[20vh] place-items-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Saved, versioned filters evaluated server-side over canonical Contacts. A stored count is
          an estimate at its evaluation time — never an audience snapshot (snapshots arrive with
          Campaigns).
        </p>
        {canManage && (
          <button
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            <Plus className="h-3.5 w-3.5" /> New segment
          </button>
        )}
      </div>
      {notice && <div className="text-xs text-muted-foreground">{notice}</div>}
      {segments.length === 0 && (
        <div className="rounded-xl border border-hairline bg-white p-6 text-center text-sm text-muted-foreground">
          No segments yet — create one to save a reusable filter.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {segments.map((s) => (
          <div key={s.id} className="rounded-xl border border-hairline bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">v{s.definition_version}</span>
              {s.status === "archived" && (
                <span className="rounded-full bg-surface-alt px-1.5 text-[10px]">archived</span>
              )}
            </div>
            {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
            <div className="mt-2 text-xs text-muted-foreground">
              {s.estimated_count != null && s.evaluated_at ? (
                <>
                  <span className="tabular font-medium text-foreground">{s.estimated_count}</span>{" "}
                  matching at {new Date(s.evaluated_at).toLocaleString()}
                </>
              ) : (
                "Not evaluated for this version yet"
              )}
            </div>
            {canManage && (
              <div className="mt-3 flex gap-2 text-xs">
                <button onClick={() => setEditing(s)} className="underline">
                  Open
                </button>
                <button
                  onClick={() =>
                    // SAVED evaluation: pinned to this exact definition version,
                    // so the stored count/timestamp always belong to it — a
                    // concurrent definition change surfaces VERSION_CONFLICT
                    void evaluateSegment({
                      segment_id: s.id,
                      expected_version: s.definition_version,
                      limit: 1,
                    }).then(async (r) => {
                      if (!r.ok && r.error.code === "VERSION_CONFLICT")
                        setNotice("Segment changed elsewhere — reloaded.");
                      else if (!r.ok) setNotice(r.error.message);
                      await reload();
                    })
                  }
                  className="underline"
                  title="Evaluate this saved version and store its count"
                >
                  Evaluate now
                </button>
                <button
                  onClick={() =>
                    void setSegmentStatus(
                      s.status === "active" ? "archive" : "reactivate",
                      s.id,
                      s.updated_at,
                    ).then(async (r) => {
                      if (!r.ok && r.error.code === "VERSION_CONFLICT")
                        setNotice("Segment changed elsewhere — reloaded.");
                      else if (!r.ok) setNotice(r.error.message);
                      await reload();
                    })
                  }
                  className="text-muted-foreground underline"
                >
                  {s.status === "active" ? "Archive" : "Reactivate"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <SegmentBuilder
          segment={editing === "new" ? null : editing}
          tags={tags}
          owners={owners}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
          onConflict={async () => {
            setNotice("Segment changed elsewhere — reloaded.");
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/* ── structured NESTED builder over the validated grammar ── */
function SegmentBuilder({
  segment,
  tags,
  owners,
  companies,
  onClose,
  onSaved,
  onConflict,
}: {
  segment: MarketingSegment | null;
  tags: MarketingTag[];
  owners: OwnerOpt[];
  companies: CompanyOpt[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { access } = useMarketingAccess();
  const stages = access?.lifecycle_stages ?? [];
  // ROUND-TRIP SAFETY: the state IS a deep clone of the stored definition; a
  // definition outside the builder grammar is read-only, never rewritten.
  const editable = segment ? canEditNode(segment.definition) : true;
  const [def, setDef] = useState<SegmentNode | null>(
    segment ? cloneNode(segment.definition) : null,
  );
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<{ count: number; names: string[] } | null>(null);

  const count = def ? nodeCount(def) : 0;

  function mutate(next: SegmentNode | null) {
    setEvalResult(null);
    setDef(next);
  }

  function newLeaf(kind: string): SegmentNode | null {
    const first = tags[0]?.id;
    const map: Record<string, SegmentNode | null> = {
      search: { field: "search", value: "" },
      relationship: { field: "relationship", match: { status: "active" } },
      company: { field: "company", value: companies[0]?.id ?? null },
      tag: first ? { field: "tag", mode: "any", tag_ids: [first] } : null,
      eligibility: { field: "eligibility", channel: "email", value: "subscribed" },
      created: { field: "created", from: `${new Date().toISOString().slice(0, 10)}T00:00:00Z` },
      last_contact: { field: "last_contact", never: true },
    };
    return map[kind] ?? null;
  }

  async function preview() {
    if (!def) return;
    setBusy(true);
    setError(null);
    const r = await evaluateSegment({ definition: def, limit: 10 });
    setBusy(false);
    if (r.ok)
      setEvalResult({
        count: r.data.count,
        names: r.data.items.map((i) => i.display_name ?? "Unnamed person"),
      });
    else setError(r.error.message);
  }
  async function save() {
    if (!name.trim()) return;
    if (editable && !def) return;
    setBusy(true);
    setError(null);
    const r = segment
      ? await updateSegment({
          segment_id: segment.id,
          expected_version: segment.definition_version,
          name: name.trim(),
          description: description.trim() || undefined,
          // read-only definitions are NEVER sent back — name/description only
          ...(editable && def ? { definition: def } : {}),
        })
      : await createSegment({
          name: name.trim(),
          description: description.trim() || undefined,
          definition: def as SegmentNode,
        });
    setBusy(false);
    if (r.ok) await onSaved();
    else if (r.error.code === "VERSION_CONFLICT") await onConflict();
    else setError(r.error.message);
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">
          {segment
            ? `Edit segment (v${segment.definition_version} → v${segment.definition_version + 1})`
            : "New segment"}
        </div>
        <button onClick={onClose} aria-label="Close builder">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Segment name *"
          className={cn(inputCls, "w-56")}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className={cn(inputCls, "flex-1")}
        />
      </div>

      {!editable && segment && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <div className="font-medium">This definition is shown read-only.</div>
          <p className="mt-1 text-muted-foreground">
            It uses a shape this builder cannot faithfully edit, so its conditions are preserved
            exactly — nothing is flattened or dropped. Name and description remain editable.
          </p>
          <div className="mt-2 rounded-lg bg-surface-alt/60 p-2">
            <NodeSummary node={segment.definition} tags={tags} companies={companies} />
          </div>
        </div>
      )}

      {editable && (
        <div className="mt-3 space-y-2">
          {!def && (
            <div className="text-xs text-muted-foreground">
              Add a first condition — then group with AND/OR or negate with NOT as needed.
            </div>
          )}
          {def && (
            <NodeEditor
              node={def}
              path={[]}
              root={def}
              tags={tags}
              owners={owners}
              companies={companies}
              stages={stages}
              totalCount={count}
              onChange={mutate}
            />
          )}
          <AddCondition
            label={def ? "Add condition (AND with the whole segment)" : "Add condition…"}
            disabledTags={tags.length === 0}
            onAdd={(kind) => {
              const leaf = newLeaf(kind);
              if (!leaf) return;
              if (!def) return mutate(leaf);
              if (count + 2 > 32) return;
              mutate(addChildAt(def, [], leaf));
            }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => void preview()}
          disabled={busy || !def}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-3 py-1.5 disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" /> Evaluate
        </button>
        <button
          onClick={() => void save()}
          disabled={busy || !name.trim() || (editable && !def)}
          className="rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
        >
          {busy ? "Working…" : segment ? "Save new version" : "Create segment"}
        </button>
        <span className="text-muted-foreground">
          {count}/32 nodes · depth {def ? nodeDepth(def) : 0}/{MAX_DEPTH}
        </span>
      </div>
      {error && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          {error}
        </div>
      )}
      {evalResult && evalResult.count > 0 && (
        <div className="mt-2 rounded-lg border border-hairline bg-surface-alt/50 p-2 text-xs">
          <span className="tabular font-medium">{evalResult.count}</span>{" "}
          {evalResult.count === 1 ? "person matches" : "people match"}
          {evalResult.names.length > 0 && (
            <span className="text-muted-foreground">
              {" "}
              — e.g. {evalResult.names.slice(0, 5).join(", ")}
            </span>
          )}
          <p className="mt-1 text-muted-foreground">
            Matching is not the same as sendable: before any campaign sends, each person&apos;s
            consent, unsubscribe and suppression state is checked and every exclusion is shown with
            its reason.
          </p>
        </div>
      )}
      {evalResult && evalResult.count === 0 && (
        <div className="mt-2 rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs">
          <p className="font-medium text-foreground">Nobody matches this segment yet.</p>
          <p className="mt-1 text-muted-foreground">
            Either no contacts exist yet, or none meet these conditions. If you filtered on
            eligibility, remember most contacts start with{" "}
            <span className="font-medium text-foreground">no marketing preference recorded</span> —
            ServiceOS never assumes consent, so they stay excluded until a real opt-in is recorded.
            Add or import contacts under Contacts → Imports, record consent, then evaluate again.
          </p>
        </div>
      )}
    </div>
  );
}

function AddCondition({
  label,
  disabledTags,
  onAdd,
}: {
  label: string;
  disabledTags: boolean;
  onAdd: (kind: string) => void;
}) {
  return (
    <select value="" onChange={(e) => e.target.value && onAdd(e.target.value)} className={inputCls}>
      <option value="">{label}</option>
      <option value="search">Name / email / phone search</option>
      <option value="relationship">Relationship (single row)</option>
      <option value="company">Company</option>
      <option value="tag" disabled={disabledTags}>
        Tags{disabledTags ? " (no tags yet)" : ""}
      </option>
      <option value="eligibility">Communication eligibility</option>
      <option value="created">Created date range</option>
      <option value="last_contact">Last contact</option>
      <option value="" disabled>
        Campaign engagement (Preview — Phase 5)
      </option>
      <option value="" disabled>
        Ad attribution (Preview — Phase 8)
      </option>
    </select>
  );
}

/** Recursive node editor: groups (AND/OR), NOT wrappers and leaves. Every edit
 *  replaces exactly the addressed node — sibling branches are untouched. */
function NodeEditor({
  node,
  path,
  root,
  tags,
  owners,
  companies,
  stages,
  totalCount,
  onChange,
}: {
  node: SegmentNode;
  path: NodePath;
  root: SegmentNode;
  tags: MarketingTag[];
  owners: OwnerOpt[];
  companies: CompanyOpt[];
  stages: { stage_key: string; label: string; active: boolean }[];
  totalCount: number;
  onChange: (next: SegmentNode | null) => void;
}) {
  const depth = path.length;
  if ("op" in node && (node.op === "and" || node.op === "or")) {
    return (
      <div className="rounded-lg border border-hairline p-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={node.op}
            onChange={(e) => onChange(setGroupOp(root, path, e.target.value as "and" | "or"))}
            className={inputCls}
            aria-label="Group operator"
          >
            <option value="and">ALL of (AND)</option>
            <option value="or">ANY of (OR)</option>
          </select>
          <span className="text-muted-foreground">{node.children.length} condition(s)</span>
          <span className="ml-auto flex gap-2">
            {depth + 1 < MAX_DEPTH && totalCount + 1 <= 32 && (
              <button
                onClick={() =>
                  onChange(
                    replaceAt(root, path, {
                      op: node.op === "and" ? "or" : "and",
                      children: [node],
                    }),
                  )
                }
                className="text-muted-foreground underline"
                title="Wrap this group in a parent group"
              >
                wrap in group
              </button>
            )}
            <button
              onClick={() => onChange(removeAt(root, path))}
              aria-label="Remove group"
              className="text-muted-foreground underline"
            >
              remove
            </button>
          </span>
        </div>
        <div className="mt-2 space-y-2 border-l-2 border-hairline pl-2">
          {node.children.map((c, i) => (
            <NodeEditor
              key={i}
              node={c}
              path={[...path, i]}
              root={root}
              tags={tags}
              owners={owners}
              companies={companies}
              stages={stages}
              totalCount={totalCount}
              onChange={onChange}
            />
          ))}
        </div>
        {node.children.length < GROUP_MAX_CHILDREN && totalCount + 1 <= 32 && (
          <div className="mt-2">
            <AddCondition
              label={`Add to this ${node.op.toUpperCase()} group…`}
              disabledTags={tags.length === 0}
              onAdd={(kind) => {
                const map: Record<string, SegmentNode | null> = {
                  search: { field: "search", value: "" },
                  relationship: { field: "relationship", match: { status: "active" } },
                  company: { field: "company", value: companies[0]?.id ?? null },
                  tag: tags[0] ? { field: "tag", mode: "any", tag_ids: [tags[0].id] } : null,
                  eligibility: { field: "eligibility", channel: "email", value: "subscribed" },
                  created: {
                    field: "created",
                    from: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
                  },
                  last_contact: { field: "last_contact", never: true },
                };
                const leaf = map[kind];
                if (leaf) onChange(addChildAt(root, path, leaf));
              }}
            />
          </div>
        )}
      </div>
    );
  }
  if ("op" in node && node.op === "not") {
    return (
      <div className="rounded-lg border border-warning/40 p-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded bg-warning/10 px-1.5 py-0.5 font-medium">NOT</span>
          <button
            onClick={() => onChange(toggleNotAt(root, path))}
            className="text-muted-foreground underline"
          >
            un-negate
          </button>
          <button
            onClick={() => onChange(removeAt(root, path))}
            aria-label="Remove NOT condition"
            className="ml-auto text-muted-foreground underline"
          >
            remove
          </button>
        </div>
        <div className="mt-2 border-l-2 border-warning/30 pl-2">
          <NodeEditor
            node={node.child}
            path={[...path, 0]}
            root={root}
            tags={tags}
            owners={owners}
            companies={companies}
            stages={stages}
            totalCount={totalCount}
            onChange={onChange}
          />
        </div>
      </div>
    );
  }
  const leaf = node as Leaf;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline p-2 text-xs">
      <span className="text-muted-foreground">{leafSummary(leaf, tags, companies)}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <LeafEditor
          leaf={leaf}
          onChange={(l) => onChange(replaceAt(root, path, l))}
          tags={tags}
          owners={owners}
          companies={companies}
          stages={stages}
        />
        {depth + 1 < MAX_DEPTH && totalCount + 1 <= 32 && (
          <button
            onClick={() => onChange(toggleNotAt(root, path))}
            className="text-muted-foreground underline"
            title="Negate this condition"
          >
            NOT
          </button>
        )}
        <button onClick={() => onChange(removeAt(root, path))} aria-label="Remove condition">
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </span>
    </div>
  );
}

/** Server-backed company selector: bounded typeahead over `listCompanies`
 *  (usable beyond the first page). A SAVED company reference not present in
 *  the current results stays visible as the current selection and is
 *  PRESERVED — editing other conditions never rewrites it. */
function CompanySelect({
  value,
  initial,
  onChange,
}: {
  value: string | null;
  initial: CompanyOpt[];
  onChange: (v: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CompanyOpt[]>(initial);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(initial);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      void listCompanies(q).then((r) => {
        setSearching(false);
        if (r.ok) setResults(r.data.companies);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query, initial]);
  const known = results.find((c) => c.id === value);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search companies…"
        className={cn(inputCls, "w-36")}
        aria-label="Search companies"
      />
      <select
        value={value ?? "__none"}
        onChange={(e) => onChange(e.target.value === "__none" ? null : e.target.value)}
        className={inputCls}
      >
        <option value="__none">no company</option>
        {/* the saved reference is preserved even when not in the results page */}
        {value && !known && <option value={value}>(current selection)</option>}
        {results.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {searching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </span>
  );
}

function LeafEditor({
  leaf,
  onChange,
  tags,
  owners,
  companies,
  stages,
}: {
  leaf: Leaf;
  onChange: (l: Leaf) => void;
  tags: MarketingTag[];
  owners: OwnerOpt[];
  companies: CompanyOpt[];
  stages: { stage_key: string; label: string; active: boolean }[];
}) {
  switch (leaf.field) {
    case "search":
      return (
        <input
          value={leaf.value}
          onChange={(e) => onChange({ ...leaf, value: e.target.value })}
          placeholder="text"
          className={cn(inputCls, "w-36")}
        />
      );
    case "relationship":
      return (
        <span className="flex flex-wrap gap-1">
          <select
            value={leaf.match.lifecycle ?? ""}
            onChange={(e) =>
              onChange({
                ...leaf,
                match: { ...leaf.match, lifecycle: e.target.value || undefined },
              })
            }
            className={inputCls}
          >
            <option value="">any stage</option>
            {stages
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.stage_key} value={s.stage_key}>
                  {s.label}
                </option>
              ))}
          </select>
          <select
            value={leaf.match.status ?? ""}
            onChange={(e) =>
              onChange({
                ...leaf,
                match: { ...leaf.match, status: (e.target.value || undefined) as never },
              })
            }
            className={inputCls}
          >
            <option value="">any status</option>
            {["active", "inactive", "archived"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={leaf.match.type ?? ""}
            onChange={(e) =>
              onChange({ ...leaf, match: { ...leaf.match, type: e.target.value || undefined } })
            }
            className={inputCls}
          >
            <option value="">any type</option>
            {[
              "lead",
              "prospect",
              "customer",
              "former_customer",
              "supplier",
              "partner",
              "commercial",
              "other",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            value={leaf.match.source ?? ""}
            onChange={(e) =>
              onChange({ ...leaf, match: { ...leaf.match, source: e.target.value || undefined } })
            }
            className={inputCls}
          >
            <option value="">any source</option>
            {["discovery", "import", "manual", "ad_lead", "system"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={leaf.match.owner_id ?? ""}
            onChange={(e) =>
              onChange({
                ...leaf,
                match: { ...leaf.match, owner_id: e.target.value || undefined },
              })
            }
            className={inputCls}
          >
            <option value="">any owner</option>
            <option value="unassigned">unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
      );
    case "company":
      return (
        <CompanySelect
          value={leaf.value}
          initial={companies}
          onChange={(v) => onChange({ ...leaf, value: v })}
        />
      );
    case "tag":
      return (
        <span className="flex flex-wrap items-center gap-1">
          <select
            value={leaf.mode}
            onChange={(e) => onChange({ ...leaf, mode: e.target.value as never })}
            className={inputCls}
          >
            <option value="any">any of</option>
            <option value="all">all of</option>
            <option value="none">none of</option>
          </select>
          {/* MULTIPLE tags: bounded checkbox set (1-20) */}
          <span className="flex max-w-[300px] flex-wrap gap-1 rounded-lg border border-hairline p-1">
            {tags.map((t) => {
              const on = leaf.tag_ids.includes(t.id);
              return (
                <label key={t.id} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on
                        ? leaf.tag_ids.filter((id) => id !== t.id)
                        : [...leaf.tag_ids, t.id].slice(0, 20);
                      if (next.length >= 1) onChange({ ...leaf, tag_ids: next });
                    }}
                  />
                  {t.label}
                </label>
              );
            })}
          </span>
        </span>
      );
    case "eligibility":
      return (
        <span className="flex gap-1">
          <select
            value={leaf.channel}
            onChange={(e) => onChange({ ...leaf, channel: e.target.value as never })}
            className={inputCls}
          >
            <option value="email">email</option>
            <option value="phone">phone</option>
          </select>
          <select
            value={leaf.value}
            onChange={(e) => onChange({ ...leaf, value: e.target.value })}
            className={inputCls}
          >
            {[
              "subscribed",
              "unsubscribed",
              "suppressed",
              "unknown",
              "invalid",
              "no_contact_point",
            ].map((v) => (
              <option key={v} value={v}>
                {eligibilityLanguage(v).label}
              </option>
            ))}
          </select>
        </span>
      );
    case "created":
      return (
        <span className="flex items-center gap-1">
          <input
            type="date"
            value={leaf.from?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({
                ...leaf,
                from: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
              })
            }
            className={inputCls}
          />
          –
          <input
            type="date"
            value={leaf.to?.slice(0, 10) ?? ""}
            onChange={(e) =>
              onChange({ ...leaf, to: e.target.value ? `${e.target.value}T23:59:59Z` : undefined })
            }
            className={inputCls}
          />
        </span>
      );
    case "last_contact":
      return (
        <span className="flex items-center gap-1">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={leaf.never ?? false}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? { field: "last_contact", never: true }
                    : {
                        field: "last_contact",
                        from: `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
                      },
                )
              }
            />
            never
          </label>
          {!leaf.never && (
            <>
              <input
                type="date"
                value={leaf.from?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  onChange({
                    ...leaf,
                    from: e.target.value ? `${e.target.value}T00:00:00Z` : undefined,
                  })
                }
                className={inputCls}
              />
              –
              <input
                type="date"
                value={leaf.to?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  onChange({
                    ...leaf,
                    to: e.target.value ? `${e.target.value}T23:59:59Z` : undefined,
                  })
                }
                className={inputCls}
              />
            </>
          )}
        </span>
      );
    default:
      return null;
  }
}
