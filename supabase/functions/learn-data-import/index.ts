// Governed, signed-in LEARN facade over the recovered universal import engine.
// Bounded upload, explicit profile, no legacy or internal-service fallthrough.
import { handleDataImport } from "../data-import/handler.ts";

export const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "content-type": "application/json",
};
const refuse = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), { status, headers });

export async function handleLearnDataImport(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") return await handleDataImport(req, { governedOnly: true });
    const length = req.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES))
      return refuse(413, "too_large", "Import request exceeds the 16 MiB limit");
    const reader = req.body?.getReader();
    if (!reader) return refuse(400, "invalid_json", "Body must be JSON");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_REQUEST_BYTES) {
          await reader.cancel();
          return refuse(413, "too_large", "Import request exceeds the 16 MiB limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return await handleDataImport(new Request(req.url, {
      method: "POST", headers: req.headers, body: bytes,
    }), { governedOnly: true });
  } catch {
    // No database exception, bearer, CSV row or parser detail in the response.
    return refuse(503, "unavailable", "Import request could not finish; reload its status before retrying");
  }
}

Deno.serve(handleLearnDataImport);
