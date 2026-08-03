export function insertMarketingContent(
  value: string,
  insertion: string,
  start = value.length,
  end = start,
) {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const needsLeadingSpace = safeStart > 0 && !/\s/.test(value[safeStart - 1] ?? "");
  const needsTrailingSpace = safeEnd < value.length && !/\s|[.,!?;:)]/.test(value[safeEnd] ?? "");
  const inserted = `${needsLeadingSpace ? " " : ""}${insertion}${needsTrailingSpace ? " " : ""}`;
  return {
    value: `${value.slice(0, safeStart)}${inserted}${value.slice(safeEnd)}`,
    caret: safeStart + inserted.length,
  };
}
