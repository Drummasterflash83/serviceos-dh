import { quickBooksCallbackRoute } from "../_shared/quickbooks/callback_route.ts";
import { handleQuickBooksCallback } from "../_shared/quickbooks/oauth_http.ts";
import { quickBooksEdgePorts } from "../_shared/quickbooks/edge_ports.ts";
Deno.serve(async (req: Request) => {
  try {
    const routed = quickBooksCallbackRoute(req.url, Deno.env.get("SUPABASE_URL")!);
    console.info(JSON.stringify({ event: "quickbooks_callback_route", route: routed.route }));
    return await handleQuickBooksCallback(new Request(routed.url, req), quickBooksEdgePorts());
  } catch {
    return new Response('{"error":"configuration_unavailable"}', {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
});
