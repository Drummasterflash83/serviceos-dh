/**
 * Contact imports — the existing universal preview-first data-import engine
 * driven for canonical contacts. Local CSV → RESOLVED PROFILE + genuine
 * column-mapping review (adjustments re-preview and are validated + SEALED
 * server-side) → PREVIEW (zero canonical writes) → explicit reviewed APPLY
 * against the sealed contract → durable per-row outcomes with retry of ONLY
 * the failed rows + bounded invalid/conflict downloads.
 * Requires effective marketing.contacts.import.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, FileUp, Loader2, RotateCcw, Upload } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import { listTags, type MarketingTag } from "@/lib/marketing/contacts";
import {
  previewContactImport,
  applyContactImport,
  listImports,
  listImportProfiles,
  listImportRowResults,
  type ImportPreview,
  type ImportProfileRow,
  type ImportRun,
  type ContactImportOptions,
} from "@/lib/marketing/imports";

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs outline-none focus:border-accent";
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB — bounded upload

interface ApplyOutcome {
  created: number;
  updated: number;
  conflicts: number;
  invalid: number;
  failed: number;
  skipped: number;
  status: string;
  importId: string;
}

export function MarketingImports() {
  const { access, can } = useMarketingAccess();
  const stages = access?.lifecycle_stages ?? [];
  const canImport = can("marketing.contacts.import");

  const [csvText, setCsvText] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [source, setSource] = useState("csv_upload");
  const [tagId, setTagId] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [relType, setRelType] = useState("");
  const [tags, setTags] = useState<MarketingTag[]>([]);
  const [profiles, setProfiles] = useState<ImportProfileRow[]>([]);
  const [profileId, setProfileId] = useState(""); // "" = automatic (unambiguous only)
  const [preview, setPreview] = useState<{ importId: string; p: ImportPreview } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});
  const [mappingDirty, setMappingDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ApplyOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportRun[] | null>(null);

  const reloadHistory = useCallback(async () => {
    const r = await listImports();
    if (r.ok) setHistory((r.data as { imports?: ImportRun[] }).imports ?? []);
  }, []);
  useEffect(() => {
    void reloadHistory();
    void listTags().then((r) => r.ok && setTags(r.data.tags));
    void listImportProfiles().then(
      (r) => r.ok && setProfiles((r.data as { profiles?: ImportProfileRow[] }).profiles ?? []),
    );
  }, [reloadHistory]);
  const contactProfiles = profiles.filter((p) => p.entity_type === "contacts");

  function onFile(file: File | null) {
    setError(null);
    setPreview(null);
    setResult(null);
    setOverrides({});
    setMappingDirty(false);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setError("Choose a .csv file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is too large (max 4 MB).");
      return;
    }
    void file.text().then((t) => {
      setCsvText(t);
      setFilename(file.name);
    });
  }

  async function runPreview(withOverrides = overrides) {
    if (!csvText || !filename) return;
    setPreviewing(true);
    setError(null);
    setResult(null);
    const options: ContactImportOptions = { source: source.trim().toLowerCase() };
    if (tagId) options.tag_id = tagId;
    if (lifecycle) options.lifecycle_stage_key = lifecycle;
    if (relType) options.relationship_type = relType;
    const chosen = contactProfiles.find((p) => p.id === profileId);
    const r = await previewContactImport({
      csv_text: csvText,
      filename,
      contact_options: options,
      // an explicit profile choice travels with its OWN source system so the
      // request always matches the profile it names
      ...(chosen ? { profile_id: chosen.id, source_system: chosen.source_system } : {}),
      ...(Object.keys(withOverrides).length ? { mapping_overrides: withOverrides } : {}),
    });
    setPreviewing(false);
    setMappingDirty(false);
    if (r.ok)
      setPreview({
        importId: (r.data as { import_id: string }).import_id,
        p: (r.data as { preview: ImportPreview }).preview,
      });
    else if (r.error.code === "profile_selection_required")
      setError(
        "Several eligible import profiles exist — choose one explicitly in the Profile selector, then preview again.",
      );
    else setError(r.error.message);
  }

  async function runApply(importId?: string) {
    const target = importId ?? preview?.importId;
    if (!target || !csvText) return;
    setApplying(true);
    setError(null);
    const r = await applyContactImport(target, csvText);
    setApplying(false);
    if (r.ok) {
      setResult({
        created: r.data.created,
        updated: r.data.updated,
        conflicts: r.data.conflicts,
        invalid: r.data.invalid,
        failed: r.data.failed,
        skipped: r.data.skipped,
        status: r.data.import?.status ?? (r.data.failed > 0 ? "failed" : "completed"),
        importId: target,
      });
      setPreview(null);
      await reloadHistory();
    } else setError(r.error.message);
  }

  async function downloadOutcomes(importId: string) {
    const r = await listImportRowResults(importId, ["invalid", "conflict", "failed"]);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    // bounded, PII-free: row number + outcome + reason + FIELD NAMES only
    const lines = [
      "row_number,outcome,reason,fields",
      ...r.data.rows.map(
        (row) =>
          `${row.row_number},${row.outcome},"${(row.reason ?? "").replaceAll('"', "'")}","${row.fields.join(";")}"`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `import-${importId.slice(0, 8)}-review.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!canImport)
    return (
      <div className="rounded-xl border border-hairline bg-white p-4 text-sm text-muted-foreground">
        Contact imports require the “import contacts” permission.
      </div>
    );

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Bring in your contacts from a CSV. Uploading never imports anything by itself — you always
        see a full preview of what would happen first, and nothing changes until you apply it.
      </p>
      <div className="max-w-2xl rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Importing someone does not subscribe them.
        </span>{" "}
        An imported contact starts with no marketing preference recorded, so campaigns exclude them
        until a real opt-in is recorded — ServiceOS never assumes consent from a spreadsheet.
      </div>

      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-1.5 font-medium hover:bg-surface-alt">
            <FileUp className="h-3.5 w-3.5" />
            {filename ?? "Choose CSV…"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="source slug"
            title="Provenance source (not a tag, not the import profile)"
            className={cn(inputCls, "w-32")}
          />
          {contactProfiles.length > 1 && (
            <select
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setPreview(null);
              }}
              title="Import profile — required explicitly when several are eligible"
              className={inputCls}
            >
              <option value="">Profile: automatic</option>
              {contactProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} v{p.version} ({p.tenant_id ? "tenant" : "platform"} · {p.source_system})
                </option>
              ))}
            </select>
          )}
          <select value={tagId} onChange={(e) => setTagId(e.target.value)} className={inputCls}>
            <option value="">No import tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                tag: {t.label}
              </option>
            ))}
          </select>
          <select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
            className={inputCls}
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
          <select value={relType} onChange={(e) => setRelType(e.target.value)} className={inputCls}>
            <option value="">Default relationship</option>
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
          <button
            disabled={
              !csvText || previewing || !/^[a-z0-9_-]{2,40}$/.test(source.trim().toLowerCase())
            }
            onClick={() => void runPreview()}
            className="inline-flex items-center gap-1 rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
          >
            {previewing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Preview
          </button>
        </div>
        {error && (
          <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-destructive" /> {error}
          </div>
        )}

        {preview && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="rounded-lg border border-hairline bg-surface-alt/50 px-3 py-2">
              <div>
                Profile:{" "}
                <span className="font-medium text-foreground">
                  {preview.p.profile.name} v{preview.p.profile.version}
                </span>{" "}
                ({preview.p.profile.tenant_owned ? "tenant" : "platform"} ·{" "}
                {preview.p.profile.source_system}) — sealed with this preview; apply uses exactly
                this profile, mapping and options.
              </div>
              {/* the EXACT resolved defaults under review — sealed now, so a
                  later settings change can never alter what apply does */}
              <div className="mt-1">
                Sealed defaults: stage{" "}
                <span className="font-medium text-foreground">
                  {stages.find(
                    (s) => s.stage_key === preview.p.contact_options?.lifecycle_stage_key,
                  )?.label ?? String(preview.p.contact_options?.lifecycle_stage_key ?? "—")}
                </span>{" "}
                · relationship{" "}
                <span className="font-medium text-foreground">
                  {String(preview.p.contact_options?.relationship_type ?? "—").replace("_", " ")}
                </span>
                {preview.p.contact_options?.tag_id ? (
                  <>
                    {" "}
                    · tag{" "}
                    <span className="font-medium text-foreground">
                      {tags.find((t) => t.id === preview.p.contact_options?.tag_id)?.label ??
                        "selected tag"}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            {preview.p.duplicate_upload && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                This exact file has been previewed or imported before — applying again is
                idempotent, but check the history below first.
              </div>
            )}
            {preview.p.missing_required.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
                Unmapped required columns: {preview.p.missing_required.join(", ")}
              </div>
            )}

            {/* GENUINE mapping review: adjust any canonical field → CSV column,
                then re-preview (adjustments are validated and sealed server-side) */}
            <details className="rounded-lg border border-hairline p-2" open={mappingDirty}>
              <summary className="cursor-pointer font-medium">
                Column mapping review ({Object.keys(preview.p.mapping).length} of{" "}
                {preview.p.profile.fields.length} fields mapped
                {preview.p.unmapped.length > 0 &&
                  ` · ${preview.p.unmapped.length} CSV column(s) ignored`}
                )
              </summary>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {preview.p.profile.fields.map((field) => {
                  const current =
                    overrides[field] !== undefined
                      ? overrides[field]
                      : (preview.p.mapping[field] ?? null);
                  return (
                    <label key={field} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px]">{field}</span>
                      <select
                        value={current === null ? "" : String(current)}
                        onChange={(e) => {
                          setOverrides((o) => ({
                            ...o,
                            [field]: e.target.value === "" ? null : Number(e.target.value),
                          }));
                          setMappingDirty(true);
                        }}
                        className={cn(inputCls, "w-44 py-1")}
                      >
                        <option value="">— not mapped —</option>
                        {preview.p.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `(column ${i + 1})`}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              {mappingDirty && (
                <button
                  disabled={previewing}
                  onClick={() => void runPreview()}
                  className="mt-2 rounded-lg border border-hairline bg-white px-3 py-1 font-medium"
                >
                  Re-preview with adjusted mapping
                </button>
              )}
            </details>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {(
                [
                  ["rows", preview.p.row_count],
                  ["valid", preview.p.valid],
                  ["invalid", preview.p.invalid],
                  ["will create", preview.p.will_create],
                  ["will update", preview.p.will_update],
                  ["conflicts", preview.p.will_conflict],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="rounded-lg border border-hairline p-2 text-center">
                  <div className="tabular text-sm font-semibold">{v}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
            {preview.p.sample.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full min-w-[520px] text-[11px]">
                  <thead>
                    <tr className="border-b border-hairline text-left text-muted-foreground">
                      <th className="px-2 py-1">Row</th>
                      <th className="px-2 py-1">Outcome</th>
                      <th className="px-2 py-1">Sample (masked)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.p.sample.map((s) => (
                      <tr key={s.row} className="border-b border-hairline/60 last:border-0">
                        <td className="px-2 py-1">{s.row}</td>
                        <td className="px-2 py-1">
                          {s.action} ({s.strategy})
                        </td>
                        <td className="truncate px-2 py-1 text-muted-foreground">
                          {Object.entries(s.preview)
                            .slice(0, 4)
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              disabled={applying || mappingDirty}
              title={mappingDirty ? "Re-preview with the adjusted mapping first" : undefined}
              onClick={() => void runApply()}
              className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
            >
              {applying ? "Applying…" : `Apply import (${preview.p.valid} valid rows)`}
            </button>
          </div>
        )}

        {result && (
          <div
            className={cn(
              "mt-3 rounded-lg border px-3 py-2 text-xs",
              result.failed > 0
                ? "border-warning/30 bg-warning/5"
                : "border-success/30 bg-success/5",
            )}
          >
            <div>
              {result.status === "completed" ? "Import completed" : "Import partially applied"} —
              cumulative totals: created {result.created}, updated {result.updated}, conflicts{" "}
              {result.conflicts}, invalid {result.invalid}
              {result.failed > 0 && `, failed ${result.failed}`}. Conflict rows are reviewable,
              tenant-safe identity records.
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {result.failed > 0 && (
                <button
                  disabled={applying}
                  onClick={() => void runApply(result.importId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2 py-1 font-medium"
                >
                  <RotateCcw className="h-3 w-3" /> Retry failed rows only
                </button>
              )}
              {(result.failed > 0 || result.invalid > 0 || result.conflicts > 0) && (
                <button
                  onClick={() => void downloadOutcomes(result.importId)}
                  className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2 py-1"
                >
                  <Download className="h-3 w-3" /> Download review rows
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="text-sm font-semibold">Recent imports</div>
        {!history && <div className="mt-2 text-xs text-muted-foreground">Loading…</div>}
        {history && history.length === 0 && (
          <div className="mt-2 text-xs text-muted-foreground">No imports yet.</div>
        )}
        {history && history.length > 0 && (
          <div className="mt-2 space-y-1 text-xs">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{h.original_filename ?? h.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">
                  {h.entity_type} · {h.status} · {h.row_count} rows · +{h.created_records} created ·{" "}
                  {h.updated_records} updated · {h.conflict_records} conflicts ·{" "}
                  {new Date(h.created_at).toLocaleString()}
                </span>
                {h.entity_type === "contacts" && h.status === "failed" && (
                  <span className="text-warning">
                    {h.failure ?? "has retryable failures"}
                    {csvText && (
                      <button
                        disabled={applying}
                        onClick={() => void runApply(h.id)}
                        className="ml-1 underline"
                        title="Retries only the failed rows — the selected file must be the previewed one (checksum-verified)"
                      >
                        retry with selected file
                      </button>
                    )}
                  </span>
                )}
                {h.entity_type === "contacts" &&
                  (h.invalid_rows > 0 || h.conflict_records > 0 || h.status === "failed") && (
                    <button
                      onClick={() => void downloadOutcomes(h.id)}
                      className="text-muted-foreground underline"
                    >
                      review rows
                    </button>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
