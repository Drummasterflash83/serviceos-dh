import {
  startSlackImport,
  validateSlackImportRequest,
  type SlackImportRequest,
} from "./learn-slack-setup.ts";
import {
  startSlackThreadImport,
  validateSlackThreadRequest,
  type SlackThreadClient,
  type SlackThreadRequest,
} from "./learn-slack-threads.ts";
import {
  recoveryOutboxKey,
  type RecoveryScope,
  type RecoveryLock,
} from "./learn-slack-recovery-outbox.ts";
import { rejectedSlackImport } from "./learn-slack-import-errors.ts";
export type ImportKind = "channel" | "threads";
export type ImportRequest =
  | { kind: "channel"; request: SlackImportRequest }
  | { kind: "threads"; request: SlackThreadRequest };
type Receipt = { requestId: string; accountId: string; jobId: string; reused: boolean };
export type ImportEntry = ImportRequest & { receipt: Receipt | null; skipped: boolean };
export type ImportDraft = {
  version: 1;
  actorId: string;
  backend: string;
  tenantId: string;
  id: string;
  createdAt: string;
  kind: ImportKind;
  entries: ImportEntry[];
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s);
export function importOutboxKey(scope: RecoveryScope, kind: ImportKind) {
  recoveryOutboxKey(scope);
  if (!["channel", "threads"].includes(kind)) throw Error("Invalid saved import type.");
  return `serviceos:slack-import:1:${encodeURIComponent(scope.backend)}:${scope.actorId}:${scope.tenantId}:${kind}`;
}
/** Whitelist request metadata: never retain message excerpts or credential fields. */
function checked(scope: RecoveryScope, kind: ImportKind, d: ImportDraft): ImportDraft {
  importOutboxKey(scope, kind);
  if (
    !d ||
    d.version !== 1 ||
    d.kind !== kind ||
    d.actorId !== scope.actorId ||
    d.backend !== scope.backend ||
    d.tenantId !== scope.tenantId ||
    !uuid(d.id) ||
    !Number.isFinite(Date.parse(d.createdAt)) ||
    !Array.isArray(d.entries) ||
    !d.entries.length ||
    d.entries.length > (kind === "channel" ? 1 : 20)
  )
    throw Error("Saved import scope cannot be verified.");
  const seen = new Set<string>(),
    sources = new Set<string>();
  let account: string | undefined;
  const entries = d.entries.map((e): ImportEntry => {
    if (
      !e ||
      e.kind !== kind ||
      !e.request ||
      e.request.tenantId !== scope.tenantId ||
      seen.has(e.request.requestId) ||
      typeof e.skipped !== "boolean"
    )
      throw Error("Saved import request cannot be verified.");
    seen.add(e.request.requestId);
    let item: ImportRequest;
    if (e.kind === "channel") {
      const r = e.request;
      validateSlackImportRequest(r);
      if (
        !/^T[A-Z0-9]+$/.test(r.connection.teamId) ||
        typeof r.connection.name !== "string" ||
        r.connection.name.length > 200
      )
        throw Error("Saved workspace cannot be verified.");
      item = {
        kind: "channel",
        request: {
          requestId: r.requestId,
          tenantId: r.tenantId,
          connection: {
            id: r.connection.id,
            teamId: r.connection.teamId,
            name: r.connection.name,
            revision: r.connection.revision,
          },
          channelId: r.channelId,
          start: r.start,
          end: r.end,
          maxPages: r.maxPages,
          reason: r.reason,
        },
      };
    } else {
      const r = e.request;
      validateSlackThreadRequest(r);
      if ((account && account !== r.accountId) || sources.has(r.sourceId))
        throw Error("Saved thread selection cannot be verified.");
      account = r.accountId;
      sources.add(r.sourceId);
      item = {
        kind: "threads",
        request: {
          requestId: r.requestId,
          tenantId: r.tenantId,
          accountId: r.accountId,
          sourceId: r.sourceId,
          sourceVersion: r.sourceVersion,
          parentTimestamp: r.parentTimestamp,
          connectionRevision: r.connectionRevision,
          start: r.start,
          end: r.end,
          maxPages: r.maxPages,
          reason: r.reason,
        },
      };
    }
    const r = e.receipt;
    if (
      r !== null &&
      (!r ||
        e.skipped ||
        r.requestId !== e.request.requestId ||
        !uuid(r.accountId) ||
        !uuid(r.jobId) ||
        typeof r.reused !== "boolean" ||
        (e.kind === "threads" && r.accountId !== e.request.accountId))
    )
      throw Error("Saved import receipt cannot be verified.");
    return {
      ...item,
      skipped: e.skipped,
      receipt:
        r === null
          ? null
          : { requestId: r.requestId, accountId: r.accountId, jobId: r.jobId, reused: r.reused },
    };
  });
  return {
    version: 1,
    actorId: d.actorId,
    backend: d.backend,
    tenantId: d.tenantId,
    id: d.id,
    createdAt: d.createdAt,
    kind,
    entries,
  };
}
export function prepareImportDraft(scope: RecoveryScope, requests: ImportRequest[]): ImportDraft {
  return checked(scope, requests[0]?.kind, {
    version: 1,
    ...scope,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: requests[0]?.kind,
    entries: requests.map((r) => ({ ...r, receipt: null, skipped: false })),
  });
}
export function readImportDraft(
  storage: StoragePort,
  scope: RecoveryScope,
  kind: ImportKind,
): ImportDraft | null {
  const raw = storage.getItem(importOutboxKey(scope, kind));
  if (raw === null) return null;
  try {
    if (raw.length > 80000) throw Error("Oversize");
    return checked(scope, kind, JSON.parse(raw));
  } catch {
    throw Error(
      "Saved import cannot be verified. Keep this browser data and contact support before approving again.",
    );
  }
}
function write(storage: StoragePort, key: string, d: ImportDraft) {
  const encoded = JSON.stringify(d);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded)
    throw Error("Import could not be saved in this browser. Retry the original request.");
  return encoded;
}
function remove(storage: StoragePort, key: string, encoded: string) {
  if (storage.getItem(key) !== encoded)
    throw Error("Saved import changed. Reload before continuing.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null)
    throw Error("Saved import could not be cleared. Retry the original request.");
}
const identity = (d: ImportDraft) =>
  JSON.stringify({ ...d, entries: d.entries.map(({ receipt, skipped, ...r }) => r) });
export class ImportSubmissionError extends Error {
  requestId: string;
  rejected: boolean;
  constructor(requestId: string, cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Import was not confirmed. Retry the saved requests.",
    );
    this.requestId = requestId;
    this.rejected = rejectedSlackImport(cause);
  }
}
/** Persist the whole reviewed batch before the first RPC and each receipt before the next. */
export async function submitImportDraft(
  db: SlackThreadClient,
  storage: StoragePort,
  lock: RecoveryLock,
  scope: RecoveryScope,
  draft: ImportDraft,
  allowed: () => boolean,
  progress?: (d: ImportDraft) => void,
) {
  const value = checked(scope, draft.kind, draft),
    key = importOutboxKey(scope, value.kind);
  return lock(key, async () => {
    if (!allowed()) throw Error("Company owner or admin access is required in an open review.");
    const old = readImportDraft(storage, scope, value.kind);
    if (old && identity(old) !== identity(value))
      throw Error("Another saved import is waiting. Reload it before approving again.");
    const d = old ?? value;
    let encoded = write(storage, key, d);
    progress?.(d);
    for (const entry of d.entries) {
      if (entry.receipt || entry.skipped) continue;
      if (!allowed())
        throw Error(
          "Review closed or approval access changed. Remaining requests are saved and have not been sent.",
        );
      if (storage.getItem(key) !== encoded)
        throw Error("Saved import changed. Reload before continuing.");
      try {
        entry.receipt =
          entry.kind === "channel"
            ? await startSlackImport(db as Parameters<typeof startSlackImport>[0], entry.request)
            : await startSlackThreadImport(db, entry.request);
      } catch (e) {
        throw new ImportSubmissionError(entry.request.requestId, e);
      }
      if (storage.getItem(key) !== encoded)
        throw Error("Approval was recorded, but saved import changed. Reload before continuing.");
      encoded = write(storage, key, d);
      progress?.(d);
    }
    remove(storage, key, encoded);
    return d;
  });
}
/** UI calls only after an explicit definitive rejection, never after a lost response. */
export async function skipRejectedImport(
  storage: StoragePort,
  lock: RecoveryLock,
  scope: RecoveryScope,
  expected: ImportDraft,
  failure: ImportSubmissionError,
) {
  if (!failure.rejected)
    throw Error("An uncertain import must be retried with its original request.");
  const key = importOutboxKey(scope, expected.kind);
  return lock(key, async () => {
    const d = readImportDraft(storage, scope, expected.kind);
    if (!d || identity(d) !== identity(checked(scope, expected.kind, expected)))
      throw Error("Saved import changed. Reload before clearing it.");
    const entry = d.entries.find((e) => e.request.requestId === failure.requestId);
    if (!entry || entry.receipt || entry.skipped)
      throw Error("This request is no longer awaiting confirmation.");
    entry.skipped = true;
    const encoded = write(storage, key, d);
    if (d.entries.every((e) => e.receipt || e.skipped)) {
      remove(storage, key, encoded);
      return null;
    }
    return d;
  });
}
