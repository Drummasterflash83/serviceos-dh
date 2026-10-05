/**
 * Operations Centre navigation contract — shared so the Overview can request a
 * deep-link handoff into a detail surface without a circular import. The Centre
 * owns the section state; the Overview only emits a target.
 */

export type SectionKey =
  | "operations"
  | "communications"
  | "business"
  | "documents"
  | "calendar"
  | "ai"
  | "automations"
  | "users"
  | "settings";

/** A navigation request emitted by the Overview (e.g. a card's Settings/Sync). */
export interface OpsNavTarget {
  section: SectionKey;
  /** Communications surface to open (e.g. "email" | "phone"). */
  surface?: string;
  /** Sub-section for the surface to open/scroll to (e.g. "workspace-sync"). */
  focus?: string;
}

/** What the Communications section receives to drive a one-shot deep link. */
export interface CommsIntent {
  surface: string;
  focus: string;
  /** Bumps on every navigation so the same target re-applies when repeated. */
  nonce: number;
}
