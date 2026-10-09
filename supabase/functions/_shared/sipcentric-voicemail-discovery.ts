// Read-only discovery, not voicemail ingestion. The published Direct API documents
// endpoints and their voicemail links, but no voicemail-message/audio schema.
// Never infer an empty mailbox from a successful endpoint listing.
const ORIGIN = "https://pbx.sipcentric.com";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAGE_SIZE = 200;
const MAX_BYTES = 2 * 1024 * 1024;
type Json = Record<string, unknown>;
export type DiscoveryCode =
  | "invalid_scope"
  | "invalid_credentials"
  | "request_budget"
  | "network_error"
  | "rate_limited"
  | "auth_failed"
  | "upstream_error"
  | "redirect_refused"
  | "invalid_response"
  | "response_too_large"
  | "inconsistent_inventory";
export class DiscoveryError extends Error {
  code: DiscoveryCode;
  retryAfterSeconds: number | null;
  constructor(code: DiscoveryCode, retryAfterSeconds: number | null = null) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds; // Provider payloads and exception prose can contain credentials/PII.
  }
}
function record(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
/** Only the documented account-scoped resources; never follow arbitrary links. */
export function resourceUrl(customerId: string, endpointId?: string, voicemail = false): string {
  if (!ID.test(customerId) || (endpointId !== undefined && !ID.test(endpointId)))
    throw new DiscoveryError("invalid_scope");
  if (voicemail && endpointId === undefined) throw new DiscoveryError("invalid_scope");
  return (
    `${ORIGIN}/api/v1/customers/${customerId}/endpoints` +
    (endpointId ? `/${endpointId}${voicemail ? "/voicemail" : ""}` : "")
  );
}
// Published examples contain HTTP links. Upgrade only the exact documented path;
// credentials are always sent over HTTPS to the fixed origin, without redirects.
function matchesResource(value: unknown, expected: string): boolean {
  return value === expected || value === expected.replace("https:", "http:");
}
async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
    await response.body?.cancel();
    throw new DiscoveryError("response_too_large");
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    await response.body?.cancel();
    throw new DiscoveryError("invalid_response");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DiscoveryError("invalid_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new DiscoveryError("response_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DiscoveryError("invalid_response");
  }
}
export type MailboxCandidate = {
  endpointId: string;
  type: "phone" | "mailbox";
  voicemailEnabled: boolean | null;
  publishedVoicemailLink: boolean;
  resourceShape: null | {
    kind: "object" | "array";
    keys: string[];
    linkKeys: string[];
    otherKeyCount: number;
    otherLinkKeyCount: number;
  };
};
export type VoicemailDiscovery = {
  contract: "sipcentric-voicemail-discovery@1";
  customerId: string;
  observedAt: string;
  endpointListingComplete: true;
  endpointCount: number;
  requests: number;
  candidates: MailboxCandidate[];
  messageCoverage: "unverified";
};
/** No database access, source writes, first-account guessing or message downloads. */
export async function discoverVoicemail(input: {
  customerId: string;
  username: string;
  password: string;
  inspectPublishedResources?: boolean;
  requestBudget?: number;
  fetcher?: typeof fetch;
}): Promise<VoicemailDiscovery> {
  const base = resourceUrl(input.customerId);
  if (
    !input.username ||
    !input.password ||
    /[:\r\n]/.test(input.username) ||
    /[\r\n]/.test(input.password)
  )
    throw new DiscoveryError("invalid_credentials");
  const budget = input.requestBudget ?? 40;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 100)
    throw new DiscoveryError("request_budget");
  const fetcher = input.fetcher ?? fetch;
  let authorization: string;
  try {
    authorization = "Basic " + btoa(`${input.username}:${input.password}`);
  } catch {
    throw new DiscoveryError("invalid_credentials");
  }
  let requests = 0;
  async function get(url: string): Promise<unknown> {
    if (++requests > budget) throw new DiscoveryError("request_budget");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Authorization: authorization, Accept: "application/json" },
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        if (response.status >= 300 && response.status < 400)
          throw new DiscoveryError("redirect_refused");
        if (response.status === 401 || response.status === 403)
          throw new DiscoveryError("auth_failed");
        if (response.status === 429) {
          const raw = response.headers.get("X-RateLimit-Reset");
          throw new DiscoveryError(
            "rate_limited",
            raw !== null && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))
              ? Number(raw)
              : null,
          );
        }
        throw new DiscoveryError("upstream_error");
      }
      return await boundedJson(response);
    } catch (e) {
      if (e instanceof DiscoveryError) throw e;
      throw new DiscoveryError("network_error");
    } finally {
      clearTimeout(timeout);
    }
  }
  const endpoints: Json[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  // Require stable totals and a complete, duplicate-free paginated listing.
  // This is a nontransactional provider observation, not an atomic snapshot.
  for (let page = 1; ; page++) {
    const data = await get(`${base}?pageSize=${PAGE_SIZE}&page=${page}`);
    if (
      !record(data) ||
      !integer(data.totalItems) ||
      data.page !== page ||
      data.pageSize !== PAGE_SIZE ||
      !Array.isArray(data.items) ||
      data.items.some((item) => !record(item))
    )
      throw new DiscoveryError("invalid_response");
    if (total !== null && total !== data.totalItems)
      throw new DiscoveryError("inconsistent_inventory");
    total = data.totalItems;
    if (total > 2000) throw new DiscoveryError("request_budget");
    const expectedCount = Math.min(PAGE_SIZE, Math.max(0, total - endpoints.length));
    if (data.items.length !== expectedCount) throw new DiscoveryError("inconsistent_inventory");
    for (const item of data.items as Json[]) {
      if (typeof item.uri !== "string" || typeof item.type !== "string")
        throw new DiscoveryError("invalid_response");
      const id = item.uri.split("/").at(-1)!;
      if (
        !ID.test(id) ||
        !matchesResource(item.uri, resourceUrl(input.customerId, id)) ||
        seen.has(id)
      )
        throw new DiscoveryError("inconsistent_inventory");
      seen.add(id);
      endpoints.push({ ...item, discoveredId: id });
    }
    if (endpoints.length === total) {
      if (data.nextPage !== undefined && data.nextPage !== null && data.nextPage !== "")
        throw new DiscoveryError("inconsistent_inventory");
      break;
    }
    // Reconstruct requests instead of following provider-supplied URLs.
    const expectedNext = `${base}?pageSize=${PAGE_SIZE}&page=${page + 1}`;
    if (!matchesResource(data.nextPage, expectedNext))
      throw new DiscoveryError("inconsistent_inventory");
  }
  const candidates: MailboxCandidate[] = [];
  for (const endpoint of endpoints) {
    if (endpoint.type !== "phone" && endpoint.type !== "mailbox") continue;
    const endpointId = endpoint.discoveredId as string;
    const url = resourceUrl(input.customerId, endpointId);
    const detail = await get(url);
    if (
      !record(detail) ||
      !matchesResource(detail.uri, url) ||
      detail.type !== endpoint.type ||
      (detail.voicemailEnabled !== undefined && typeof detail.voicemailEnabled !== "boolean") ||
      (detail.links !== undefined && !record(detail.links))
    )
      throw new DiscoveryError("invalid_response");
    const links = record(detail.links) ? detail.links : {};
    const vmUrl = resourceUrl(input.customerId, endpointId, true);
    if (links.voicemail !== undefined && !matchesResource(links.voicemail, vmUrl))
      throw new DiscoveryError("invalid_scope");
    const candidate: MailboxCandidate = {
      endpointId,
      type: endpoint.type,
      voicemailEnabled:
        typeof detail.voicemailEnabled === "boolean" ? detail.voicemailEnabled : null,
      publishedVoicemailLink: links.voicemail !== undefined,
      resourceShape: null,
    };
    if (input.inspectPublishedResources && candidate.publishedVoicemailLink) {
      const shape = await get(vmUrl);
      if (!record(shape) && !Array.isArray(shape)) throw new DiscoveryError("invalid_response");
      // Only structural field names leave this scope. No caller, email, credential,
      // transcript, PIN, message URI or recording payload is logged or retained.
      const safeKeys = new Set([
        "type",
        "uri",
        "id",
        "created",
        "parent",
        "links",
        "items",
        "totalItems",
        "page",
        "pageSize",
        "nextPage",
        "prevPage",
        "enabled",
        "email",
        "emailEnabled",
        "messages",
        "greeting",
        "pin",
        "deleteAfterEmail",
      ]);
      const safeLinks = new Set(["messages", "greeting", "greetings", "recordings", "self"]);
      const keys = record(shape) ? Object.keys(shape) : [];
      const linkKeys = record(shape) && record(shape.links) ? Object.keys(shape.links) : [];
      candidate.resourceShape = {
        kind: Array.isArray(shape) ? "array" : "object",
        keys: keys.filter((key) => safeKeys.has(key)).sort(),
        linkKeys: linkKeys.filter((key) => safeLinks.has(key)).sort(),
        otherKeyCount: keys.filter((key) => !safeKeys.has(key)).length,
        otherLinkKeyCount: linkKeys.filter((key) => !safeLinks.has(key)).length,
      };
    }
    candidates.push(candidate);
  }
  return {
    contract: "sipcentric-voicemail-discovery@1",
    customerId: input.customerId,
    observedAt: new Date().toISOString(),
    endpointListingComplete: true,
    endpointCount: endpoints.length,
    requests,
    candidates,
    messageCoverage: "unverified",
  };
}
