// Manual timeline requests are queued; the claimed worker owns all publication.
import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { processingRequestHandler } from "../_shared/learn-processing-request.ts";
Deno.serve(processingRequestHandler("interactions.sync", createSupabaseAdmin));
