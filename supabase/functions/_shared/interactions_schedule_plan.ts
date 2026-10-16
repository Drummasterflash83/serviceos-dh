/** Independent source lanes use the existing idempotent interaction projector.
 * A phone review hold or an all-source inventory retry cannot delay new Email
 * work. Neither lane skips retained rows or changes source identity rules.
 */
export function interactionProjectionSchedule(tenantId: string) {
  return [
    {
      tenantId,
      jobType: "interactions.sync",
      jobKey: `interactions.sync:${tenantId}:email:current`,
      connectorId: "openfolk-core",
      moduleId: "core.interactions",
      priority: 40,
      payload: { source: "email", lane: "current", limit: 50 },
    },
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
      // Match the worker's bounded selector and the fenced settlement's
      // exact full-batch continuation check.
      payload: { source: "email", limit: 10 },
    },
  ] as const;
}
