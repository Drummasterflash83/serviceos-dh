/** One explicit, read-only provider diagnostic. Never sends support messages.
 * Use the real transport; retain redacted wire headers and a bounded error body.
 * Successful customer payloads are never retained in the support report.
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { channel } from "node:diagnostics_channel";
import {
  readCommusoftPage,
  CommusoftReadError,
} from "../../supabase/functions/_shared/commusoft/read_page.ts";
const URL_EXPECTED = "https://app.commusoft.co.uk/api/v2/properties?limit=1";
const maxErrorBytes = 65536;
export function redactTrace(text, key) {
  return String(text)
    .replaceAll(key, "[REDACTED]")
    .replace(
      /^((?:x-api-key|authorization|proxy-authorization|cookie|set-cookie)\s*:).*$/gim,
      "$1 [REDACTED]",
    );
}
async function errorBody(response, key) {
  if (response.status === 200)
    return { omitted: "Successful source records are not support diagnostic data." };
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false, bytes: 0 };
  const chunks = [];
  let size = 0,
    truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const retained = value.subarray(0, Math.max(0, maxErrorBytes - size));
      chunks.push(retained);
      size += retained.length;
      if (size >= maxErrorBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return { text: redactTrace(Buffer.concat(chunks).toString("utf8"), key), truncated, bytes: size };
}
export async function captureSupportTrace(
  apiKey,
  { fetcher = fetch, persist, observeWire = false } = {},
) {
  if (typeof persist !== "function") throw Error("Private durable journal required");
  const report = {
    version: "learn-commusoft-support-trace/1",
    startedAt: new Date().toISOString(),
    request: {
      method: "GET",
      url: URL_EXPECTED,
      applicationHeaders: {
        Authorization: "Bearer [REDACTED]",
        "User-Agent": "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)",
        Accept: "application/json",
      },
      body: null,
      redirectPolicy: "error",
      cookies: "omitted",
      automaticRetries: 0,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      source: "Local Node server transport; not browser fetch or hosted Edge",
    },
    state: "prepared",
    providerRequests: 0,
  };
  await persist(report);
  const wire = ({ request, headers, socket }) => {
    if (
      String(request.origin) !== "https://app.commusoft.co.uk" ||
      request.path !== "/api/v2/properties?limit=1"
    )
      return;
    report.request.wireHeaders = redactTrace(headers, apiKey);
    report.tls = {
      authorized: socket.authorized === true,
      protocol: socket.getProtocol?.() ?? null,
    };
  };
  if (observeWire) channel("undici:client:sendHeaders").subscribe(wire);
  try {
    const page = await readCommusoftPage(
      { region: "uk", resource: "properties", after: null, limit: 1 },
      apiKey,
      {
        stillAuthorized: async () => true,
        fetcher: async (url, init) => {
          if (url !== URL_EXPECTED || init.method !== "GET" || report.providerRequests !== 0)
            throw Error("Unexpected provider request");
          report.state = "sending";
          report.sentAt = new Date().toISOString();
          report.providerRequests = 1;
          await persist(report);
          const response = await fetcher(url, init);
          const headers = Object.fromEntries(
            [...response.headers].map(([k, v]) => [
              k,
              /^(set-cookie|cookie|authorization|proxy-authorization|x-api-key)$/i.test(k)
                ? "[REDACTED]"
                : redactTrace(v, apiKey),
            ]),
          );
          report.response = {
            status: response.status,
            statusText: response.statusText,
            headers,
            body:
              response.status === 200
                ? { omitted: "Successful source records are not support diagnostic data." }
                : await errorBody(response.clone(), apiKey),
          };
          return response;
        },
      },
    );
    report.result = {
      state: "read_verified",
      records: page.records.length,
      hasMore: !page.collectionExhausted,
      quota: page.quota,
    };
  } catch (error) {
    report.result = {
      state: "not_verified",
      code: error instanceof CommusoftReadError ? error.code : "trace_failed",
    };
  } finally {
    if (observeWire) channel("undici:client:sendHeaders").unsubscribe(wire);
  }
  report.state = "completed";
  report.completedAt = new Date().toISOString();
  const sanitized = JSON.parse(redactTrace(JSON.stringify(report), apiKey));
  await persist(sanitized);
  return sanitized;
}
async function main() {
  if (process.argv.slice(2).join(" ") !== "--existing-local-key")
    throw Error("Explicit existing key mode required");
  const root = new URL("../../.verification-results/", import.meta.url);
  const keyFile = new URL("commusoft-existing-private-key", root);
  const meta = await stat(keyFile);
  if (!meta.isFile() || meta.mode & 0o077 || meta.size > 4096)
    throw Error("Private key file required");
  const key = (await readFile(keyFile, "utf8")).trim();
  if (!/^[\x21-\x7e]{1,4096}$/.test(key)) throw Error("Invalid key shape");
  const path = new URL("commusoft-support-trace-2026-10-10.json", root);
  await writeFile(path, "{}\n", { mode: 0o600, flag: "wx" });
  const report = await captureSupportTrace(key, {
    observeWire: true,
    persist: (r) => writeFile(path, JSON.stringify(r, null, 2) + "\n", { mode: 0o600 }),
  });
  // No headers or body printed automatically; inspect the private report deliberately.
  console.log(
    JSON.stringify({
      state: report.result.state,
      httpStatus: report.response?.status,
      providerRequests: report.providerRequests,
      reportPath: fileURLToPath(path),
    }),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error("Trace stopped; inspect the private journal before considering another request.");
    process.exitCode = 1;
  });
