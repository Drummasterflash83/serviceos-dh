import { LearnScorecardPublication } from "./LearnScorecardPublication";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadScorecardDraft, saveScorecardDraft } from "@/lib/learn-scorecard-settings";
import {
  validateScorecardPolicy,
  type ScorecardPolicy,
  type ScoreMetricRule,
} from "@/lib/learn-scorecards";

const suggestions = [
  {
    key: "work.recorded_handoffs",
    label: "Recorded outgoing ownership handoffs (count, not quality)",
    unit: "handoffs",
    zeroAt: 0,
    fullAt: 10,
    source: "serviceos.work.handoffs@1",
  },
  {
    key: "response.within_target",
    label: "Responses within the agreed time",
    unit: "percent",
    zeroAt: 0,
    fullAt: 100,
    source: "communications",
  },
  {
    key: "work.desk_minutes",
    label: "Working minutes on a person's desk",
    unit: "minutes",
    zeroAt: 480,
    fullAt: 60,
    source: "job_workflow",
  },
  {
    key: "jobs.first_time_fix",
    label: "Jobs completed without a return visit",
    unit: "percent",
    zeroAt: 0,
    fullAt: 100,
    source: "commusoft",
  },
  {
    key: "jobs.on_time",
    label: "Jobs moved on within the agreed time",
    unit: "percent",
    zeroAt: 0,
    fullAt: 100,
    source: "commusoft",
  },
  {
    key: "driving.provider_score",
    label: "Driving score from the vehicle provider",
    unit: "provider_points",
    zeroAt: 0,
    fullAt: 100,
    source: "vehicle_telematics",
  },
] as const;

