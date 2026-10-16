/** Independent source lanes use the existing idempotent interaction projector.
 * A phone review hold or an all-source inventory retry cannot delay new Email
 * work. Neither lane skips retained rows or changes source identity rules.
 */
export function interactionProjectionSchedule(tenantId: string) {
  return [
    {
      tenantId,
      jobType: "interactions.sync",
      jobKey: `interactions.sync:${tenantId}:phone`,
      connectorId: "openfolk-core",
      moduleId: "core.interactions",
      priority: 50,
      payload: { source: "phone", limit: 100 },
    },
    {
      tenantId,
      jobType: "interactions.sync",
      jobKey: `interactions.sync:${tenantId}:email`,
      connectorId: "openfolk-core",
      moduleId: "core.interactions",
      priority: 50,
      payload: { source: "email", limit: 200 },
    },
  ] as const;
}
