import { JOB_DETAIL_FIELDS, JOB_DETAIL_DATES } from "../../src/lib/learn-commusoft-job-details";
const tenant = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let denied = false;
export function commusoftJobFixture(name: string, args: any): any {
  const scenario = new URLSearchParams(location.search).get("jobDetails");
  if (
    !scenario ||
    ![
      "learn_commusoft_review_connections",
      "learn_commusoft_work_review_search",
      "learn_commusoft_job_details",
    ].includes(name)
  )
    return null;
  if (args.p_tenant !== tenant) return { data: null, error: { code: "42501" } };
  if (name === "learn_commusoft_review_connections")
    return {
      data: {
        tenant_id: tenant,
        connections: [{ id: id(501), name: "Synthetic retained Commusoft source" }],
      },
      error: null,
    };
  if (args.p_connection !== id(501)) return { data: null, error: { code: "42501" } };
  if (name === "learn_commusoft_work_review_search")
    return {
      data: {
        tenant_id: tenant,
        connection_id: id(501),
        kind: args.p_kind,
        search: args.p_search,
        rows:
          args.p_kind === "job"
            ? [
                {
                  external_id: "955",
                  version_id: id(502),
                  title: "Synthetic boiler service",
                  property_reference: "3",
                  customer_name: "Example customer",
                  relationship_reason: null,
                  source_status: "completed",
                  linked_version_id: null,
                  last_result: { state: "held", reason: "job_timestamp_timezone_required" },
                  selectable: true,
                },
              ]
            : [],
        next_cursor: null,
      },
      error: null,
    };
  if (args.p_version !== id(502)) return { data: null, error: { code: "22023" } };
  if (scenario === "retry" && !denied) {
    denied = true;
    return { data: null, error: { code: "42501" } };
  }
  const fields = Object.fromEntries(
    Object.keys(JOB_DETAIL_FIELDS).map((k) => [
      k,
      { value: null as string | null, shortened: false },
    ]),
  );
  fields.description.value =
    "Synthetic boiler service. Check the retained source details before linking.";
  fields.status.value = "completed";
  fields.priority.value = "Important";
  fields.customerReference.value = "Example reference";
  fields.businessUnit.value = "Heating";
  fields.userGroup.value = "Example engineers";
  const dates: any = Object.fromEntries(
    Object.keys(JOB_DETAIL_DATES).map((k) => [k, { state: "absent", source: null, instant: null }]),
  );
  dates.created = {
    state: "zoned",
    source: "2026-10-01T09:30:00+01:00",
    instant: "2026-10-01T08:30:00.000000Z",
  };
  dates.completed = { state: "timezone_required", source: "2026-10-02 15:10:00", instant: null };
  dates.closed = { state: "invalid", source: "2026-02-30 00:00:00", instant: null };
  return {
    data: {
      version: "commusoft-job-detail/1",
      tenant_id: tenant,
      connection_id: id(501),
      version_id: id(502),
      external_id: "955",
      observed_at: "2026-10-10T12:00:00Z",
      current: scenario !== "stale",
      property_reference: "3",
      fields,
      dates,
    },
    error: null,
  };
}
