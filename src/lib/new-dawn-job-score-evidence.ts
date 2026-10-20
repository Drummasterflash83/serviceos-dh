import type { ClientJobRecord } from "./new-dawn-client-job-record.ts";
import type { OpenJobRow } from "./new-dawn-open-job-page.ts";

/** Draft M1 job rules from review pack 05. This is an evidence inventory, not
 * an approved policy or a measurement. No number may be derived from it. */
export const JOB_SCORE_EVIDENCE_RULES = [
  {
    key: "stage_progress",
    label: "Moving through the current stage",
    weight: 25,
    missing: "A dated stage entry and an agreed norm for that stage",
    next: "Confirm stage history and a comparable stage-time baseline",
  },
  {
    key: "owner_next_step",
    label: "Clear owner and next step",
    weight: 15,
    missing: "A confirmed responsible person, next step and due date",
    next: "Confirm the job owner, waiting person and dated next action",
  },
  {
    key: "commercial_close",
    label: "Commercial close",
    weight: 20,
    missing: "A verified INVOICE, QUOTE or FOC outcome, with reason and approver where required",
    next: "Link the approved closure outcome to this exact job",
  },
  {
    key: "invoice_timeliness",
    label: "Invoice after completion",
    weight: 15,
    missing: "Verified completion and invoice dates for the same job",
    next: "Link a confirmed invoice to the completed job",
  },
  {
    key: "job_evidence",
    label: "Labour, parts and required certificate evidence",
    weight: 10,
    missing: "Required labour, parts and certificate or SFG20 evidence for this job type",
    next: "Define the required evidence for this job and verify each source",
  },
  {
    key: "margin",
    label: "Job margin",
    weight: 10,
    missing: "Attributed revenue, costs and the agreed margin floor",
    next: "Verify job-level cost and invoice links before calculating margin",
  },
  {
    key: "customer_contact",
    label: "Customer kept informed",
    weight: 5,
    missing: "A job-attributed contact and its promised response window",
    next: "Confirm the contact-to-job link and the customer promise",
  },
] as const;

export type JobScoreEvidence = {
  key: (typeof JOB_SCORE_EVIDENCE_RULES)[number]["key"];
  label: string;
  proposedWeight: number;
  state: "source_fragment" | "missing" | "not_yet_applicable";
  sourceCue: string | null;
  missing: string;
  next: string;
};

/** Only an unchanged, audited saved job record can produce this inventory.
 * A source fragment is deliberately never treated as a confirmed measurement. */
export function inspectJobScoreEvidence(
  row: OpenJobRow,
  record: ClientJobRecord,
): JobScoreEvidence[] {
  const exact = row.identity_state === "reviewed_link" ? record.exactDetail : null;
  return JOB_SCORE_EVIDENCE_RULES.map((rule): JobScoreEvidence => {
    let state: JobScoreEvidence["state"] = "missing";
    let sourceCue: string | null = null;
    if (rule.key === "stage_progress" && exact?.stage?.trim()) {
      state = "source_fragment";
      sourceCue = "A current stage label was saved; its entry time and norm are unverified.";
    } else if (
      rule.key === "owner_next_step" &&
      (exact?.sourceUsers.length || exact?.holdReason?.trim())
    ) {
      state = "source_fragment";
      sourceCue =
        "Source people or a hold reason were saved; neither confirms an owner and due date.";
    } else if (
      (rule.key === "commercial_close" || rule.key === "invoice_timeliness") &&
      ["on_hold", "pending", "open"].includes(row.status)
    ) {
      state = "not_yet_applicable";
      sourceCue =
        "This job has a saved open status; its eventual close and invoice cannot be assessed yet.";
    }
    return {
      key: rule.key,
      label: rule.label,
      proposedWeight: rule.weight,
      state,
      sourceCue,
      missing: rule.missing,
      next: rule.next,
    };
  });
}
