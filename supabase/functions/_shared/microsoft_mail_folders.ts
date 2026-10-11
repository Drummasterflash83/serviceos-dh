import {
  fail,
  object,
  uuid,
  id,
  graphUrl,
  readMicrosoftGraphJson,
} from "./microsoft_graph_transport.ts";

export type MicrosoftMailboxScope = { tenantId: string; accountId: string; mailboxId: string };
export type MicrosoftFolderRequest = MicrosoftMailboxScope & {
  parentFolderId: string | null;
  nextUrl: string | null;
  pageSize: number;
};
export type MicrosoftFolder = {
  id: string;
  parentFolderId: string;
  displayName: string;
  childFolderCount: number;
  totalItemCount: number;
  unreadItemCount: number;
  isHidden: boolean;
  kind: "physical" | "search";
};
export type MicrosoftFolderPage = {
  contract: "microsoft-folder-page/1";
  scope: MicrosoftMailboxScope;
  parentFolderId: string | null;
  requestUrl: string;
  folders: (MicrosoftFolder & { raw: Record<string, unknown> })[];
  nextUrl: string | null;
  collectionComplete: boolean;
  fetchedAt: string;
  persistence: "not_attempted";
};
const FIELDS =
  "id,parentFolderId,displayName,childFolderCount,totalItemCount,unreadItemCount,isHidden";
const MAX_FOLDERS = 10000,
  MAX_PAGES = 10000;
