/** Private playback uses the caller's RLS before any privileged audit or signing. */
export type PlaybackClients = {
  user: (authorization: string) => {
    auth: { getUser(): PromiseLike<any> };
    from(table: string): any;
  };
  admin: () => { from(table: string): any; storage: { from(bucket: string): any } };
  storageOrigin: string;
};
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
async function bodyJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw Error("Missing body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw Error("Body limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function voicemailPlaybackHandler(clients: PlaybackClients) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    try {
      const authorization = req.headers.get("authorization");
      if (!authorization) return reply({ error: "Sign in required" }, 401);
      const userDb = clients.user(authorization);
      const { data: auth, error: authError } = await userDb.auth.getUser();
      if (authError || !uuid(auth?.user?.id)) return reply({ error: "Sign in required" }, 401);
      let body;
      try {
        body = await bodyJson(req);
      } catch {
        return reply({ error: "Invalid message" }, 400);
      }
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(",") !== "messageId,tenantId" ||
        !uuid(body.tenantId) ||
        !uuid(body.messageId)
      )
        return reply({ error: "Invalid message" }, 400);
      const tenant = body.tenantId.toLowerCase(),
        id = body.messageId.toLowerCase();
      const { data: message, error } = await userDb
        .from("receptionist_voicemails")
        .select("id,tenant_id,mailbox_id,recording_path")
        .eq("tenant_id", tenant)
        .eq("id", id)
        .maybeSingle();
      // Missing, forbidden and failed reads have the same response and never sign.
      if (
        error ||
        !message ||
        message.id !== id ||
        message.tenant_id !== tenant ||
        !uuid(message.mailbox_id)
      )
        return reply({ error: "Message unavailable" }, 404);
      const expectedPath = `${tenant}/${message.mailbox_id}/${id}`;
      if (message.recording_path !== expectedPath)
        return reply({ error: "Recording unavailable" }, 404);
      const admin = clients.admin();
      const { error: auditError } = await admin.from("receptionist_voicemail_access_log").insert({
        tenant_id: tenant,
        message_id: id,
        actor_id: auth.user.id,
        action: "playback_link_requested",
      });
      if (auditError) return reply({ error: "Recording access could not be logged" }, 503);
      const { data: signed, error: signError } = await admin.storage
        .from("receptionist-voicemails")
        .createSignedUrl(expectedPath, 60);
      if (signError || typeof signed?.signedUrl !== "string")
        return reply({ error: "Recording unavailable" }, 404);
      const url = new URL(signed.signedUrl);
      if (
        url.protocol !== "https:" ||
        url.origin !== clients.storageOrigin ||
        url.username ||
        url.password ||
        url.hash ||
        decodeURIComponent(url.pathname) !==
          `/storage/v1/object/sign/receptionist-voicemails/${expectedPath}` ||
        !url.searchParams.get("token")
      )
        return reply({ error: "Recording unavailable" }, 404);
      return reply({ url: signed.signedUrl, expiresIn: 60 });
    } catch {
      return reply({ error: "Unable to open voicemail" }, 503);
    }
  };
}
