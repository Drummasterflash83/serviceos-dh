import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in required" }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: auth, error: authError } = await userDb.auth.getUser();
    if (authError || !auth.user) return reply({ error: "Sign in required" }, 401);
    const body = await req.json();
    if (
      !body ||
      typeof body.tenantId !== "string" ||
      !uuid.test(body.tenantId) ||
      typeof body.messageId !== "string" ||
      !uuid.test(body.messageId)
    )
      return reply({ error: "Invalid message" }, 400);
    // User credentials, not service-role, authorise reads. Absent and forbidden look identical.
    const { data: message, error } = await userDb
      .from("receptionist_voicemails")
      .select("id,tenant_id,mailbox_id,recording_path")
      .eq("tenant_id", body.tenantId)
      .eq("id", body.messageId)
      .maybeSingle();
    if (error || !message) return reply({ error: "Message unavailable" }, 404);
    const expectedPath = `${message.tenant_id}/${message.mailbox_id}/${message.id}`;
    if (!message.recording_path || message.recording_path !== expectedPath)
      return reply({ error: "Recording unavailable" }, 404);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { error: auditError } = await admin.from("receptionist_voicemail_access_log").insert({
      tenant_id: message.tenant_id,
      message_id: message.id,
      actor_id: auth.user.id,
      action: "playback_link_requested",
    });
    if (auditError) return reply({ error: "Recording access could not be logged" }, 503);
    const { data: signed, error: signError } = await admin.storage
      .from("receptionist-voicemails")
      .createSignedUrl(expectedPath, 60);
    if (signError || !signed?.signedUrl) return reply({ error: "Recording unavailable" }, 404);
    return reply({ url: signed.signedUrl, expiresIn: 60 });
  } catch {
    return reply({ error: "Unable to open voicemail" }, 400);
  }
});
