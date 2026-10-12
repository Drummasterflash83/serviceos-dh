export type InputScope = { backend: string; actorId: string; tenantId: string };
export type InputLock = <T>(key: string, operation: () => Promise<T>) => Promise<T>;
export type RequestStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function inputOutboxKey(s: InputScope) {
  if (
    !/^https:\/\/[^/?#]+$/.test(s.backend) ||
    ![s.actorId, s.tenantId].every((v) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v))
  )
    throw Error("A signed-in operator, company and backend are required.");
  return `serviceos:operator-input:1:${encodeURIComponent(s.backend)}:${s.actorId}:${s.tenantId}`;
}
export function connectionOutboxKey(s: InputScope) {
  return `${inputOutboxKey(s)}:connection`;
}
export function captureOutboxKey(s: InputScope) {
  return `${inputOutboxKey(s)}:capture`;
}

export function commusoftRecurringOutboxKey(s: InputScope) {
  return `${inputOutboxKey(s)}:commusoft-recurring`;
}
