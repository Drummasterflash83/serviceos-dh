/** Verify access through the exact OAuth realm's fixed CompanyInfo read endpoint.
 * CompanyInfo.Id identifies an entity; it is not treated as the OAuth realm ID.
 * A human must confirm the returned company before accounting imports start.
 */
export async function readQuickBooksCompany(
  input: {
    environment: "sandbox" | "production";
    realmId: string;
    accessToken: string;
    minorVersion: number;
  },
  ports: { fetcher?: typeof fetch; stillAuthorized: () => Promise<boolean>; signal?: AbortSignal },
): Promise<{ realmId: string; companyName: string }> {
  const fail = (): never => {
    throw new Error("company_verification_failed");
  };
  if (
    !input ||
    !["sandbox", "production"].includes(input.environment) ||
    !/^[1-9][0-9]{0,29}$/.test(input.realmId) ||
    !/^[\x21-\x7e]{1,16384}$/.test(input.accessToken) ||
    !Number.isSafeInteger(input.minorVersion) ||
    input.minorVersion < 1 ||
    input.minorVersion > 1000
  )
    fail();
  const origin =
    input.environment === "production"
      ? "https://quickbooks.api.intuit.com"
      : "https://sandbox-quickbooks.api.intuit.com";
  const url = new URL(`/v3/company/${input.realmId}/companyinfo/${input.realmId}`, origin);
  url.searchParams.set("minorversion", String(input.minorVersion));
  const signal = ports.signal
    ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)])
    : AbortSignal.timeout(30000);
  try {
    if (!(await ports.stillAuthorized())) fail();
    signal.throwIfAborted();
    const response = await (ports.fetcher ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" },
    });
    if (
      !response.ok ||
      !response.body ||
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
        "application/json"
    ) {
      await response.body?.cancel();
      fail();
    }
    const reader = response.body!.getReader(),
      decoder = new TextDecoder("utf-8", { fatal: true });
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    let text = "",
      length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 262144) fail();
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const body = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      body.Fault ||
      typeof body.CompanyInfo?.Id !== "string" ||
      !/^[A-Za-z0-9-]{1,128}$/.test(body.CompanyInfo.Id) ||
      typeof body.CompanyInfo.CompanyName !== "string" ||
      body.CompanyInfo.CompanyName.trim().length < 1 ||
      body.CompanyInfo.CompanyName.length > 1024
    )
      fail();
    if (!(await ports.stillAuthorized())) fail();
    signal.throwIfAborted();
    return { realmId: input.realmId, companyName: body.CompanyInfo.CompanyName };
  } catch {
    return fail();
  }
}
