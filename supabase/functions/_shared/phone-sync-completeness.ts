// A partial provider page must never advance the durable ingestion cursor.
// Pure helpers so capped, filtered and malformed feeds are regression-testable.
export function providerPageItems(payload: unknown): Record<string, unknown>[] | null {
  const values = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).items
      : null;
  // Do not turn an unexpected response/error object into an empty successful page.
  if (!Array.isArray(values) || values.some((v) => !v || typeof v !== "object" || Array.isArray(v)))
    return null;
  return values as Record<string, unknown>[];
}

export function completeProviderPage(input: {
  returned: number;
  selected: number;
  pageSize: number;
}): boolean {
  return input.returned < input.pageSize && input.selected === input.returned;
}

export function syncWindowComplete(exhausted: boolean, missingIds: number): boolean {
  return exhausted && missingIds === 0;
}

// Explicit account opt-in only: historic behaviour excludes local-only legs.
// Do not coerce the string "false" to true.
export function includeLocalCalls(settings: unknown): boolean {
  return (
    !!settings &&
    typeof settings === "object" &&
    (settings as Record<string, unknown>).include_local_calls === true
  );
}
