import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  normalizeWorkCalendar,
  previewWorkCalendar,
  readWorkCalendar,
  validateWorkCalendar,
  type CalendarWindow,
  type WorkCalendarDefinition,
  type WorkCalendarPreview,
  type WorkCalendarRead,
} from "@/lib/learn-work-calendars";
import {
  calendarOutboxKey,
  prepareCalendarDraft,
  readCalendarDraft,
  recoverCalendarDraft,
  type CalendarDraft,
  type CalendarRecoveryLock,
  type CalendarRequest,
} from "@/lib/learn-work-calendar-outbox";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const empty = (): WorkCalendarDefinition => ({
  name: "",
  timezone: "",
  weekly: [],
  exceptions: [],
});
const clock = (n: number) =>
  Number.isFinite(n)
    ? `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : "";
const minute = (s: string) =>
  /^\d{2}:\d{2}(?::00(?:\.0+)?)?$/.test(s)
    ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
    : NaN;
const stamp = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
const recoveryLock: CalendarRecoveryLock = async (key, action) => {
  if (!navigator.locks)
    throw Error(
      "This browser cannot coordinate saved calendar requests. Use a browser with Web Locks support.",
    );
  return navigator.locks.request(key, action);
};
function Hours({
  windows,
  label,
  onChange,
}: {
  windows: CalendarWindow[];
  label: string;
  onChange: (next: CalendarWindow[]) => void;
}) {
  return (
    <div className="lwcal-hours">
      {!windows.length && <span className="lwcal-muted">Closed</span>}
      {windows.map((w, i) => (
        <div className="lwcal-window" key={i}>
          <label>
            From
            <input
              aria-label={`${label} window ${i + 1} starts`}
              type="time"
              step="60"
              value={clock(w.startMinute)}
              onInput={(e) =>
                onChange(
                  windows.map((v, n) =>
                    n === i ? { ...v, startMinute: minute(e.currentTarget.value) } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Until
            <input
              aria-label={`${label} window ${i + 1} ends`}
              type="time"
              step="60"
              disabled={w.endMinute === 1440}
              value={w.endMinute === 1440 ? "00:00" : clock(w.endMinute)}
              onInput={(e) =>
                onChange(
                  windows.map((v, n) =>
                    n === i ? { ...v, endMinute: minute(e.currentTarget.value) } : v,
                  ),
                )
              }
            />
          </label>
          <label className="lwcal-check">
            <input
              type="checkbox"
              checked={w.endMinute === 1440}
              onChange={(e) =>
                onChange(
                  windows.map((v, n) =>
                    n === i ? { ...v, endMinute: e.target.checked ? 1440 : NaN } : v,
                  ),
                )
              }
            />
            End of day
          </label>
          <button
            type="button"
            aria-label={`Remove ${label} window ${i + 1}`}
            onClick={() => onChange(windows.filter((_, n) => n !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={windows.length >= 12}
        onClick={() => onChange([...windows, { startMinute: NaN, endMinute: NaN }])}
      >
        Add {label} hours
      </button>
    </div>
  );
}
function CalendarSummary({ definition }: { definition: WorkCalendarDefinition }) {
  return (
    <div className="lwcal-summary">
      <p>
        <strong>{definition.name}</strong> · {definition.timezone}
      </p>
      <ul>
        {days.map((day, i) => (
          <li key={day}>
            {day}:{" "}
            {definition.weekly
              .filter((w) => w.day === i + 1)
              .map((w) => `${clock(w.startMinute)}–${clock(w.endMinute)}`)
              .join(", ") || "closed"}
          </li>
        ))}
      </ul>
      <p>{definition.exceptions.length} date overrides</p>
      {!!definition.exceptions.length && (
        <details>
          <summary>Review date overrides</summary>
          <ul>
            {definition.exceptions.map((e) => (
              <li key={e.date}>
                {e.date}:{" "}
                {e.windows.map((w) => `${clock(w.startMinute)}–${clock(w.endMinute)}`).join(", ") ||
                  "closed"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
/** Company-wide hours; writes remain separate from measurements and score review. */
export function LearnWorkCalendarSettings({
  tenantId,
  actorId,
  canEdit,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
}) {
  const scope = useMemo(
    () => ({ backend: supabaseConfig.url.replace(/\/$/, ""), actorId, tenantId }),
    [actorId, tenantId],
  );
  const [read, setRead] = useState<WorkCalendarRead | null>(null),
    [ready, setReady] = useState(false);
  const [definition, setDefinition] = useState<WorkCalendarDefinition>(empty),
    [saveReason, setSaveReason] = useState(""),
    [publishReason, setPublishReason] = useState("");
  const [pending, setPending] = useState<CalendarDraft | null>(null),
    [storageError, setStorageError] = useState("");
  const [message, setMessage] = useState("Reading company calendar…"),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [preview, setPreview] = useState<WorkCalendarPreview | null>(null),
    [previewTarget, setPreviewTarget] = useState("draft");
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10) + "T00:00"),
    [end, setEnd] = useState(
      () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T00:00",
    );
  const alive = useRef(false),
    access = useRef(canEdit),
    working = useRef(false),
    generation = useRef(0);
  access.current = canEdit;
  const allowed = () => alive.current && access.current;
  const syncPending = () => {
    try {
      const value = readCalendarDraft(localStorage, scope);
      setPending(value);
      setStorageError("");
      return value;
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Browser recovery details could not be read.",
      );
      return null;
    }
  };
  useEffect(() => {
    alive.current = true;
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === calendarOutboxKey(scope)) {
        generation.current++;
        syncPending();
        setReady(false);
        setMessage(
          "Calendar recovery details changed in another tab. Reload the current calendar before continuing.",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      alive.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [scope]);
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    setReady(false);
    if (!canEdit) {
      setRead(null);
      setDefinition(empty());
      setPending(null);
      return;
    }
    const retained = syncPending();
    void readWorkCalendar(getSupabaseClient(), tenantId)
      .then((value) => {
        if (!active || !allowed() || generation.current !== token) return;
        setRead(value);
        setReady(true);
        setDefinition(
          retained?.kind === "save"
            ? retained.payload.definition
            : (value.draft?.definition ?? empty()),
        );
        setMessage(
          retained
            ? "An earlier calendar request needs confirmation. Recover it before making another change."
            : "Calendar loaded. Saving a draft and publishing hours are separate actions.",
        );
      })
      .catch((error) => {
        if (active && allowed() && generation.current === token)
          setMessage(error instanceof Error ? error.message : "Calendar could not be read.");
      });
    return () => {
      active = false;
    };
  }, [tenantId, canEdit, scope, reload]);
  async function recover(draft: CalendarDraft, action: "submit" | "check" | "cancel") {
    if (working.current || !allowed()) return;
    const token = ++generation.current;
    const current = () => allowed() && generation.current === token;
    working.current = true;
    setBusy(true);
    try {
      const result = await recoverCalendarDraft(
        getSupabaseClient(),
        localStorage,
        recoveryLock,
        scope,
        draft,
        action,
        current,
      );
      if (!current()) return;
      syncPending();
      if (result.state === "pending")
        setMessage(
          "This request has not been recorded. Retry the original change or cancel the pending request.",
        );
      else {
        setMessage(
          result.state === "cancelled"
            ? "Pending request cancelled. Any delayed copy of it will be refused."
            : `${draft.kind === "save" ? "Calendar draft saved" : "Calendar published"}. Confirmed at ${stamp(result.recordedAt!)}.`,
        );
        setReady(false);
        try {
          const value = await readWorkCalendar(getSupabaseClient(), tenantId);
          if (!current()) return;
          setRead(value);
          setDefinition(value.draft?.definition ?? empty());
          setReady(true);
          setSaveReason("");
          setPublishReason("");
        } catch {
          if (current())
            setMessage(
              `The request is confirmed ${result.state}, but the current calendar could not be refreshed. Reload the saved calendar before making another change.`,
            );
        }
      }
    } catch (error) {
      if (current()) {
        syncPending();
        setMessage(error instanceof Error ? error.message : "Calendar outcome needs checking.");
      }
    } finally {
      working.current = false;
      if (allowed()) setBusy(false);
    }
  }
  function submit(request: CalendarRequest) {
    try {
      void recover(prepareCalendarDraft(scope, request), "submit");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check the calendar details.");
    }
  }
  async function runPreview() {
    const version = previewTarget === "published" ? read?.publication?.version : read?.draft;
    if (!version || working.current || !allowed()) return;
    const token = generation.current;
    const current = () => allowed() && generation.current === token;
    working.current = true;
    setBusy(true);
    try {
      const result = await previewWorkCalendar(getSupabaseClient(), tenantId, version.id, {
        start: start + "Z",
        end: end + "Z",
      });
      if (current()) {
        setPreview(result);
        setMessage(
          "Preview ready for the saved revision and dates shown below. This is a simulation.",
        );
      }
    } catch (error) {
      if (current())
        setMessage(
          (error instanceof Error ? error.message : "Preview unavailable.") +
            (preview
              ? " The previous preview remains labelled with its original dates and revision."
              : ""),
        );
    } finally {
      working.current = false;
      if (allowed()) setBusy(false);
    }
  }
  if (!canEdit)
    return <p role="status">Only a company owner or admin can manage working calendars.</p>;
  const errors = validateWorkCalendar(definition);
  const unchanged =
    !errors.length &&
    !!read?.draft &&
    JSON.stringify(normalizeWorkCalendar(definition)) === JSON.stringify(read.draft.definition);
  const editingDisabled = busy || !ready || !!pending || !!storageError;
  const unpublished = !!read?.draft && read.draft.id !== read.publication?.version.id;
  return (
    <div className="ls-settings lwcal-settings">
      <p>
        Company-wide opening hours provide the calendar for future working-time measures. They do
        not establish anyone's hours worked or change pay. Working-time scoring is still being
        connected.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {storageError && <p role="alert">{storageError}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setPreview(null);
          setReload((n) => n + 1);
        }}
      >
        Reload saved calendar
      </button>
      {pending && (
        <section className="ls-rule" aria-label="Calendar request recovery">
          <h3>Calendar {pending.kind === "save" ? "save" : "publication"} awaiting confirmation</h3>
          <p>Request {pending.requestId}</p>
          <p>Original reason: {pending.payload.reason}</p>
          {pending.kind === "save" ? (
            <>
              <p>Expected revision: {pending.payload.expectedRevision}</p>
              <CalendarSummary definition={pending.payload.definition} />
            </>
          ) : (
            <>
              <p>Saved version: {pending.payload.versionId}</p>
              <p>Expected earlier publication: {pending.payload.expectedPublication ?? "none"}</p>
            </>
          )}
          <p>
            Checking does not make the change. Cancellation stops an unrecorded request; an already
            recorded change is kept and reported.
          </p>
          <div className="ls-add">
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "check")}
            >
              Check request outcome
            </button>
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "submit")}
            >
              Retry original request
            </button>
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "cancel")}
            >
              Cancel pending request
            </button>
          </div>
        </section>
      )}
      <section className="ls-rule" aria-label="Published company calendar">
        <h3>Published hours</h3>
        {read?.publication ? (
          <>
            <p>
              Revision {read.publication.version.revision} · effective from{" "}
              {stamp(read.publication.effectiveFrom)}
            </p>
            <CalendarSummary definition={read.publication.version.definition} />
            <p>Publication reason: {read.publication.reason}</p>
          </>
        ) : (
          <p>
            {ready
              ? "No calendar has been published. Earlier time has no configured working hours."
              : "Published hours have not been confirmed."}
          </p>
        )}
        {!ready && read?.publication && (
          <p>Last confirmed view. Reload to check the current publication.</p>
        )}
      </section>
      <fieldset disabled={editingDisabled}>
        <legend>
          {read?.draft ? `Edit saved revision ${read.draft.revision}` : "Create a company calendar"}
        </legend>
        <p>
          {unchanged ? "Editor matches the saved revision." : "Unsaved editor changes."}{" "}
          {unpublished ? "The latest saved draft is not published." : ""}
        </p>
        <div className="ls-fields">
          <label>
            Calendar name
            <input
              maxLength={200}
              value={definition.name}
              onChange={(e) => setDefinition({ ...definition, name: e.target.value })}
            />
          </label>
          <label>
            Named timezone
            <input
              placeholder="For example, Europe/London"
              value={definition.timezone}
              onChange={(e) => setDefinition({ ...definition, timezone: e.target.value })}
            />
          </label>
        </div>
        <p>
          All hours below use this local timezone. Split overnight hours between dates. Days without
          windows are closed.
        </p>
        {days.map((day, i) => (
          <div className="lwcal-day" key={day}>
            <h4>{day}</h4>
            <Hours
              label={day}
              windows={definition.weekly.filter((w) => w.day === i + 1)}
              onChange={(windows) =>
                setDefinition({
                  ...definition,
                  weekly: [
                    ...definition.weekly.filter((w) => w.day !== i + 1),
                    ...windows.map((w) => ({ ...w, day: i + 1 })),
                  ],
                })
              }
            />
          </div>
        ))}
        <h4>Date overrides</h4>
        <p>An override replaces that date's weekly hours. Leave it empty for a closed date.</p>
        {definition.exceptions.map((exception, i) => (
          <div className="ls-rule" key={i}>
            <label>
              Override date
              <input
                aria-label={`Override ${i + 1} date`}
                type="date"
                min="2000-01-01"
                max="2200-12-31"
                value={exception.date}
                onInput={(e) =>
                  setDefinition({
                    ...definition,
                    exceptions: definition.exceptions.map((v, n) =>
                      n === i ? { ...v, date: e.currentTarget.value } : v,
                    ),
                  })
                }
              />
            </label>
            <Hours
              label={`override ${i + 1}`}
              windows={exception.windows}
              onChange={(windows) =>
                setDefinition({
                  ...definition,
                  exceptions: definition.exceptions.map((v, n) =>
                    n === i ? { ...v, windows } : v,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                setDefinition({
                  ...definition,
                  exceptions: definition.exceptions.filter((_, n) => n !== i),
                })
              }
            >
              Remove override {i + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={definition.exceptions.length >= 366}
          onClick={() =>
            setDefinition({
              ...definition,
              exceptions: [...definition.exceptions, { date: "", windows: [] }],
            })
          }
        >
          Add date override
        </button>
        {errors.length > 0 && (
          <ul className="lwcal-validation">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <label>
          Reason for saving draft
          <textarea
            maxLength={1000}
            value={saveReason}
            onChange={(e) => setSaveReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!!errors.length || !saveReason.trim() || unchanged}
          onClick={() =>
            submit({
              kind: "save",
              requestId: crypto.randomUUID(),
              payload: {
                expectedRevision: read?.draft?.revision ?? 0,
                definition,
                reason: saveReason,
              },
            })
          }
        >
          Save calendar draft
        </button>
      </fieldset>
      <section className="ls-rule" aria-label="Preview saved calendar">
        <h3>Preview saved hours</h3>
        <p>
          Preview uses a saved revision. Unsaved editor changes are excluded. Dates below are UTC
          boundaries; the end is exclusive.
        </p>
        <div className="ls-fields">
          <label>
            Saved version
            <select
              value={previewTarget}
              disabled={busy}
              onChange={(e) => setPreviewTarget(e.target.value)}
            >
              <option value="draft">Latest saved revision</option>
              <option value="published">Published revision</option>
            </select>
          </label>
          <span />
        </div>
        <div className="ls-fields">
          <label>
            Preview starts (UTC)
            <input
              type="datetime-local"
              value={start}
              onInput={(e) => setStart(e.currentTarget.value)}
              disabled={busy}
            />
          </label>
          <label>
            Preview ends (UTC)
            <input
              type="datetime-local"
              value={end}
              onInput={(e) => setEnd(e.currentTarget.value)}
              disabled={busy}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={
            busy || !ready || !(previewTarget === "published" ? read?.publication : read?.draft)
          }
          onClick={() => void runPreview()}
        >
          Preview saved hours
        </button>
        {preview && (
          <div className="lwcal-preview">
            <h4>Simulation · revision {preview.version.revision}</h4>
            <p>
              {stamp(preview.period.start)} to {stamp(preview.period.end)} (exclusive)
            </p>
            <p>
              <strong>
                {preview.minutes.toLocaleString("en-GB", { maximumFractionDigits: 4 })} eligible
                minutes
              </strong>{" "}
              · {preview.windows.length} {preview.windows.length === 1 ? "window" : "windows"} ·{" "}
              {preview.version.definition.timezone}
            </p>
            <details>
              <summary>Review all preview windows</summary>
              <ol>
                {preview.windows.map((w) => (
                  <li key={w.start}>
                    {stamp(w.start)} — {stamp(w.end)}
                  </li>
                ))}
              </ol>
              {!preview.windows.length && <p>No open windows within these dates.</p>}
            </details>
            <p>
              This applies the selected revision to the preview dates. It does not change historical
              rules or create a performance measurement.
            </p>
          </div>
        )}
      </section>
      <fieldset disabled={editingDisabled || !unpublished || !unchanged}>
        <legend>Publish saved calendar</legend>
        {read?.draft && (
          <p>
            Publish revision {read.draft.revision}: {read.draft.definition.name} ·{" "}
            {read.draft.definition.timezone}.
          </p>
        )}
        <p>
          Publishing starts these hours from the server's confirmation time. Previous dates and
          previously published hours remain unchanged. Review the saved hours and preview before
          publishing.
        </p>
        {!unchanged && (
          <p>Save or reload the editor so it matches the saved revision before publication.</p>
        )}
        <label>
          Reason for publishing
          <textarea
            maxLength={1000}
            value={publishReason}
            onChange={(e) => setPublishReason(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!publishReason.trim()}
          onClick={() =>
            read?.draft &&
            submit({
              kind: "publish",
              requestId: crypto.randomUUID(),
              payload: {
                versionId: read.draft.id,
                expectedPublication: read.publication?.id ?? null,
                reason: publishReason,
              },
            })
          }
        >
          Publish saved hours from now
        </button>
      </fieldset>
    </div>
  );
}
