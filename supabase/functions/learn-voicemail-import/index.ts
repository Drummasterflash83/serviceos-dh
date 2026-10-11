// Prepared only. No cron, queue registration, route activation or credentials seeded.
// Deploy with verify_jwt=false: the handler verifies the exact existing server key.
import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { importPrivateVoicemail } from "../_shared/voicemail/edge.js";
import { importWorkspaceVoicemail } from "../_shared/voicemail/workspace-import.ts";
import { createVoicemailImportHttpHandler } from "../_shared/voicemail/import-http.ts";
const handler = createVoicemailImportHttpHandler({
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  internalKey: Deno.env.get("SERVICEOS_INTERNAL_KEY"),
  run: async (input) => {
    const admin = createSupabaseAdmin();
    if (!admin) throw Error("voicemail_import_unconfirmed");
    return importWorkspaceVoicemail(admin, input, { importer: importPrivateVoicemail });
  },
});
Deno.serve(handler);
