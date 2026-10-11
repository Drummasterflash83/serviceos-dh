/** A saved summary timestamp is not evidence of current provider coverage. */
export function describeCustomerCardSnapshot(
  generatedAt: unknown,
  latestActivityAt: unknown,
  now = Date.now(),
): { label: string; note: string } {
  const generated = typeof generatedAt === "string" ? Date.parse(generatedAt) : NaN;
  const activity = typeof latestActivityAt === "string" ? Date.parse(latestActivityAt) : NaN;
  if (!Number.isFinite(now) || !Number.isFinite(generated) || generated > now) {
    return {
      label: "Snapshot date not established",
      note: "This saved summary's freshness has not been verified.",
    };
  }
  return {
    label: `Snapshot prepared ${new Date(generated).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`,
    note:
      Number.isFinite(activity) && activity <= now && activity > generated
        ? "Newer activity is recorded. This summary does not yet include it."
        : "Based on saved records. Current input coverage has not been verified.",
  };
}
