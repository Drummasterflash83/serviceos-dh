/** Explicit UTC wall-clock fields for completed, including same-day, assessments. */
export function assessmentTimeField(at = Date.now()): string {
  if (!Number.isFinite(at)) throw Error("Invalid assessment time");
  return new Date(at).toISOString().slice(0, 19);
}
export function assessmentPeriod(from: string, until: string, now = Date.now()) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
      throw Error("Choose a UTC date and time for both ends of the assessment.");
    const normalized = value.length === 16 ? `${value}:00` : value;
    const at = Date.parse(`${normalized}Z`);
    if (!Number.isFinite(at) || assessmentTimeField(at) !== normalized)
      throw Error("Choose valid UTC dates and times.");
    return at;
  };
  const start = parse(from), end = parse(until);
  if (!Number.isFinite(now) || end > now || start >= end)
    throw Error("Choose a completed period with the end after the start.");
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}
