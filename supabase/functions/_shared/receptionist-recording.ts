import { record, secureUrl } from "./receptionist-data.ts";

/** Never accepts a caller-supplied URL; scope is checked before artifact retrieval. */
export async function recordingLink(
  callId: unknown,
  assistantId: string,
  key: string,
  request: typeof fetch = fetch,
) {
  if (
    typeof callId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(callId)
  )
    throw Error("Invalid call reference");
  const options = {
    headers: { Authorization: `Bearer ${key}` },
    redirect: "manual" as const,
    signal: AbortSignal.timeout(20000),
  };
  const call = await request(`https://api.vapi.ai/call/${callId}`, options);
  if (!call.ok) throw Error("Call unavailable");
  if (record(await call.json()).assistantId !== assistantId) throw Error("Call unavailable");
  const artifact = await request(`https://api.vapi.ai/call/${callId}/mono-recording`, options);
  const url = secureUrl(artifact.headers.get("location"));
  if (artifact.status !== 302 || !url || new URL(url).hostname === "api.vapi.ai")
    throw Error("Recording unavailable");
  return url;
}
