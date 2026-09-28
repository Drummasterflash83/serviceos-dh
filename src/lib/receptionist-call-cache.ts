// A shared, user-and-tenant-scoped cache. No persistent browser storage.
export const receptionistCallFreshness = 45_000;
export const receptionistCallPollInterval = 60_000;
export const receptionistCallKey = (userId: string | undefined, tenant: string | undefined) =>
  ["receptionist-calls", userId, tenant] as const;
