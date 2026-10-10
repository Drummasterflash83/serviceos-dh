import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadGovernedProfiles,
  loadGovernedImports,
  loadGovernedImport,
  loadGovernedOutcomes,
  previewGovernedImport,
  applyGovernedImport,
  importFileHash,
  importProgress,
  IMPORT_REQUEST_LIMIT,
  type GovernedProfile,
  type GovernedRun,
  type GovernedSavedRun,
  type GovernedOutcome,
} from "@/lib/learn-imports";

export function LearnFileImports({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const [profiles, setProfiles] = useState<GovernedProfile[]>([]),
    [runs, setRuns] = useState<GovernedRun[]>([]),
    [profileId, setProfileId] = useState("");
  const [saved, setSaved] = useState<GovernedSavedRun | null>(null),
    [outcomes, setOutcomes] = useState<GovernedOutcome[] | null>(null),
    [truncated, setTruncated] = useState(false);
  const [file, setFile] = useState<{ name: string; text: string; hash: string } | null>(null),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false);
  const generation = useRef(0),
    working = useRef(false);
  const db = getSupabaseClient();
  // Parent keys this view by actor/company/authority. Every async completion is
  // invalidated on unmount; a stale response cannot populate a different scope.
  useEffect(() => {
    working.current = false;
    void reload();
    return () => {
      generation.current++;
    };
  }, [tenantId]);
  async function operation(work: (ticket: number) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = ++generation.current;
    try {
      await work(ticket);
    } catch (e) {
      if (ticket === generation.current) {
        setReady(false);
        setNotice(e instanceof Error ? e.message : "Import evidence unavailable. Reload to check.");
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function reload() {
    await operation(async (ticket) => {
      setReady(false);
      setApproved(false);
      const [p, r] = await Promise.all([
        loadGovernedProfiles(db, tenantId),
        loadGovernedImports(db, tenantId),
      ]);
      if (ticket !== generation.current) return;
      setProfiles(p);
      setRuns(r);
      setReady(true);
      if (saved) await readSaved(saved.id, ticket);
    });
  }
  async function readSaved(id: string, ticket: number) {
    const r = await loadGovernedImport(db, tenantId, id);
    if (ticket !== generation.current) return;
    setSaved(r);
    setApproved(false);
    setOutcomes(null);
    if (canEdit) {
      const o = await loadGovernedOutcomes(db, tenantId, id);
      if (ticket !== generation.current) return;
      setOutcomes(o.rows);
      setTruncated(o.truncated);
    }
  }
  async function selectRun(id: string) {
    await operation(async (ticket) => {
      setSaved(null);
      setOutcomes(null);
      setApproved(false);
      await readSaved(id, ticket);
    });
  }
  async function selectFile(selected: File | null) {
    setFile(null);
    setApproved(false);
    if (!selected) return;
    await operation(async (ticket) => {
      if (selected.size > IMPORT_REQUEST_LIMIT)
        throw Error("Choose a CSV below 16 MiB. Split larger source files before previewing.");
      const text = await selected.text(),
        hash = await importFileHash(text);
      if (ticket === generation.current) setFile({ name: selected.name, text, hash });
    });
  }
  async function preview() {
    if (!canEdit || !file) return;
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    await operation(async (ticket) => {
      setSaved(null);
      setOutcomes(null);
      setApproved(false);
      const r = await previewGovernedImport(db, tenantId, profile, file.text, file.name);
      if (ticket !== generation.current) return;
      setSaved(r);
      setNotice("Preview saved. Review the counts and column mapping before applying.");
      const list = await loadGovernedImports(db, tenantId);
      if (ticket === generation.current) setRuns(list);
    });
  }
  async function apply() {
    if (!canEdit || !saved || !file || !approved) return;
    await operation(async (ticket) => {
      setApproved(false);
      const r = await applyGovernedImport(db, tenantId, saved, file.text);
      if (ticket !== generation.current) return;
      setSaved(r);
      await readSaved(r.id, ticket);
      const list = await loadGovernedImports(db, tenantId);
      if (ticket === generation.current) {
        setRuns(list);
        setNotice("Saved results reloaded. Check row outcomes for anything requiring attention.");
      }
    });
  }
  const p = saved?.preview,
    matched = !!saved && !!file && saved.file_checksum === file.hash;
  const mayApply =
    ready &&
    canEdit &&
    matched &&
    approved &&
    !busy &&
    saved &&
    ["previewed", "importing", "failed", "needs_review"].includes(saved.status);
  return (
    <div className="lr-file-imports">
      <p>
        Bring prepared customers, sites and jobs into your company. Import customers first, then
        sites, then jobs. Existing communications remain in place.
      </p>
      <p>
        Preview saves a review record; apply processes its rows. Keep the original CSV to continue a
        saved import. File contents are not saved in this browser.
      </p>
      <button className="cp-secondary" disabled={busy} onClick={() => void reload()}>
        Reload saved imports
      </button>
      {notice && (
        <p role="status" className="lr-notice">
          {notice}
        </p>
      )}
      {busy && <p role="status">Reading or processing the selected import…</p>}
      {!canEdit && (
        <p>
          Company owners and admins can preview and apply files. Saved import access is checked
          against your current company role.
        </p>
      )}
      <fieldset disabled={busy || !canEdit || !ready} className="lr-import-fields">
        <legend>Prepare a file</legend>
        <label>
          Import profile
          <select
            aria-label="Import profile"
            value={profileId}
            onChange={(e) => {
              setProfileId(e.target.value);
              setApproved(false);
            }}
          >
            <option value="">Choose a profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · v{profile.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prepared CSV
          <input
            aria-label="Prepared CSV"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void selectFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && (
          <p>
            {file.name} · {(new TextEncoder().encode(file.text).byteLength / 1024).toFixed(1)} KiB
            selected
          </p>
        )}
        <button
          className="cp-secondary"
          disabled={!profileId || !file}
          onClick={() => void preview()}
        >
          Save new preview
        </button>
      </fieldset>
      <section aria-label="Saved imports">
        <h3>Recent saved imports</h3>
        <p>
          Most recent 25. Select a saved import to inspect it or continue with its original file.
        </p>
        {ready && runs.length === 0 && <p>No saved governed imports.</p>}
        <div className="lr-import-list">
          {runs.map((run) => (
            <button
              className="cp-secondary"
              key={run.id}
              disabled={busy}
              onClick={() => void selectRun(run.id)}
              aria-pressed={saved?.id === run.id}
            >
              {run.original_filename || run.entity_type} · {importProgress(run)} ·{" "}
              {new Date(run.created_at).toLocaleString()}
            </button>
          ))}
        </div>
      </section>
      {saved && p && (
        <section aria-label="Saved import review">
          <h3>
            {saved.original_filename || "Saved import"} · {importProgress(saved)}
          </h3>
          <p>
            {p.profile.name} · version {p.profile.version} · {saved.source_system} ·{" "}
            {saved.entity_type}
          </p>
          <p>
            {p.row_count} source rows. Preview: {p.will_create} new, {p.will_update} matching,{" "}
            {p.will_hold} waiting for dependencies, {p.will_conflict} conflicting, {p.invalid}{" "}
            invalid.
          </p>
          {p.duplicate_upload && (
            <p className="lr-notice">
              This file has been previewed before. Inspect the earlier import before applying again.
            </p>
          )}
          <p>
            Saved results: {saved.created_records} created, {saved.updated_records} linked or
            updated, {saved.conflict_records} conflicting, {saved.invalid_rows} invalid,{" "}
            {saved.skipped_records} skipped or waiting.
          </p>
          {!!p.unmapped.length && (
            <p>Unmapped columns: {p.unmapped.join(", ")}. Their values are not imported.</p>
          )}
          <details>
            <summary>Review saved column mapping</summary>
            <div className="lr-import-table">
              <table>
                <thead>
                  <tr>
                    <th>Source column</th>
                    <th>Destination field</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(p.mapping).map(([field, index]) => (
                    <tr key={field}>
                      <td>{p.headers[index]}</td>
                      <td>{field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p>
            Conflicts and invalid rows need review. Waiting rows can be retried after their
            dependencies are imported. Corrected file contents require a new preview; the old
            outcomes remain recorded.
          </p>
          {canEdit && saved.status !== "completed" && (
            <div className="lr-import-approval">
              {!matched && (
                <p>Select the exact original CSV above to continue this saved import.</p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy || !matched}
                  onChange={(e) => setApproved(e.target.checked)}
                />{" "}
                I reviewed this saved preview and approve processing its rows.
              </label>
              <button className="cp-secondary" disabled={!mayApply} onClick={() => void apply()}>
                {saved.status === "previewed" ? "Apply reviewed import" : "Continue saved import"}
              </button>
              <p>
                If the response is interrupted, reload this saved import before continuing.
                Previously applied rows are retained.
              </p>
            </div>
          )}
          {canEdit && (
            <>
              <h4>Row outcomes</h4>
              {outcomes === null ? (
                <p>Reload this saved import to read its row outcomes.</p>
              ) : outcomes.length === 0 ? (
                <p>No row outcomes recorded yet.</p>
              ) : (
                <div className="lr-import-table">
                  <table>
                    <thead>
                      <tr>
                        <th>CSV row</th>
                        <th>Outcome</th>
                        <th>Reason</th>
                        <th>Attempt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcomes.map((row) => (
                        <tr key={row.row_number}>
                          <td>{row.row_number}</td>
                          <td>{row.outcome}</td>
                          <td>
                            {row.reason || "—"}
                            {row.fields.length ? ` (${row.fields.join(", ")})` : ""}
                          </td>
                          <td>{row.attempt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {truncated && (
                <p>Showing at most 1,000 outcomes; this is not the complete row ledger.</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
