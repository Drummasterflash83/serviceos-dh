import { useState } from "react";
import type {
  InputAccount,
  InputConnection,
  InputFlags,
  OperatorInputDefinition,
} from "@/lib/learn-operator-inputs";

/** Explicit bounded continuation; the server owns cursor and authority checks. */
export function OperatorCommusoftResume({
  account: a,
  connection: c,
  flags,
  disabled,
  approved,
  reason,
  onChange,
  onSubmit,
}: {
  account: InputAccount;
  connection: InputConnection | undefined;
  flags: InputFlags;
  disabled: boolean;
  approved: boolean;
  reason: string;
  onChange: () => void;
  onSubmit: (definition: OperatorInputDefinition) => void;
}) {
  const [maximum, setMaximum] = useState(
    Math.min(2147483647, Math.max(a.max_pages ?? 1, (a.checkpoint.pages ?? 0) + 10)),
  );
  const [hours, setHours] = useState(2);
  const j = a.latest_job;
  if (!a.approval_id || !j || a.checkpoint.complete === true) return null;
  if (!["succeeded", "dead_letter"].includes(j.status))
    return (
      <p className="text-sm">
        Existing work must settle before a continuation can be approved. An expired worker lease is
        recovered by the worker; it does not need a second import.
      </p>
    );
  const ready =
    c?.status === "configured" &&
    !c.revoked &&
    c.credential_bound &&
    !!c.verified_at &&
    ["uk", "us"].includes(c.region ?? "") &&
    a.status === "active" &&
    a.connector_enabled &&
    flags["learn.enabled"] === true &&
    flags["learn.inputs.commusoft.enabled"] === true;
  const valid =
    Number.isInteger(maximum) &&
    maximum > (a.checkpoint.pages ?? 0) &&
    maximum >= (a.max_pages ?? 1) &&
    maximum <= 2147483647 &&
    maximum - (a.checkpoint.pages ?? 0) <= 10000 &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= 24;
  return (
    <fieldset
      disabled={disabled}
      className="space-y-3 border-t pt-3"
      aria-label="Continue retained Commusoft import"
    >
      <legend className="font-semibold">Continue from saved position</legend>
      <p className="text-sm">
        Keep this collection and its {a.checkpoint.pages ?? 0} retained pages. Review the stop
        reason and connection before continuing. This queues another bounded read; it does not mark
        the import complete.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Maximum total pages
          <input
            className="cp-input w-full"
            type="number"
            min={Math.max(a.max_pages ?? 1, (a.checkpoint.pages ?? 0) + 1)}
            max={Math.min(2147483647, (a.checkpoint.pages ?? 0) + 10000)}
            value={maximum}
            onChange={(e) => {
              setMaximum(Number(e.target.value));
              onChange();
            }}
          />
        </label>
        <label>
          Continue approval for (hours)
          <input
            className="cp-input w-full"
            type="number"
            min={1}
            max={24}
            value={hours}
            onChange={(e) => {
              setHours(Number(e.target.value));
              onChange();
            }}
          />
        </label>
      </div>
      <p className="text-sm">
        The total includes pages already retained. The existing collection, contact type and records
        per page are preserved. Each continuation allows up to 10,000 further pages. Approval expiry
        will not be shortened.
      </p>
      <button
        className="cp-secondary"
        disabled={!ready || !valid || !approved || !reason.trim()}
        onClick={() => {
          if (!c || !a.approval_id || !ready || !valid) return;
          onSubmit({
            kind: "resume_commusoft",
            reason: reason.trim(),
            account_id: a.id,
            approval_id: a.approval_id,
            job_id: j.id,
            connection_id: c.id,
            revision: c.revision,
            checkpoint: a.checkpoint,
            max_pages: maximum,
            expires_at: new Date(
              Math.max(Date.now() + hours * 3600000, a.expires_at ? Date.parse(a.expires_at) : 0),
            ).toISOString(),
          });
        }}
      >
        Approve continuation
      </button>
      {!ready && (
        <p className="text-sm">
          Restore the module, account and verified connection before continuing.
        </p>
      )}
      {(a.checkpoint.pages ?? 0) >= 2147483647 && (
        <p className="text-sm">
          This traversal reached its maximum page allowance. Operator review is required before
          further capture.
        </p>
      )}
    </fieldset>
  );
}
