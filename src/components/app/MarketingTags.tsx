/**
 * Marketing Tags — tenant tag governance: list with real assignment counts,
 * create, rename, tone/description, deactivate/reactivate. Keys are immutable;
 * tags are never hard-deleted. Requires marketing.tags.manage.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import { createTag } from "@/lib/marketing/contacts";
import { callMarketingFn } from "@/lib/marketing/call";

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-accent";

interface AdminTag {
  id: string;
  key: string;
  label: string;
  tone: string;
  description: string | null;
  active: boolean;
  updated_at: string;
  assignment_count: number;
}

const listAdmin = () =>
  callMarketingFn<{ tags: AdminTag[] }>("marketing-contacts", { action: "tags_admin_list" });
const tagAdmin = (op: string, args: Record<string, unknown>) =>
  callMarketingFn<AdminTag>("marketing-contacts", { action: "tag_admin", op, args });

export function MarketingTags() {
  const { can } = useMarketingAccess();
  const canManage = can("marketing.tags.manage");
  const [tags, setTags] = useState<AdminTag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await listAdmin();
    if (r.ok) {
      setTags(r.data.tags);
      setError(null);
    } else setError(r.error.message);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(op: string, args: Record<string, unknown>) {
    setBusy(true);
    setNotice(null);
    const r = await tagAdmin(op, args);
    setBusy(false);
    if (r.ok) await reload();
    else if (r.error.code === "VERSION_CONFLICT") {
      setNotice("Tag changed elsewhere — reloaded.");
      await reload();
    } else setNotice(r.error.message);
  }

  if (!canManage)
    return (
      <div className="rounded-xl border border-hairline bg-white p-4 text-sm text-muted-foreground">
        Tag governance requires the “manage tags/segments” permission.
      </div>
    );
  if (error)
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <AlertTriangle className="mr-1 inline h-4 w-4 text-destructive" /> Tags unavailable —{" "}
        {error}
        <button onClick={() => void reload()} className="ml-2 text-xs underline">
          retry
        </button>
      </div>
    );
  if (!tags)
    return (
      <div className="grid min-h-[20vh] place-items-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        One tenant tag vocabulary — an explicit classification, distinct from sources, imports and
        segments. Keys are stable; deactivating a tag preserves every historical assignment.
      </p>
      {notice && <div className="text-xs text-muted-foreground">{notice}</div>}
      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="New tag label"
          className={cn(inputCls, "w-56")}
        />
        <button
          disabled={busy || !newLabel.trim()}
          onClick={() =>
            void createTag(newLabel.trim()).then(async (r) => {
              if (r.ok) {
                setNewLabel("");
                await reload();
              } else setNotice(r.error.message);
            })
          }
          className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Create
        </button>
      </div>
      {tags.length === 0 && (
        <div className="rounded-xl border border-hairline bg-white p-6 text-center text-sm text-muted-foreground">
          No tags yet.
        </div>
      )}
      <div className="space-y-1.5">
        {tags.map((t) => (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline bg-white p-2 text-xs"
          >
            <span
              className="w-28 truncate font-mono text-[10px] text-muted-foreground"
              title="Stable key (immutable)"
            >
              {t.key}
            </span>
            <input
              defaultValue={t.label}
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value.trim() !== t.label)
                  void run("rename", {
                    tag_id: t.id,
                    expected_updated_at: t.updated_at,
                    label: e.target.value.trim(),
                  });
              }}
              className={cn(inputCls, "w-40")}
            />
            <select
              value={t.tone}
              disabled={busy}
              onChange={(e) =>
                void run("set_tone", {
                  tag_id: t.id,
                  expected_updated_at: t.updated_at,
                  tone: e.target.value,
                })
              }
              className={inputCls}
            >
              {["neutral", "info", "positive", "attention", "negative"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              defaultValue={t.description ?? ""}
              placeholder="description"
              disabled={busy}
              onBlur={(e) => {
                if ((e.target.value.trim() || null) !== (t.description ?? null))
                  void run("set_description", {
                    tag_id: t.id,
                    expected_updated_at: t.updated_at,
                    description: e.target.value.trim(),
                  });
              }}
              className={cn(inputCls, "flex-1")}
            />
            <span className="tabular text-muted-foreground" title="Current assignments">
              {t.assignment_count} assigned
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void run(t.active ? "deactivate" : "reactivate", {
                  tag_id: t.id,
                  expected_updated_at: t.updated_at,
                })
              }
              className={cn("underline", t.active ? "text-destructive" : "")}
            >
              {t.active ? "deactivate" : "reactivate"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
