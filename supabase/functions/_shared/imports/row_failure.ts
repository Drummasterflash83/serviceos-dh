// ServiceOS — Phase 11N: honest classification of a row-apply failure.
//
// Phase 11M recorded 262 deterministic unique-constraint violations as
// "transient row apply failure". They were not transient: the same rows would
// have failed identically for ever. Calling a permanent defect transient invites
// a pointless retry and hides a real bug behind a word that means "try again".
//
// The classifier reads the SQLSTATE only. It never reads the driver's message,
// because a Postgres error message can quote the offending VALUES — i.e. customer
// data — and these reasons are written to a durable ledger.

/** SQLSTATEs that genuinely resolve on their own if the row is re-applied. */
const TRANSIENT_SQLSTATES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "55P03", // lock_not_available
  "57014", // query_canceled (statement timeout)
  "53300", // too_many_connections
  "58030", // io_error
]);

/** SQLSTATE class prefixes that are transient regardless of the specific code. */
const TRANSIENT_CLASSES = ["08"]; // connection exception

export type RowFailureKind = "transient" | "deterministic" | "unclassified";

export interface RowFailureClassification {
  kind: RowFailureKind;
  /** Ledger-safe reason: never carries a driver message or any field value. */
  reason: string;
  /** Whether re-applying the identical row could plausibly succeed. */
  retryable: boolean;
}

/**
 * Classify a row-apply failure from its SQLSTATE.
 *
 * An absent or unrecognised code is `unclassified` and NOT called transient —
 * fail honest, not optimistic.
 */
export function classifyRowApplyFailure(code: unknown): RowFailureClassification {
  const sqlstate = typeof code === "string" && /^[0-9A-Za-z]{5}$/.test(code) ? code : null;
  if (!sqlstate) {
    return {
      kind: "unclassified",
      reason: "row apply failed with an unclassified database error",
      retryable: false,
    };
  }
  const transient =
    TRANSIENT_SQLSTATES.has(sqlstate) ||
    TRANSIENT_CLASSES.some((prefix) => sqlstate.startsWith(prefix));
  if (transient) {
    return {
      kind: "transient",
      reason: `transient row apply failure (sqlstate ${sqlstate})`,
      retryable: true,
    };
  }
  return {
    kind: "deterministic",
    reason: `deterministic row apply failure (sqlstate ${sqlstate}) — re-applying the identical row cannot succeed`,
    retryable: false,
  };
}
