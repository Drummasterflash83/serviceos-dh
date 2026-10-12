import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { voicemailPlaybackHandler } from "../_shared/voicemail/playback-http.ts";
const origin = Deno.env.get("SUPABASE_URL")!;
Deno.serve(
  voicemailPlaybackHandler({
    storageOrigin: new URL(origin).origin,
    user: (authorization) =>
      createClient(origin, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      }),
    admin: () =>
      createClient(origin, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
      }),
  }),
);
