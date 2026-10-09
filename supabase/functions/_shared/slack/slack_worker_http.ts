function sameSecret(actual: string, expected: string) {
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
/** Infrastructure endpoint: the explicitly configured trigger key travels in a
 * dedicated header, independently of gateway JWT translation. No job selectors. */
export function slackWorkerEndpoint(triggerKey: string | undefined, run: () => Promise<unknown>) {
  return async (req: Request) => {
    if (req.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
    if (!triggerKey || triggerKey.length < 20)
      return json({ ok: false, code: "worker_unavailable" }, 503);
    const supplied = req.headers.get("x-serviceos-worker-key") ?? "";
    if (!sameSecret(supplied, triggerKey))
      return json({ ok: false, code: "worker_forbidden" }, 403);
    // The queue defines the tenant, scope and next work. No request body is used.
    if (req.body !== null) {
      // Native server Requests may expose an empty stream for an empty POST.
      // Inspect at most one chunk and never parse or retain caller content.
      const reader = req.body.getReader();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const part = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error()), 3000);
          }),
        ]);
        if (!part.done) return json({ ok: false, code: "worker_body_not_allowed" }, 400);
      } catch {
        return json({ ok: false, code: "worker_body_not_allowed" }, 400);
      } finally {
        clearTimeout(timer);
        void reader.cancel().catch(() => {});
      }
    }
    try {
      return json({ ok: true, result: await run() });
    } catch {
      return json({ ok: false, code: "worker_run_failed" }, 503);
    }
  };
}