/** Draft-only configuration. Saving does not activate scores or change pay. */
export function LearnScorecardSettings({
  tenantId,
  groupId,
  canEdit,
}: {
  tenantId: string;
  groupId: string | null;
  canEdit: boolean;
}) {
  const [policy, setPolicy] = useState<ScorecardPolicy | null>(null),
    [expected, setExpected] = useState(0),
    [message, setMessage] = useState("Reading scoring rules…"),
    [reason, setReason] = useState("");
  const [savedPolicy, setSavedPolicy] = useState<ScorecardPolicy | null>(null);
  const [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setPolicy(null);
    setSavedPolicy(null);
    setMessage("Reading scoring rules…");
    void (async () => {
      try {
        const saved = await loadScorecardDraft(getSupabaseClient(), tenantId, "member", groupId);
        if (!active) return;
        setPolicy(
          saved ?? {
            tenantId,
            id: crypto.randomUUID(),
            version: 1,
            name: "Team performance",
            status: "draft",
            subjectKind: "member",
            groupId,
            scaleMax: 100,
            metrics: [],
          },
        );
        setSavedPolicy(saved);
        setExpected(saved?.version ?? 0);
        setReason("");
        setMessage(
          saved
            ? `Loaded revision ${saved.version}. Saving creates a new draft.`
            : "No scoring rules saved for this group. Choose the measures and weights you want to review.",
        );
      } catch {
        if (active) setMessage("Scoring rules could not be read. Reload to retry.");
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId, groupId, reload]);
  const update = (index: number, patch: Partial<ScoreMetricRule>) =>
    setPolicy((old) =>
      old
        ? {
            ...old,
            status: "draft",
            metrics: old.metrics.map((m, i) => (i === index ? { ...m, ...patch } : m)),
          }
        : old,
    );
  async function save() {
    if (!policy || busy || !canEdit) return;
    setBusy(true);
    try {
      const saved = await saveScorecardDraft(getSupabaseClient(), policy, expected, reason);
      setPolicy(saved);
      setSavedPolicy(saved);
      setExpected(saved.version);
      setReason("");
      setMessage(
        `Draft revision ${saved.version} saved. Scoring is not activated and no pay has changed.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Draft could not be saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ls-settings">
      <p>
        Choose the measures, weights and scoring scale for{" "}
        {groupId ? "this team group" : "all team members"}. These are draft rules for review.
        Evidence collection and live scoring are separate.
      </p>
      <p role="status">{message}</p>
      <button
        type="button"
        className="cp-secondary"
        disabled={busy}
        onClick={() => setReload((r) => r + 1)}
      >
        Reload saved rules
      </button>
      {policy && (
        <fieldset disabled={!canEdit || busy}>
          <legend>Scorecard rules</legend>
          <div className="ls-fields">
            <label>
              Scorecard name
              <input
                value={policy.name}
                onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
              />
            </label>
            <label>
              Score scale: 0 to
              <input
                type="number"
                min="1"
                max="10000"
                value={policy.scaleMax}
                onChange={(e) => setPolicy({ ...policy, scaleMax: Number(e.target.value) })}
              />
            </label>
          </div>
          <p>
            Template targets are suggestions. Set weights and review every target against your
            company's working practices and source definitions.
          </p>
          <div className="ls-add">
            <button
              type="button"
              className="cp-secondary"
              disabled={policy.metrics.length >= 50}
              onClick={() =>
                setPolicy({
                  ...policy,
                  metrics: [
                    ...policy.metrics,
                    {
                      key: `custom.${crypto.randomUUID()}`,
                      label: "Custom measure",
                      unit: "points",
                      weight: 0,
                      zeroAt: 0,
                      fullAt: 100,
                      minSamples: 5,
                      minCoverage: 1,
                      maxAgeHours: 24,
                      sourceSystems: ["source_to_confirm"],
                    },
                  ],
                })
              }
            >
              Add custom measure
            </button>
            {suggestions.map((s) => (
              <button
                type="button"
                className="cp-secondary"
                disabled={policy.metrics.some((m) => m.key === s.key)}
                key={s.key}
                onClick={() =>
                  setPolicy({
                    ...policy,
                    metrics: [
                      ...policy.metrics,
                      {
                        key: s.key,
                        label: s.label,
                        unit: s.unit,
                        zeroAt: s.zeroAt,
                        fullAt: s.fullAt,
                        weight: 0,
                        minSamples: 5,
                        minCoverage: 1,
                        maxAgeHours: 24,
                        sourceSystems: [s.source],
                      },
                    ],
                  })
                }
              >
                Add: {s.label}
              </button>
            ))}
          </div>
          {policy.metrics.map((m, i) => (
            <article className="ls-rule" key={m.key}>
              <h4>{m.label}</h4>
              <div className="ls-fields">
                <label>
                  Measure name
                  <input value={m.label} onChange={(e) => update(i, { label: e.target.value })} />
                </label>
                <label>
                  Weight
                  <input
                    type="number"
                    min="0"
                    value={m.weight}
                    onChange={(e) => update(i, { weight: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Measured value earning 0
                  <input
                    type="number"
                    value={m.zeroAt}
                    onChange={(e) => update(i, { zeroAt: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Measured value earning {policy.scaleMax}
                  <input
                    type="number"
                    value={m.fullAt}
                    onChange={(e) => update(i, { fullAt: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Unit
                  <input value={m.unit} onChange={(e) => update(i, { unit: e.target.value })} />
                </label>
                <label>
                  Minimum samples
                  <input
                    type="number"
                    min="1"
                    value={m.minSamples}
                    onChange={(e) => update(i, { minSamples: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Required coverage (%)
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={m.minCoverage * 100}
                    onChange={(e) => update(i, { minCoverage: Number(e.target.value) / 100 })}
                  />
                </label>
                <label>
                  Maximum measurement age (hours)
                  <input
                    type="number"
                    min="1"
                    value={m.maxAgeHours}
                    onChange={(e) => update(i, { maxAgeHours: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Accepted source names (comma separated)
                  <input
                    value={m.sourceSystems.join(",")}
                    onChange={(e) => update(i, { sourceSystems: e.target.value.split(",") })}
                  />
                </label>
              </div>
              <button
                type="button"
                className="cp-secondary"
                onClick={() =>
                  setPolicy({ ...policy, metrics: policy.metrics.filter((_, n) => n !== i) })
                }
              >
                Remove measure
              </button>
            </article>
          ))}
          <p>
            Total configured weight: {policy.metrics.reduce((n, m) => n + m.weight, 0)}. Weights are
            relative; missing required evidence withholds the total.
          </p>
          <label>
            Reason for this revision
            <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button"
            className="cp-secondary"
            disabled={busy || validateScorecardPolicy(policy).length > 0 || !reason.trim()}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save new draft revision"}
          </button>
        </fieldset>
      )}
      {canEdit && savedPolicy && (
        <LearnScorecardPublication
          key={`${savedPolicy.id}:${savedPolicy.version}`}
          policy={savedPolicy}
          unchanged={JSON.stringify(policy) === JSON.stringify(savedPolicy)}
        />
      )}
      {!canEdit && <p>Only a company owner or administrator can change these rules.</p>}
    </div>
  );
}
