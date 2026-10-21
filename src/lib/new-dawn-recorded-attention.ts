import type { OpenJobRow } from "./new-dawn-open-job-page";

export type RecordedAttentionGroup = {
  key: string;
  name: string;
  onHold: number;
  pending: number;
  jobs: OpenJobRow[];
};

export type RecordedAttention = {
  groups: RecordedAttentionGroup[];
  ungrouped: OpenJobRow[];
  excludedConfirmed: number;
  shown: number;
};

const sourceId = (value: string | null): value is string =>
  typeof value === "string" && /^[1-9]\d{0,15}$/.test(value);
const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
const jobKey = (row: OpenJobRow) => `${row.connection_id}:${row.external_id}`;
const versionKey = (row: OpenJobRow) => `${jobKey(row)}:${row.source_version_id}`;

/** Group only by the provider's exact customer ID within its connection.
 * Names and postcodes are labels, never identity keys. A changed name or a
 * missing source parent leaves jobs separate instead of inventing a match. */
export function groupRecordedAttention(
  rows: OpenJobRow[], confirmedJobKeys: ReadonlySet<string>,
): RecordedAttention {
  const groups = new Map<string, RecordedAttentionGroup>();
  const conflicting = new Set<string>();
  const ungrouped: OpenJobRow[] = [];
  const seen = new Set<string>();
  let excludedConfirmed = 0;
  for (const row of rows) {
    if (row.status !== "on_hold" && row.status !== "pending")
      throw Error("Recorded attention contains a non-attention job");
    const key = jobKey(row);
    if (seen.has(key)) throw Error("Recorded attention contains a repeated job");
    seen.add(key);
    if (confirmedJobKeys.has(versionKey(row))) { excludedConfirmed++; continue; }
    const name = row.source_customer?.trim();
    if (row.context_state !== "source_customer_and_property" ||
      !sourceId(row.customer_external_id) || !name) {
      ungrouped.push(row);
      continue;
    }
    const groupKey = `${row.connection_id}:${row.customer_external_id}`;
    const group = groups.get(groupKey);
    if (group && normalized(group.name) !== normalized(name))
      conflicting.add(groupKey);
    if (group) {
      group.jobs.push(row);
      group.onHold += Number(row.status === "on_hold");
      group.pending += Number(row.status === "pending");
    } else groups.set(groupKey, {
      key: groupKey, name, onHold: Number(row.status === "on_hold"),
      pending: Number(row.status === "pending"), jobs: [row],
    });
  }
  for (const key of conflicting) {
    ungrouped.push(...groups.get(key)!.jobs);
    groups.delete(key);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    b.onHold - a.onHold || b.pending - a.pending ||
    a.name.localeCompare(b.name, "en-GB") || a.key.localeCompare(b.key));
  return { groups: sorted, ungrouped, excludedConfirmed,
    shown: sorted.reduce((n, group) => n + group.jobs.length, ungrouped.length) };
}
