// Governed marketing-permission capture — pure form logic + human vocabulary.
//
// ServiceOS records the ORGANISATION'S decision and evidence. It does not
// assume permission and does not decide whether contacting someone is lawful.
// This module holds the customer-friendly vocabulary and the client-side
// validation the guided dialog uses; the SQL layer re-proves everything.

export type PermissionDecision = "subscribed" | "unsubscribed";
export type PermissionBasis =
  "explicit_opt_in" | "existing_customer_documented" | "other_documented_basis";

export const PERMISSION_BULK_CAP = 100;

/** Customer-friendly labels for the controlled evidence vocabulary. */
export const PERMISSION_BASIS_LABELS: Record<PermissionBasis, string> = {
  explicit_opt_in: "They explicitly opted in",
  existing_customer_documented: "Existing-customer permission our organisation has documented",
  other_documented_basis: "Another documented basis our organisation has approved",
};

/** One extra sentence per basis so the choice is never a guess. */
export const PERMISSION_BASIS_HINTS: Record<PermissionBasis, string> = {
  explicit_opt_in:
    "They signed up themselves — a form, a written request, a recorded verbal opt-in.",
  existing_customer_documented:
    "Your organisation holds a documented permission from the customer relationship (for example a service contract that covers marketing).",
  other_documented_basis:
    "Your organisation has approved and documented another genuine basis. Record what it is.",
};

/** The sentence every permission surface shows, verbatim. */
export const PERMISSION_DISCLAIMER =
  "ServiceOS records your organisation's decision and evidence. It does not assume permission or decide whether you may legally contact someone.";

export interface PermissionFormInput {
  decision: PermissionDecision;
  basis?: string;
  evidence_method?: string;
  evidence_reference?: string;
  note?: string;
  /** ISO date or date-time; empty means "now" */
  effective_at?: string;
  attestation?: boolean;
}

export interface PermissionFormErrors {
  basis?: string;
  evidence_method?: string;
  evidence_reference?: string;
  note?: string;
  effective_at?: string;
  attestation?: string;
}

/** Validate the guided dialog. Returns {} when the form is ready to submit. */
export function validatePermissionForm(input: PermissionFormInput): PermissionFormErrors {
  const errors: PermissionFormErrors = {};
  const ref = (input.evidence_reference ?? "").trim();
  const note = (input.note ?? "").trim();
  if (ref.length > 500) errors.evidence_reference = "Keep the reference under 500 characters.";
  if (note.length > 500) errors.note = "Keep the note under 500 characters.";
  if (input.effective_at !== undefined && input.effective_at !== "") {
    const t = Date.parse(input.effective_at);
    if (Number.isNaN(t)) {
      errors.effective_at = "Enter a valid date.";
    } else if (t > Date.now() + 5 * 60 * 1000) {
      errors.effective_at = "The date a permission took effect cannot be in the future.";
    }
  }
  if (input.decision === "subscribed") {
    if (!input.basis || !(input.basis in PERMISSION_BASIS_LABELS)) {
      errors.basis = "Choose what genuinely happened.";
    }
    if ((input.evidence_method ?? "").trim().length < 2) {
      errors.evidence_method =
        "Say how the permission was given — e.g. “Signup form on our website”.";
    }
    if (ref.length < 2 && note.length < 2) {
      errors.evidence_reference =
        "Add a reference or a meaningful note so the evidence can be found later.";
    }
    if (input.attestation !== true) {
      errors.attestation = "Confirm this decision and evidence are genuine.";
    }
  }
  return errors;
}

/** Bounded, deduplicated bulk selection check. */
export function validateBulkSelection(personIds: string[]): {
  unique: string[];
  error?: string;
} {
  const unique = [...new Set(personIds)];
  if (unique.length < 1) return { unique, error: "Select at least one contact." };
  if (unique.length > PERMISSION_BULK_CAP) {
    return {
      unique,
      error: `Record permission for at most ${PERMISSION_BULK_CAP} contacts at a time.`,
    };
  }
  return { unique };
}

/** Browser-side request id: unique per submission attempt. */
export const newPermissionRequestId = () =>
  `prm-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
