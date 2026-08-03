/**
 * Marketing Contacts — the Phase-2 Contacts experience over the server-side
 * projection (marketing-contacts Edge Function → service-role SQL RPCs).
 *
 * Everything is a bounded server call: search, the full filter set, sort +
 * direction, keyset pagination, counts, detail, create/edit/classify, tags.
 * The browser never downloads the People table to join locally.
 *
 * Mutation safety mirrors the server contract: creates carry a caller-stable
 * idempotency key (kept across retries); classifies carry expected_version and
 * surface VERSION_CONFLICT as "changed elsewhere — reloaded"; ambiguous identity
 * asks the operator to choose, never silently merges; every mutation checks its
 * result and shows real errors. States are honest: busy, disabled, empty,
 * error+retry, conflict, success. Owners come only from the server directory.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Tag as TagIcon,
  UserPlus,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ApiResult } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import {
  AUDIENCE_ONBOARDING_STEPS,
  eligibilityLanguage,
} from "@/lib/marketing/eligibility-language";
import type { MarketingLifecycleStage } from "@/lib/marketing/access";
import {
  listContacts,
  getContactCounts,
  getContactDetail,
  createContact,
  classifyContact,
  updateContact,
  listTags,
  createTag,
  assignTag,
  removeTag,
  listOwners,
  listCompanies,
  bulkTagPreflight,
  bulkTagApply,
  type BulkTagCounts,
  type ContactListItem,
  type ContactListParams,
  type ContactCounts,
  type ContactDetail,
  type MarketingTag,
  type OwnerOption,
  type CreateResult,
} from "@/lib/marketing/contacts";

/* ── shared bits ── */

const ELIGIBILITY_TONE: Record<string, string> = {
  subscribed: "border-success/30 bg-success/10 text-success",
  unsubscribed: "border-warning/30 bg-warning/10 text-warning",
  suppressed: "border-destructive/30 bg-destructive/10 text-destructive",
  invalid: "border-destructive/30 bg-destructive/10 text-destructive",
  no_contact_point: "border-hairline bg-surface-alt text-muted-foreground",
  unknown: "border-hairline bg-surface-alt text-muted-foreground",
};

function EligibilityPill({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        ELIGIBILITY_TONE[value] ?? ELIGIBILITY_TONE.unknown,
      )}
    >
      {eligibilityLanguage(value).label}
    </span>
  );
}

function StagePill({
  stageKey,
  stages,
}: {
  stageKey: string | null;
  stages: MarketingLifecycleStage[];
}) {
  if (!stageKey) return <span className="text-xs text-muted-foreground">Unclassified</span>;
  const stage = stages.find((s) => s.stage_key === stageKey);
  const tone = stage?.tone ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "positive"
          ? "border-success/30 bg-success/10 text-success"
          : tone === "negative"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : tone === "attention"
              ? "border-warning/30 bg-warning/10 text-warning"
              : tone === "info"
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-hairline bg-surface-alt text-muted-foreground",
      )}
    >
      {stage?.label ?? stageKey}
    </span>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return "just now";
}

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-2 text-sm outline-none focus:border-accent";

/* ── main list ── */

