function sameSecret(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
/** Infrastructure endpoint: user JWTs, anonymous callers, job selectors and
 * supplied credentials cannot trigger work. Uses the existing service key. */
export function slackWorkerEndpoint(serviceKey: string | undefined, run: () => Promise<unknown>) {
  return async (req: Request) => {
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    if (!serviceKey || serviceKey.length < 20)
      return json({ ok: false, code: "worker_unavailable" }, 503);
    const auth = req.headers.get("authorization") ?? "";
    if (!sameSecret(auth, `Bearer ${serviceKey}`))
      return json({ ok: false, code: "worker_forbidden" }, 403);
    // The queue defines the tenant, scope and next work. No request body is used.
    if (req.body !== null) return json({ ok: false, code: "worker_body_not_allowed" }, 400);
    try {
      return json({ ok: true, result: await run() });
    } catch {
      return json({ ok: false, code: "worker_run_failed" }, 503);
    }
  };
}
