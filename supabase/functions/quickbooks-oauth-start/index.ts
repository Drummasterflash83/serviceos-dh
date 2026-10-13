import { handleQuickBooksStart } from "../_shared/quickbooks/oauth_http.ts";
import { quickBooksEdgePorts } from "../_shared/quickbooks/edge_ports.ts";
Deno.serve(async (req: Request) => {
  try {
    return await handleQuickBooksStart(req, quickBooksEdgePorts());
  } catch {
    return new Response('{"error":"configuration_unavailable"}', {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
});