export function MarketingContacts({ onGoToImports }: { onGoToImports?: () => void } = {}) {
  const { access, can } = useMarketingAccess();
  const stages = useMemo(() => access?.lifecycle_stages ?? [], [access]);

  const [items, setItems] = useState<ContactListItem[]>([]);
  const [cursor, setCursor] = useState<{ v: string | null; id: string } | null>(null);
  const [counts, setCounts] = useState<ContactCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [relStatus, setRelStatus] = useState("");
  const [relType, setRelType] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [companyOptions, setCompanyOptions] = useState<{ id: string; name: string }[]>([]);
  const [eligibility, setEligibility] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [classified, setClassified] = useState("");
  const [tagInclude, setTagInclude] = useState("");
  const [tagExclude, setTagExclude] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [contactFrom, setContactFrom] = useState("");
  const [contactTo, setContactTo] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [sort, setSort] = useState<"name" | "created" | "last_contact">("name");
  const [dir, setDir] = useState<"asc" | "desc" | "">("");

  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [allTags, setAllTags] = useState<MarketingTag[]>([]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // bounded multi-select bulk tagging (marketing.tags.manage)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [bulkOp, setBulkOp] = useState<"assign" | "remove">("assign");
  const [bulkPreflight, setBulkPreflight] = useState<BulkTagCounts | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  function toggleSelected(id: string) {
    setBulkPreflight(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 200) next.add(id);
      return next;
    });
  }

  async function runBulkPreflight() {
    if (!bulkTag || selected.size === 0) return;
    setBulkBusy(true);
    setBulkMsg(null);
    const r = await bulkTagPreflight(bulkOp, bulkTag, [...selected]);
    setBulkBusy(false);
    if (r.ok) setBulkPreflight(r.data);
    else setBulkMsg(r.error.message);
  }
  async function runBulkApply() {
    // apply is bound to its preflight by the server-issued contract: the same
    // tag, op and exact selection — anything else is rejected server-side
    if (!bulkTag || selected.size === 0 || !bulkPreflight?.contract) return;
    setBulkBusy(true);
    const r = await bulkTagApply(bulkOp, bulkTag, [...selected], bulkPreflight.contract);
    setBulkBusy(false);
    setBulkPreflight(null);
    if (r.ok) {
      setBulkMsg(
        `${bulkOp === "assign" ? "Tagged" : "Untagged"} ${r.data.applied ?? 0} contact(s)` +
          (r.data.rejected ? ` · ${r.data.rejected} rejected` : ""),
      );
      setSelected(new Set());
      void load(false, null);
    } else {
      if (r.error.code === "VERSION_CONFLICT")
        setBulkMsg("Selection changed since preflight — run preflight again.");
      else setBulkMsg(r.error.message);
    }
  }

  useEffect(() => {
    void listOwners().then((r) => r.ok && setOwners(r.data.owners));
    void listTags().then((r) => r.ok && setAllTags(r.data.tags));
  }, []);

  // Server-backed, bounded company options (never the whole table).
  useEffect(() => {
    const t = setTimeout(() => {
      void listCompanies(companySearch.trim() || undefined).then(
        (r) => r.ok && setCompanyOptions(r.data.companies),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [companySearch]);

  const params = useCallback((): ContactListParams => {
    const p: ContactListParams = { sort, limit: 25 };
    if (dir) p.dir = dir;
    if (search.trim()) p.search = search.trim();
    if (lifecycle) p.lifecycle = lifecycle;
    if (relStatus) p.relationship_status = relStatus as ContactListParams["relationship_status"];
    if (relType) p.relationship_type = relType;
    if (sourceFilter) p.source = sourceFilter;
    if (companyFilter) p.company_id = companyFilter;
    if (eligibility) p.eligibility = eligibility;
    if (ownerId) p.owner_id = ownerId;
    if (classified) p.classified = classified === "yes";
    if (tagInclude) p.tags_include = [tagInclude];
    if (tagExclude) p.tags_exclude = [tagExclude];
    if (createdFrom) p.created_from = new Date(createdFrom).toISOString();
    if (createdTo) p.created_to = new Date(`${createdTo}T23:59:59`).toISOString();
    if (contactFrom) p.last_contact_from = new Date(contactFrom).toISOString();
    if (contactTo) p.last_contact_to = new Date(`${contactTo}T23:59:59`).toISOString();
    return p;
  }, [
    sort,
    dir,
    search,
    lifecycle,
    relStatus,
    relType,
    sourceFilter,
    companyFilter,
    eligibility,
    ownerId,
    classified,
    tagInclude,
    tagExclude,
    createdFrom,
    createdTo,
    contactFrom,
    contactTo,
  ]);

  const load = useCallback(
    async (append = false, fromCursor: { v: string | null; id: string } | null = null) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const [listRes, countsRes] = await Promise.all([
        listContacts({ ...params(), cursor: fromCursor }),
        append ? Promise.resolve(null) : getContactCounts(),
      ]);
      if (!listRes.ok) {
        setError(listRes.error.message);
      } else {
        setItems((prev) => (append ? [...prev, ...listRes.data.items] : listRes.data.items));
        setCursor(listRes.data.next_cursor);
      }
      if (countsRes && countsRes.ok) setCounts(countsRes.data);
      setLoading(false);
      setLoadingMore(false);
    },
    [params],
  );

  useEffect(() => {
    void load(false, null);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-display text-xl font-semibold">Contacts</div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every person the business knows — one canonical record each, projected live from the
            same People the whole platform uses.
          </p>
        </div>
        {can("marketing.contacts.manage") && (
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            <UserPlus className="h-4 w-4" /> New contact
          </button>
        )}
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Contacts", value: counts.total },
            { label: "Classified", value: counts.classified },
            { label: "Unclassified", value: counts.unclassified },
            { label: "Suppressed", value: counts.suppressed },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-hairline bg-white p-3">
              <div className="tabular text-lg font-semibold text-foreground">{c.value}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {c.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Server-side search + filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone…"
              className={cn(inputCls, "w-64 pl-8")}
            />
          </div>
          <select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
            className={inputCls}
          >
            <option value="">All stages</option>
            {stages
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.stage_key} value={s.stage_key}>
                  {s.label}
                </option>
              ))}
          </select>
          <select
            value={eligibility}
            onChange={(e) => setEligibility(e.target.value)}
            className={inputCls}
          >
            <option value="">All eligibility</option>
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
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputCls}>
            <option value="">Any owner</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name ?? o.email ?? o.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className={inputCls}
          >
            <option value="name">Sort: name</option>
            <option value="created">Sort: created</option>
            <option value="last_contact">Sort: last contact</option>
          </select>
          <button
            onClick={() => setDir(dir === "asc" ? "desc" : dir === "desc" ? "" : "asc")}
            className={cn(inputCls, "inline-flex items-center gap-1")}
            title="Sort direction"
          >
            {dir === "asc" ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : dir === "desc" ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              "auto"
            )}
          </button>
          <button
            onClick={() => setMoreFilters((v) => !v)}
            className={cn(inputCls, "text-muted-foreground")}
          >
            {moreFilters ? "Fewer filters" : "More filters"}
          </button>
        </div>
        {moreFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={relStatus}
              onChange={(e) => setRelStatus(e.target.value)}
              className={inputCls}
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="archived">Archived</option>
            </select>
            <select
              value={relType}
              onChange={(e) => setRelType(e.target.value)}
              className={inputCls}
            >
              <option value="">Any type</option>
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
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className={inputCls}
            >
              <option value="">Any source</option>
              {["discovery", "manual", "import", "ad_lead", "system"].map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
            <span className="inline-flex items-center gap-1">
              <input
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Find company…"
                className={cn(inputCls, "w-32")}
              />
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className={inputCls}
              >
                <option value="">Any company</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </span>
            <select
              value={classified}
              onChange={(e) => setClassified(e.target.value)}
              className={inputCls}
            >
              <option value="">Classified + discovered</option>
              <option value="yes">Classified only</option>
              <option value="no">Discovered only</option>
            </select>
            <select
              value={tagInclude}
              onChange={(e) => setTagInclude(e.target.value)}
              className={inputCls}
            >
              <option value="">Tag: any</option>
              {allTags.map((t) => (
                <option key={t.id} value={t.id}>
                  has {t.label}
                </option>
              ))}
            </select>
            <select
              value={tagExclude}
              onChange={(e) => setTagExclude(e.target.value)}
              className={inputCls}
            >
              <option value="">Exclude tag: none</option>
              {allTags.map((t) => (
                <option key={t.id} value={t.id}>
                  not {t.label}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              created
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className={inputCls}
              />
              –
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              last contact
              <input
                type="date"
                value={contactFrom}
                onChange={(e) => setContactFrom(e.target.value)}
                className={inputCls}
              />
              –
              <input
                type="date"
                value={contactTo}
                onChange={(e) => setContactTo(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>
        )}
      </div>

      {loading && (
        <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading contacts…
          </span>
        </div>
      )}
      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Contacts unavailable
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <button
            onClick={() => void load(false, null)}
            className="mt-3 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium transition hover:bg-surface-alt"
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="grid min-h-[30vh] place-items-center">
          {search || lifecycle || eligibility || ownerId || moreFilters ? (
            <div className="max-w-sm text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
                <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-display mt-4 text-lg font-semibold">No contacts found</div>
              <p className="mt-1 text-sm text-muted-foreground">No contacts match these filters.</p>
            </div>
          ) : (
            <div className="w-full max-w-xl rounded-xl border border-hairline bg-white p-5">
              <div className="text-display text-lg font-semibold">Start your contact list</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Nobody is here yet. Here&apos;s the honest path from an empty list to a campaign
                that can actually send:
              </p>
              <ol className="mt-3 space-y-2">
                {AUDIENCE_ONBOARDING_STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-2 text-xs">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                      {i + 1}
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{s.title}.</span>{" "}
                      <span className="text-muted-foreground">{s.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                {can("marketing.contacts.manage") && (
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Add your first contact
                  </button>
                )}
                {can("marketing.contacts.import") && onGoToImports && (
                  <button
                    onClick={onGoToImports}
                    className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-alt"
                  >
                    Import contacts from a CSV
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* bounded bulk tagging: preflight → explicit confirmation → idempotent apply */}
      {can("marketing.tags.manage") && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-white p-3 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <span className="text-muted-foreground">(max 200)</span>
          <select
            value={bulkOp}
            onChange={(e) => {
              setBulkOp(e.target.value as "assign" | "remove");
              setBulkPreflight(null);
            }}
            className={inputCls}
          >
            <option value="assign">Add tag</option>
            <option value="remove">Remove tag</option>
          </select>
          <select
            value={bulkTag}
            onChange={(e) => {
              setBulkTag(e.target.value);
              setBulkPreflight(null);
            }}
            className={inputCls}
          >
            <option value="">Choose tag…</option>
            {allTags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {!bulkPreflight ? (
            <button
              disabled={bulkBusy || !bulkTag}
              onClick={() => void runBulkPreflight()}
              className="rounded-lg border border-hairline bg-white px-3 py-1.5 font-medium disabled:opacity-40"
            >
              {bulkBusy ? "Checking…" : "Preflight"}
            </button>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {bulkPreflight.applicable} to change · {bulkPreflight.already_assigned} already
                {bulkPreflight.rejected > 0 ? ` · ${bulkPreflight.rejected} rejected` : ""}
              </span>
              <button
                disabled={bulkBusy || bulkPreflight.applicable === 0}
                onClick={() => void runBulkApply()}
                className="rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
              >
                Confirm {bulkOp === "assign" ? "tagging" : "removal"}
              </button>
              <button onClick={() => setBulkPreflight(null)} className="underline">
                Cancel
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setSelected(new Set());
              setBulkPreflight(null);
            }}
            className="ml-auto text-muted-foreground underline"
          >
            Clear selection
          </button>
          {bulkMsg && <span className="w-full text-muted-foreground">{bulkMsg}</span>}
        </div>
      )}
      {bulkMsg && selected.size === 0 && (
        <div className="text-xs text-muted-foreground">{bulkMsg}</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {can("marketing.tags.manage") && <th className="w-8 px-2 py-2.5" />}
                <th className="px-4 py-2.5 font-medium">Person</th>
                <th className="px-4 py-2.5 font-medium">Company / type</th>
                <th className="px-4 py-2.5 font-medium">Lifecycle</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
                <th className="px-4 py-2.5 font-medium">Eligibility</th>
                <th className="px-4 py-2.5 font-medium">Last contact</th>
                <th
                  className="px-4 py-2.5 font-medium"
                  title="Campaign participation arrives with the Phase 5 campaign model"
                >
                  Campaigns
                </th>
                <th className="px-4 py-2.5 font-medium">Next action</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.person_id}
                  onClick={() => setDetailId(it.person_id)}
                  className="cursor-pointer border-b border-hairline/60 last:border-0 hover:bg-surface-alt/60"
                >
                  {can("marketing.tags.manage") && (
                    <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.person_id)}
                        onChange={() => toggleSelected(it.person_id)}
                        aria-label={`Select ${it.display_name ?? "person"}`}
                      />
                    </td>
                  )}
                  <td className="max-w-[220px] px-4 py-2.5">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailId(it.person_id);
                      }}
                      className="block max-w-full truncate text-left font-medium text-foreground underline decoration-hairline underline-offset-2 transition hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                    >
                      {it.display_name ?? "Unnamed person"}
                    </button>
                    <div className="truncate text-xs text-muted-foreground">
                      {it.primary_email ?? it.primary_phone ?? "no contact details"}
                    </div>
                  </td>
                  <td className="max-w-[160px] px-4 py-2.5">
                    <div className="truncate text-foreground">{it.company_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.relationship_type ?? "discovered"}
                      {it.relationship_status && it.relationship_status !== "active"
                        ? ` · ${it.relationship_status}`
                        : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <StagePill stageKey={it.lifecycle_stage_key} stages={stages} />
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {it.owner_name ?? <span className="text-muted-foreground">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <EligibilityPill value={it.eligibility} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {timeAgo(it.last_interaction_at)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">—</td>
                  <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-muted-foreground">
                    {it.next_action ?? "—"}
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className="border-t border-hairline p-3 text-center">
              <button
                onClick={() => void load(true, cursor)}
                disabled={loadingMore}
                className="rounded-lg border border-hairline bg-white px-4 py-1.5 text-xs font-medium transition hover:bg-surface-alt disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {detailId && (
        <ContactDetailDialog
          personId={detailId}
          stages={stages}
          owners={owners}
          canManage={can("marketing.contacts.manage")}
          canTags={can("marketing.tags.manage")}
          onClose={() => setDetailId(null)}
          onChanged={() => void load(false, null)}
          onOpenPerson={(id) => setDetailId(id)}
        />
      )}
      {createOpen && (
        <CreateContactDialog
          stages={stages}
          owners={owners}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void load(false, null);
          }}
          onOpenExisting={(id) => {
            setCreateOpen(false);
            setDetailId(id);
          }}
        />
      )}
    </div>
  );
}

/* ── detail + edit dialog ── */

function ContactDetailDialog({
  personId,
  stages,
  owners,
  canManage,
  canTags,
  onClose,
  onChanged,
  onOpenPerson,
}: {
  personId: string;
  stages: MarketingLifecycleStage[];
  owners: OwnerOption[];
  canManage: boolean;
  canTags: boolean;
  onClose: () => void;
  onChanged: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allTags, setAllTags] = useState<MarketingTag[]>([]);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [editOpen, setEditOpen] = useState(false);

  const reload = useCallback(async () => {
    const r = await getContactDetail(personId);
    if (r.ok) {
      setDetail(r.data);
      setError(null);
    } else setError(r.error.message);
  }, [personId]);

  useEffect(() => {
    void reload();
    if (canTags) void listTags().then((r) => r.ok && setAllTags(r.data.tags));
  }, [reload, canTags]);

  const rel =
    detail?.relationships?.find((x) => x.status === "active") ?? detail?.relationships?.[0] ?? null;

  async function applyClassify(changes: Parameters<typeof classifyContact>[1]) {
    setBusy(true);
    setNotice(null);
    const r = await classifyContact(personId, {
      ...changes,
      ...(rel ? { relationship_id: rel.id, expected_version: rel.version } : {}),
    });
    setBusy(false);
    if (r.ok) {
      await reload();
      onChanged();
    } else if (r.error.code === "VERSION_CONFLICT") {
      setNotice("This contact was changed elsewhere — the latest state has been reloaded.");
      await reload();
    } else {
      setError(`Change failed: ${r.error.message}`);
    }
  }

  async function tagOp(fn: () => Promise<ApiResult<unknown>>) {
    setNotice(null);
    const r = await fn();
    if (!r.ok) {
      setError(`Tag change failed: ${r.error.message}`);
      return;
    }
    await reload();
    onChanged();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {detail?.display_name ?? "Contact"}
            {canManage && detail && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-hairline p-1 text-muted-foreground hover:text-foreground"
                aria-label="Edit contact"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.company_name ?? "No company"} · source: ${detail.created_source ?? "unknown"} · ${detail.verified ? "verified" : "unverified"}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-muted-foreground">
            {error}
            <button
              onClick={() => {
                setError(null);
                void reload();
              }}
              className="ml-2 underline"
            >
              reload
            </button>
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
            {notice}
          </div>
        )}
        {!detail && !error && (
          <div className="grid min-h-[20vh] place-items-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-hairline p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Contact points
                </div>
                <div className="mt-2 space-y-1">
                  {detail.contact_points.length === 0 && (
                    <div className="text-xs text-muted-foreground">None recorded</div>
                  )}
                  {detail.contact_points.map((cp) => (
                    <div key={cp.id} className="flex items-center gap-2 text-xs">
                      <span className="w-12 uppercase text-muted-foreground">{cp.channel}</span>
                      <span className="truncate text-foreground">{cp.value}</span>
                      {cp.is_primary && (
                        <span className="rounded-full bg-surface-alt px-1.5 text-[10px]">
                          primary
                        </span>
                      )}
                      <EligibilityPill value={cp.eligibility} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-hairline p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Communication eligibility
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span>email</span> <EligibilityPill value={detail.eligibility.email} />
                  <span>phone</span> <EligibilityPill value={detail.eligibility.phone} />
                </div>
                {detail.suppressions.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {detail.suppressions.map((s) => (
                      <div key={s.id} className="text-[11px] text-destructive">
                        Suppressed — {s.scope}
                        {s.destination ? ` (${s.destination})` : ""} · {s.reason} · no bulk sends;
                        cannot be bypassed.
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-hairline p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Classification
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StagePill stageKey={rel?.lifecycle_stage_key ?? null} stages={stages} />
                <span className="text-xs text-muted-foreground">
                  {rel
                    ? `${rel.relationship_type} · ${rel.status} · owner: ${rel.owner_name ?? "unassigned"} · v${rel.version}`
                    : "Not yet classified"}
                </span>
                {canManage && (
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      disabled={busy}
                      value=""
                      onChange={(e) => {
                        if (e.target.value)
                          void applyClassify({ lifecycle_stage_key: e.target.value });
                      }}
                      className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Move to stage…</option>
                      {stages
                        .filter((s) => s.active)
                        .map((s) => (
                          <option key={s.stage_key} value={s.stage_key}>
                            {s.label}
                          </option>
                        ))}
                    </select>
                    <select
                      disabled={busy}
                      value=""
                      onChange={(e) => {
                        if (e.target.value === "__clear__")
                          void applyClassify({ clear_owner: true });
                        else if (e.target.value) void applyClassify({ owner_id: e.target.value });
                      }}
                      className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Assign owner…</option>
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.full_name ?? o.email}
                        </option>
                      ))}
                      <option value="__clear__">Unassign</option>
                    </select>
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-hairline p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <TagIcon className="h-3 w-3" /> Tags
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {detail.tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tags</span>
                )}
                {detail.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[11px]"
                  >
                    {t.label}
                    {canTags && (
                      <button
                        onClick={() => void tagOp(() => removeTag(personId, t.id))}
                        aria-label={`Remove ${t.label}`}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    )}
                  </span>
                ))}
                {canTags && (
                  <>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void tagOp(() => assignTag(personId, e.target.value));
                      }}
                      className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Add tag…</option>
                      {allTags
                        .filter((t) => !detail.tags.some((d) => d.id === t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                    </select>
                    <span className="inline-flex items-center gap-1">
                      <input
                        value={newTagLabel}
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        placeholder="New tag"
                        className="w-24 rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
                      />
                      <button
                        disabled={!newTagLabel.trim()}
                        onClick={() =>
                          void createTag(newTagLabel.trim()).then(async (r) => {
                            if (!r.ok) {
                              setError(`Tag creation failed: ${r.error.message}`);
                              return;
                            }
                            setNewTagLabel("");
                            const tr = await listTags();
                            if (tr.ok) setAllTags(tr.data.tags);
                            await tagOp(() => assignTag(personId, r.data.id));
                          })
                        }
                        className="rounded-lg border border-hairline bg-white p-1 disabled:opacity-40"
                        aria-label="Create tag"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-hairline p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Interaction history
              </div>
              {detail.interactions.length === 0 ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  No interactions recorded for this person yet.
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {detail.interactions.map((i) => (
                    <div key={i.id} className="flex items-start gap-2 text-xs">
                      <span
                        className={cn(
                          "mt-0.5 inline-flex rounded-full border px-1.5 text-[10px] uppercase",
                          i.direction === "inbound"
                            ? "border-accent/30 bg-accent/10 text-accent"
                            : "border-hairline bg-surface-alt text-muted-foreground",
                        )}
                      >
                        {i.direction}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {i.subject ?? i.interaction_type}
                        </div>
                        <div className="text-muted-foreground">
                          {i.summary ?? i.interaction_type} · {timeAgo(i.occurred_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {detail.customer_card && (
              <div className="rounded-lg border border-hairline bg-surface-alt/50 p-3 text-xs">
                <span className="font-semibold text-foreground">Customer Card:</span> status{" "}
                {detail.customer_card.status} · priority {detail.customer_card.priority}
                {detail.customer_card.recommended_action
                  ? ` · next: ${detail.customer_card.recommended_action}`
                  : ""}
              </div>
            )}
          </div>
        )}

        {editOpen && detail && (
          <EditContactDialog
            detail={detail}
            rel={rel}
            owners={owners}
            onClose={() => setEditOpen(false)}
            onSaved={async () => {
              setEditOpen(false);
              await reload();
              onChanged();
            }}
            onConflict={async () => {
              setEditOpen(false);
              setNotice("This contact was changed elsewhere — the latest state has been reloaded.");
              await reload();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── edit dialog ── */

function EditContactDialog({
  detail,
  rel,
  owners,
  onClose,
  onSaved,
  onConflict,
}: {
  detail: ContactDetail;
  rel: ContactDetail["relationships"][number] | null;
  owners: OwnerOption[];
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const { access } = useMarketingAccess();
  const stages = access?.lifecycle_stages ?? [];
  const [displayName, setDisplayName] = useState(detail.display_name ?? "");
  const [firstName, setFirstName] = useState(
    (detail as Record<string, string | null>).first_name ?? "",
  );
  const [lastName, setLastName] = useState(
    (detail as Record<string, string | null>).last_name ?? "",
  );
  const [companyId, setCompanyId] = useState(detail.company_id ?? "");
  const [companySearch, setCompanySearch] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [ownerId, setOwnerId] = useState(rel?.owner_id ?? "");
  const [relStatus, setRelStatus] = useState(rel?.status ?? "active");
  const [relLifecycle, setRelLifecycle] = useState(rel?.lifecycle_stage_key ?? "");
  const [relType, setRelType] = useState(rel?.relationship_type ?? "");
  const [newChannel, setNewChannel] = useState("email");
  const [newValue, setNewValue] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);
  const [cpEdits, setCpEdits] = useState<
    Record<string, { value?: string; label?: string; make_primary?: boolean }>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-backed, bounded, SEARCHABLE company directory.
  useEffect(() => {
    const t = setTimeout(() => {
      void listCompanies(companySearch.trim() || undefined).then(
        (r) => r.ok && setCompanies(r.data.companies),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [companySearch]);

  async function save() {
    setBusy(true);
    setError(null);
    const changes: Parameters<typeof updateContact>[1] = {};
    if (!detail.verified) {
      const person: NonNullable<typeof changes.person> = {};
      if (displayName !== (detail.display_name ?? "")) person.display_name = displayName;
      if (firstName !== ((detail as Record<string, string | null>).first_name ?? ""))
        person.first_name = firstName;
      if (lastName !== ((detail as Record<string, string | null>).last_name ?? ""))
        person.last_name = lastName;
      if (companyId !== (detail.company_id ?? "")) {
        if (companyId) person.company_id = companyId;
        else person.clear_company = true;
      }
      if (Object.keys(person).length > 0) changes.person = person;
    }
    const cpChanges: NonNullable<typeof changes.contact_points> = {};
    if (newValue.trim()) {
      cpChanges.add = [{ channel: newChannel, value: newValue.trim(), make_primary: newPrimary }];
    }
    const updates = Object.entries(cpEdits)
      .map(([id, e]) => {
        const cp = detail.contact_points.find((c) => c.id === id);
        if (!cp) return null;
        const u: {
          id: string;
          expected_updated_at: string;
          value?: string;
          label?: string;
          make_primary?: boolean;
        } = { id, expected_updated_at: cp.updated_at };
        if (e.value !== undefined && e.value !== cp.value) u.value = e.value;
        if (e.label !== undefined && e.label !== (cp.label ?? "")) u.label = e.label;
        if (e.make_primary) u.make_primary = true;
        return u.value !== undefined || u.label !== undefined || u.make_primary ? u : null;
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);
    if (updates.length > 0) cpChanges.update = updates;
    if (Object.keys(cpChanges).length > 0) changes.contact_points = cpChanges;

    const relationship: NonNullable<typeof changes.relationship> = {};
    if (rel) {
      if (ownerId !== (rel.owner_id ?? "")) {
        if (ownerId) relationship.owner_id = ownerId;
        else relationship.clear_owner = true;
      }
      if (relStatus !== rel.status) relationship.status = relStatus;
      if (relLifecycle && relLifecycle !== rel.lifecycle_stage_key)
        relationship.lifecycle_stage_key = relLifecycle;
      if (relType && relType !== rel.relationship_type) relationship.relationship_type = relType;
      if (Object.keys(relationship).length > 0) {
        relationship.relationship_id = rel.id;
        relationship.expected_version = rel.version;
        changes.relationship = relationship;
      }
    }
    if (Object.keys(changes).length === 0) {
      setBusy(false);
      setError("No changes to save");
      return;
    }
    const r = await updateContact(detail.person_id, changes);
    setBusy(false);
    if (r.ok) onSaved();
    else if (r.error.code === "VERSION_CONFLICT") onConflict();
    else if (r.error.code === "PROTECTED_FIELD")
      setError(
        "A value is source-authoritative (verified or evidence-sourced) and cannot be edited.",
      );
    else setError(r.error.message);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
          <DialogDescription>
            {detail.verified
              ? "Identity fields are verified (source-authoritative) — contact points and classification remain editable."
              : "Edits are audited. Verified or evidence-sourced values are protected."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!detail.verified && (
            <>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className={cn(inputCls, "w-full")}
              />
              <div className="flex gap-2">
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className={cn(inputCls, "w-1/2")}
                />
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className={cn(inputCls, "w-1/2")}
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Search companies…"
                  className={cn(inputCls, "w-1/2")}
                />
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className={cn(inputCls, "w-1/2")}
                >
                  <option value="">No company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {rel && (
            <div className="space-y-2 rounded-lg border border-hairline p-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Relationship (v{rel.version})
              </div>
              <div className="flex gap-2">
                <select
                  value={relLifecycle}
                  onChange={(e) => setRelLifecycle(e.target.value)}
                  className={cn(inputCls, "w-1/2")}
                >
                  {stages
                    .filter((st) => st.active)
                    .map((st) => (
                      <option key={st.stage_key} value={st.stage_key}>
                        {st.label}
                      </option>
                    ))}
                </select>
                <select
                  value={relType}
                  onChange={(e) => setRelType(e.target.value)}
                  className={cn(inputCls, "w-1/2")}
                >
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
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className={cn(inputCls, "w-1/2")}
                >
                  <option value="">Unassigned</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name ?? o.email}
                    </option>
                  ))}
                </select>
                <select
                  value={relStatus}
                  onChange={(e) => setRelStatus(e.target.value)}
                  className={cn(inputCls, "w-1/2")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
          )}

          {/* existing contact points: editable when not protected */}
          {detail.contact_points.length > 0 && (
            <div className="space-y-2 rounded-lg border border-hairline p-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Contact points
              </div>
              {detail.contact_points.map((cp) => (
                <div key={cp.id} className="flex items-center gap-2 text-xs">
                  <span className="w-12 uppercase text-muted-foreground">{cp.channel}</span>
                  {cp.protected ? (
                    <span
                      className="flex-1 truncate text-muted-foreground"
                      title="Verified or evidence-sourced — value cannot be edited"
                    >
                      {cp.value} · protected
                    </span>
                  ) : (
                    <input
                      defaultValue={cp.value}
                      onChange={(e) =>
                        setCpEdits((prev) => ({
                          ...prev,
                          [cp.id]: { ...prev[cp.id], value: e.target.value },
                        }))
                      }
                      className={cn(inputCls, "flex-1 py-1")}
                    />
                  )}
                  <input
                    defaultValue={cp.label ?? ""}
                    placeholder="label"
                    onChange={(e) =>
                      setCpEdits((prev) => ({
                        ...prev,
                        [cp.id]: { ...prev[cp.id], label: e.target.value },
                      }))
                    }
                    className={cn(inputCls, "w-20 py-1")}
                  />
                  <label className="flex items-center gap-1 text-muted-foreground">
                    <input
                      type="checkbox"
                      defaultChecked={cp.is_primary}
                      disabled={cp.is_primary}
                      onChange={(e) =>
                        setCpEdits((prev) => ({
                          ...prev,
                          [cp.id]: { ...prev[cp.id], make_primary: e.target.checked },
                        }))
                      }
                    />
                    primary
                  </label>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-hairline p-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Add contact point
            </div>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
                className={inputCls}
              >
                {["email", "phone", "sms", "whatsapp"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value"
                className={cn(inputCls, "flex-1")}
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newPrimary}
                  onChange={(e) => setNewPrimary(e.target.checked)}
                />
                primary
              </label>
            </div>
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              {error}
            </div>
          )}
          <button
            onClick={() => void save()}
            disabled={busy}
            className="w-full rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── create dialog (fingerprint-aware idempotency; ambiguity asks the operator) ── */

function CreateContactDialog({
  stages,
  owners,
  onClose,
  onCreated,
  onOpenExisting,
}: {
  stages: MarketingLifecycleStage[];
  owners: OwnerOption[];
  onClose: () => void;
  onCreated: () => void;
  onOpenExisting: (personId: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  // Idempotency key lifecycle: one key per MATERIAL attempt. A transport-failure
  // retry reuses the key; editing any input starts a new attempt with a NEW key
  // (the server's fingerprint binding would reject the old one anyway). After an
  // existing/ambiguous verdict the form freezes until "Start another attempt".
  const [idemKey, setIdemKey] = useState<string>(() => crypto.randomUUID());
  const [submittedFp, setSubmittedFp] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);

  const fingerprint = JSON.stringify({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.trim(),
    stage,
    ownerId,
  });

  function resetAttempt() {
    setIdemKey(crypto.randomUUID());
    setSubmittedFp(null);
    setResult(null);
    setError(null);
    setFrozen(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    // Inputs changed since the last submit → this is a NEW material attempt.
    let key = idemKey;
    if (submittedFp !== null && submittedFp !== fingerprint) {
      key = crypto.randomUUID();
      setIdemKey(key);
    }
    setSubmittedFp(fingerprint);
    const r = await createContact(
      {
        display_name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        lifecycle_stage_key: stage || undefined,
        owner_id: ownerId || undefined,
      },
      key,
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return; // retry button reuses the SAME key for this same request
    }
    if (r.data.created) {
      onCreated();
      return;
    }
    setResult(r.data);
    setFrozen(true); // freeze inputs — operator must choose or start a new attempt
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New contact</DialogTitle>
          <DialogDescription>
            Creates a canonical Person with a marketing relationship. Matching identities are
            surfaced for review — never silently merged, never arbitrarily chosen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name *"
            disabled={frozen}
            className={cn(inputCls, "w-full disabled:opacity-60")}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            disabled={frozen}
            className={cn(inputCls, "w-full disabled:opacity-60")}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            disabled={frozen}
            className={cn(inputCls, "w-full disabled:opacity-60")}
          />
          <div className="flex gap-2">
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              disabled={frozen}
              className={cn(inputCls, "w-1/2 disabled:opacity-60")}
            >
              <option value="">Default stage</option>
              {stages
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.stage_key} value={s.stage_key}>
                    {s.label}
                  </option>
                ))}
            </select>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={frozen}
              className={cn(inputCls, "w-1/2 disabled:opacity-60")}
            >
              <option value="">No owner</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.full_name ?? o.email}
                </option>
              ))}
            </select>
          </div>

          {result?.status === "existing" && result.candidate && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
              <div className="font-medium text-foreground">
                This {result.candidate.matched_on.join(" and ")} already belongs to{" "}
                {result.candidate.display_name ?? "an existing contact"}.
              </div>
              <p className="mt-1 text-muted-foreground">
                Nothing was created. Open the existing contact instead of duplicating it.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onOpenExisting(result.candidate!.person_id)}
                  className="rounded-lg border border-hairline bg-white px-3 py-1.5 font-medium"
                >
                  Open existing contact
                </button>
                <button
                  onClick={resetAttempt}
                  className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-muted-foreground"
                >
                  Start another attempt
                </button>
              </div>
            </div>
          )}
          {result?.status === "ambiguous" && result.candidates && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
              <div className="font-medium text-foreground">
                Several contacts share{" "}
                {result.truncated ? "these identifiers (list truncated)" : "these identifiers"} —
                choose one to open, or ask an admin to resolve the identity review.
              </div>
              <div className="mt-2 space-y-1">
                {result.candidates.map((c) => (
                  <button
                    key={c.person_id}
                    onClick={() => onOpenExisting(c.person_id)}
                    className="block w-full rounded-lg border border-hairline bg-white px-3 py-1.5 text-left font-medium hover:bg-surface-alt"
                  >
                    {c.display_name ?? c.person_id.slice(0, 8)}{" "}
                    <span className="font-normal text-muted-foreground">
                      (matched on {c.matched_on.join(", ")})
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-muted-foreground">
                A review record was saved; nothing was created or merged.
              </p>
              <button
                onClick={resetAttempt}
                className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1.5 text-muted-foreground"
              >
                Start another attempt
              </button>
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              {error}
            </div>
          )}
          <button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || frozen}
            className="w-full rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? "Creating…"
              : error && submittedFp === fingerprint
                ? "Retry (same request)"
                : "Create contact"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
