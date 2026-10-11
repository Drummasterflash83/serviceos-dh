import { parseJobDate, sameJobInstant, type JobDate } from "./learn-commusoft-job-details.ts";
type Job = Record<string, any>;
const names = { created: "Creation", completed: "Completion" } as const;
function times(record: Job): Record<keyof typeof names, JobDate> | null {
  const value = record.time_evidence;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2
  )
    return null;
  try {
    const result = {
      created: parseJobDate(value.created),
      completed: parseJobDate(value.completed),
    };
    for (const key of ["created", "completed"] as const) {
      const date = result[key],
        stored = record[key + "_date"];
      if (
        date.state === "invalid" ||
        (date.state === "zoned" ? !sameJobInstant(date.instant, stored) : stored !== null)
      )
        return null;
    }
    return result;
  } catch {
    return null;
  }
}
export function jobTimingGaps(record: Job): string[] {
  const dates = times(record);
  if (!dates)
    return [
      "Job timing provenance is unavailable or conflicts with the stored dates. Check the source before using timing for performance.",
    ];
  return Object.entries(dates).flatMap(([key, date]) =>
    date.state === "timezone_required"
      ? [
          `${names[key as keyof typeof names]} time has no confirmed timezone. The job is available, but this time cannot support duration or performance calculations.`,
        ]
      : date.state === "absent" &&
          (key === "created" || ["completed", "closed"].includes(record.status))
        ? [
            `${names[key as keyof typeof names]} time was not supplied. Missing time is not evidence of poor performance.`,
          ]
        : [],
  );
}
export function jobTimingFields(record: Job): { label: string; value: string }[] {
  const dates = times(record);
  if (!dates) return [{ label: "Timing evidence", value: jobTimingGaps(record)[0] }];
  return Object.entries(dates).map(([key, date]) => ({
    label: names[key as keyof typeof names] + " time",
    value:
      date.state === "timezone_required"
        ? `${date.source} — source time without a timezone; timezone unconfirmed. Excluded from duration and performance calculations.`
        : date.state === "absent"
          ? "Not supplied; not evidence of poor performance."
          : `${date.instant} — source includes an explicit timezone.`,
  }));
}
