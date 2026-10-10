declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): void;
};
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };
declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}