function scope(s: MicrosoftMailboxScope): MicrosoftMailboxScope {
  if (!s || ![s.tenantId, s.accountId, s.mailboxId].every(uuid)) fail("invalid_scope");
  return { tenantId: s.tenantId, accountId: s.accountId, mailboxId: s.mailboxId };
}
function sameScope(a: MicrosoftMailboxScope, b: MicrosoftMailboxScope): boolean {
  return a.tenantId === b.tenantId && a.accountId === b.accountId && a.mailboxId === b.mailboxId;
}
function validateRequest(r: MicrosoftFolderRequest): void {
  scope(r);
  if (r.parentFolderId !== null && !id(r.parentFolderId)) fail("invalid_scope");
  if (!Number.isSafeInteger(r.pageSize) || r.pageSize < 1 || r.pageSize > 100)
    fail("invalid_scope");
}
export function validateMicrosoftFolderContinuation(
  r: MicrosoftFolderRequest,
  url: string,
): string {
  validateRequest(r);
  const parsed = graphUrl(url);
  const match = parsed.pathname.match(
    /^\/v1\.0\/(?:users\/([^/]+)|users\('([^'/]+)'\))\/mailfolders(?:\/([^/]+)\/childfolders|\('([^'/]+)'\)\/childfolders)?\/?$/i,
  );
  if (!match) fail("invalid_continuation");
  try {
    const parent = match[3] ?? match[4];
    if (
      decodeURIComponent(match[1] ?? match[2]) !== r.mailboxId ||
      (parent === undefined ? null : decodeURIComponent(parent)) !== r.parentFolderId
    )
      fail("invalid_continuation");
  } catch {
    return fail("invalid_continuation");
  }
  // Graph list pagination may use $skip or $skiptoken. Do not decode/reconstruct
  // opaque server state. A skip token may encode options; numeric skip cannot.
  const skip = parsed.searchParams.getAll("$skip"),
    token = parsed.searchParams.getAll("$skiptoken");
  if (
    skip.length + token.length !== 1 ||
    parsed.searchParams.has("$deltatoken") ||
    (skip.length && !/^\d+$/.test(skip[0])) ||
    (token.length && !token[0])
  )
    fail("invalid_continuation");
  const hidden = parsed.searchParams.getAll("includeHiddenFolders");
  if (
    hidden.length > 1 ||
    (hidden.length === 1 && hidden[0] !== "true") ||
    (skip.length === 1 && hidden.length !== 1) ||
    parsed.searchParams.has("$filter") ||
    parsed.searchParams.has("$search")
  )
    fail("invalid_continuation");
  return url;
}
export function microsoftFolderRequestUrl(r: MicrosoftFolderRequest): string {
  validateRequest(r);
  if (r.nextUrl !== null) return validateMicrosoftFolderContinuation(r, r.nextUrl);
  const parent =
    r.parentFolderId === null ? "" : `/${encodeURIComponent(r.parentFolderId)}/childFolders`;
  const query = new URLSearchParams({
    includeHiddenFolders: "true",
    $select: FIELDS,
    $top: String(r.pageSize),
  });
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(r.mailboxId)}/mailFolders${parent}?${query}`;
}
function folder(raw: unknown): MicrosoftFolder & { raw: Record<string, unknown> } {
  if (
    !object(raw) ||
    !id(raw.id) ||
    !id(raw.parentFolderId) ||
    raw.id === raw.parentFolderId ||
    typeof raw.displayName !== "string" ||
    raw.displayName.length > 65536 ||
    typeof raw.isHidden !== "boolean" ||
    ![raw.childFolderCount, raw.totalItemCount, raw.unreadItemCount].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    fail();
  const type = raw["@odata.type"];
  if (
    type !== undefined &&
    type !== "#microsoft.graph.mailFolder" &&
    type !== "#microsoft.graph.mailSearchFolder"
  )
    fail();
  return {
    id: raw.id,
    parentFolderId: raw.parentFolderId,
    displayName: raw.displayName,
    childFolderCount: raw.childFolderCount,
    totalItemCount: raw.totalItemCount,
    unreadItemCount: raw.unreadItemCount,
    isHidden: raw.isHidden,
    kind: type === "#microsoft.graph.mailSearchFolder" ? "search" : "physical",
    raw,
  };
}
export async function readMicrosoftFolderPage(
  accessToken: string,
  request: MicrosoftFolderRequest,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<MicrosoftFolderPage> {
  const url = microsoftFolderRequestUrl(request),
    bound = scope(request),
    parentFolderId = request.parentFolderId,
    pageSize = request.pageSize;
  const { body, fetchedAt } = await readMicrosoftGraphJson(
    accessToken,
    url,
    pageSize,
    fetcher,
    now,
  );
  if (
    !object(body) ||
    !Array.isArray(body.value) ||
    body.value.length > 1000 ||
    Object.hasOwn(body, "@odata.deltaLink")
  )
    fail();
  const nextUrl = Object.hasOwn(body, "@odata.nextLink")
    ? validateMicrosoftFolderContinuation(
        { ...bound, parentFolderId, pageSize, nextUrl: null },
        body["@odata.nextLink"],
      )
    : null;
  if (nextUrl === url) fail("pagination_no_progress");
  const folders = body.value.map(folder);
  if (parentFolderId !== null && folders.some((f) => f.parentFolderId !== parentFolderId))
    fail("hierarchy_conflict");
  return {
    contract: "microsoft-folder-page/1",
    scope: bound,
    parentFolderId,
    requestUrl: url,
    folders,
    nextUrl,
    collectionComplete: nextUrl === null,
    fetchedAt,
    persistence: "not_attempted",
  };
}

/** Private server checkpoint. Not an authorization token or a persisted receipt.
 * The future store must atomically commit each returned page AND checkpoint. */
export type MicrosoftFolderDiscovery = {
  contract: "microsoft-folder-discovery/1";
  scope: MicrosoftMailboxScope;
  pageSize: number;
  pending: { parentFolderId: string | null; nextUrl: string | null }[];
  completedParents: (string | null)[];
  visitedRequests: string[];
  folders: MicrosoftFolder[];
};
export function beginMicrosoftFolderDiscovery(
  s: MicrosoftMailboxScope,
  pageSize = 100,
): MicrosoftFolderDiscovery {
  validateRequest({ ...s, parentFolderId: null, nextUrl: null, pageSize });
  return {
    contract: "microsoft-folder-discovery/1",
    scope: scope(s),
    pageSize,
    pending: [{ parentFolderId: null, nextUrl: null }],
    completedParents: [],
    visitedRequests: [],
    folders: [],
  };
}
function validateDiscovery(s: MicrosoftMailboxScope, state: MicrosoftFolderDiscovery): void {
  scope(s);
  if (
    !object(state) ||
    state.contract !== "microsoft-folder-discovery/1" ||
    !object(state.scope) ||
    !sameScope(s, state.scope) ||
    !Array.isArray(state.pending) ||
    !Array.isArray(state.completedParents) ||
    !Array.isArray(state.folders) ||
    !Array.isArray(state.visitedRequests)
  )
    fail("invalid_discovery_state");
  if (
    state.folders.length > MAX_FOLDERS ||
    state.visitedRequests.length > MAX_PAGES ||
    state.pending.length > MAX_FOLDERS + 1 ||
    state.completedParents.length > MAX_FOLDERS + 1
  )
    fail("discovery_limit");
  const ids = new Set<string>();
  for (const f of state.folders) {
    if (!object(f) || !["physical", "search"].includes(f.kind)) fail("invalid_discovery_state");
    folder({
      ...f,
      "@odata.type":
        f.kind === "search" ? "#microsoft.graph.mailSearchFolder" : "#microsoft.graph.mailFolder",
    });
    if (ids.has(f.id)) fail("invalid_discovery_state");
    ids.add(f.id);
  }
  const parents = new Set<string | null>();
  for (const parent of state.completedParents) {
    if ((parent !== null && !ids.has(parent)) || parents.has(parent))
      fail("invalid_discovery_state");
    parents.add(parent);
  }
  for (const p of state.pending) {
    if (
      !object(p) ||
      (p.parentFolderId !== null && !ids.has(p.parentFolderId)) ||
      parents.has(p.parentFolderId)
    )
      fail("invalid_discovery_state");
    parents.add(p.parentFolderId);
    microsoftFolderRequestUrl({
      ...scope(s),
      parentFolderId: p.parentFolderId,
      nextUrl: p.nextUrl,
      pageSize: state.pageSize,
    });
  }
  if (
    !Number.isSafeInteger(state.pageSize) ||
    state.pageSize < 1 ||
    state.pageSize > 100 ||
    !parents.has(null) ||
    parents.size !== ids.size + 1 ||
    new Set(state.visitedRequests).size !== state.visitedRequests.length ||
    state.visitedRequests.some((u) => typeof u !== "string" || u.length > 32768)
  )
    fail("invalid_discovery_state");
  assertNoCycles(state.folders);
}
function assertNoCycles(folders: MicrosoftFolder[]): void {
  const parents = new Map(folders.map((f) => [f.id, f.parentFolderId]));
  const checked = new Set<string>();
  for (const f of folders) {
    const chain = new Set<string>();
    let current: string | undefined = f.id;
    while (current !== undefined && parents.has(current) && !checked.has(current)) {
      if (chain.has(current)) fail("hierarchy_conflict");
      chain.add(current);
      current = parents.get(current);
    }
    for (const node of chain) checked.add(node);
  }
}
/** Fetch exactly one page, returning the next checkpoint without mutating input.
 * Even zero-child-count folders are visited: counts aren't traversal proof.
 * Search folders are identified as virtual views, not independent capture targets.
 * Their children are still traversed so no descendant is silently excluded.
 * Exhaustion is a traversal observation, NOT a point-in-time snapshot or mail coverage. */
export async function stepMicrosoftFolderDiscovery(
  accessToken: string,
  s: MicrosoftMailboxScope,
  checkpoint: MicrosoftFolderDiscovery,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<{
  checkpoint: MicrosoftFolderDiscovery;
  page: MicrosoftFolderPage | null;
  traversalExhausted: boolean;
  persistence: "not_attempted";
}> {
  validateDiscovery(s, checkpoint);
  const state = structuredClone(checkpoint);
  if (!state.pending.length)
    return {
      checkpoint: state,
      page: null,
      traversalExhausted: true,
      persistence: "not_attempted",
    };
  if (state.visitedRequests.length >= MAX_PAGES) fail("discovery_limit");
  const current = state.pending[0];
  const request = {
    ...scope(state.scope),
    parentFolderId: current.parentFolderId,
    nextUrl: current.nextUrl,
    pageSize: state.pageSize,
  };
  const url = microsoftFolderRequestUrl(request);
  if (state.visitedRequests.includes(url)) fail("pagination_no_progress");
  const page = await readMicrosoftFolderPage(accessToken, request, fetcher, now);
  if (page.nextUrl && (state.visitedRequests.includes(page.nextUrl) || page.nextUrl === url))
    fail("pagination_no_progress");
  const known = new Map(state.folders.map((f) => [f.id, f]));
  for (const observation of page.folders) {
    const previous = known.get(observation.id);
    if (previous) {
      if (
        previous.parentFolderId !== observation.parentFolderId ||
        previous.kind !== observation.kind
      )
        fail("hierarchy_conflict");
      continue; // Keep first discovery metadata; caller must retain every raw page.
    }
    if (state.folders.length >= MAX_FOLDERS) fail("discovery_limit");
    const { raw: _raw, ...summary } = observation;
    state.folders.push(summary);
    known.set(summary.id, summary);
    state.pending.push({ parentFolderId: summary.id, nextUrl: null });
  }
  assertNoCycles(state.folders);
  state.visitedRequests.push(url);
  if (page.nextUrl) current.nextUrl = page.nextUrl;
  else {
    state.pending.shift();
    state.completedParents.push(current.parentFolderId);
  }
  return {
    checkpoint: state,
    page,
    traversalExhausted: state.pending.length === 0,
    persistence: "not_attempted",
  };
}
