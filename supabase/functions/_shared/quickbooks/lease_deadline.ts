/** Database and worker clocks can differ slightly. Accept at most five seconds
 * of skew, but shorten the worker budget by that margin. The database remains
 * authoritative when validating the lease and persisting a token pair.
 */
export function quickBooksLeaseBudget(until: string, now: number): number | null {
  const remaining = Date.parse(until) - now;
  if (!Number.isFinite(remaining) || remaining <= 5000 || remaining > 125000) return null;
  return Math.floor(Math.min(remaining - 5000, 115000));
}
