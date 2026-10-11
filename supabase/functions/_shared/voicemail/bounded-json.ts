/** Bounded server-side transport. Error responses are never returned or logged. */
export async function readBoundedJson(response: Response, maximum: number): Promise<any> {
  if (!response.body) throw Error("voicemail_provider_response_invalid");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body.cancel();
    throw Error("voicemail_provider_response_too_large");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximum) throw Error("voicemail_provider_response_too_large");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally {
      bytes.fill(0);
    }
  } finally {
    await reader.cancel().catch(() => {});
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}
