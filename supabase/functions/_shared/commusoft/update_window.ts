export type CommusoftUpdateWindow = { updatedFrom: string; updatedBefore: string };
/** Fixed UTC bounds. A malformed or partial window must never become a full read. */
export function commusoftUpdateWindow(
  value: unknown,
): CommusoftUpdateWindow | Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("commusoft_update_window_invalid");
  const v = value as Record<string, unknown>;
  if (!("updatedFrom" in v) && !("updatedBefore" in v)) return {};
  for (const key of ["updatedFrom", "updatedBefore"]) {
    const date = v[key];
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString() !== date
    )
      throw Error("commusoft_update_window_invalid");
  }
  if (
    Date.parse(v.updatedFrom as string) < 0 ||
    Date.parse(v.updatedFrom as string) >= Date.parse(v.updatedBefore as string)
  )
    throw Error("commusoft_update_window_invalid");
  return { updatedFrom: v.updatedFrom as string, updatedBefore: v.updatedBefore as string };
}
