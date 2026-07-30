// ServiceOS — PUBLIC unsubscribe endpoint (Phase 5). verify_jwt = false.
//
// This is deliberately NOT a tenant-user endpoint and shares no tenant-user
// authentication code. Its entire public contract:
//
//   GET  ?t=<token>   → a minimal accessible confirmation page with a POST
//                       form (visible-link flow; nothing is changed on GET).
//   POST ?t=<token>   → applies the unsubscribe. Accepts a normal form post
//                       AND the RFC 8058 one-click body
//                       (List-Unsubscribe=One-Click).
//
// NON-ENUMERATION: invalid, expired, revoked and replayed tokens receive the
// SAME generic success response as a valid one — the endpoint never reveals
// whether an account, person or subscription exists. The token is opaque
// (48 hex chars); no email address or Person id ever appears in a URL. Only
// the token DIGEST is stored server-side; the token itself is never logged.
//
// Idempotent: replays change nothing (one preference fact, one converged
// suppression, one event — enforced in marketing_unsubscribe_apply). A valid
// unsubscribe takes effect IMMEDIATELY for queued and future sends via the
// canonical execution-time authority.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

const TOKEN_RE = /^[0-9a-f]{48}$/;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  body{margin:0;font-family:Inter,Arial,Helvetica,sans-serif;background:#f8fafc;color:#101828;
       display:grid;place-items:center;min-height:100vh;padding:24px}
  main{max-width:420px;background:#fff;border:1px solid #e4e7ec;border-radius:12px;
       padding:32px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;color:#475467;line-height:1.6;margin:0 0 16px}
  button{background:#101828;color:#fff;border:0;border-radius:8px;padding:10px 20px;
         font-size:14px;cursor:pointer}
  button:focus-visible{outline:2px solid #101828;outline-offset:2px}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const GENERIC_DONE = page(
  "Unsubscribed",
  `<h1>You're unsubscribed</h1>
   <p>If this address was receiving marketing email from this sender, it won't any more.
   No further action is needed.</p>`,
);

function confirmPage(token: string): string {
  return page(
    "Unsubscribe",
    `<h1>Unsubscribe from marketing email</h1>
     <p>Confirm below to stop receiving marketing email from this sender.</p>
     <form method="post">
       <input type="hidden" name="t" value="${token}"/>
       <button type="submit">Unsubscribe</button>
     </form>`,
  );
}

function tokenFrom(url: URL, form: FormData | null): string | null {
  const fromQuery = url.searchParams.get("t");
  if (fromQuery && TOKEN_RE.test(fromQuery)) return fromQuery;
  const fromForm = form?.get("t");
  if (typeof fromForm === "string" && TOKEN_RE.test(fromForm)) return fromForm;
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const token = tokenFrom(url, null);
    // an invalid/absent token gets the SAME generic page — no enumeration
    if (!token) return new Response(GENERIC_DONE, { status: 200, headers: PAGE_HEADERS });
    return new Response(confirmPage(token), { status: 200, headers: PAGE_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(GENERIC_DONE, { status: 200, headers: PAGE_HEADERS });
  }

  // POST: visible-link confirmation OR RFC 8058 one-click. Both carry the
  // token in the query string; the form body may repeat it.
  let form: FormData | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      form = await req.formData();
    } catch {
      form = null;
    }
  }
  const token = tokenFrom(url, form);
  if (token) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey);
      try {
        // the RPC is itself idempotent and non-enumerating; its result is
        // deliberately ignored — every caller sees the same response
        await admin.rpc("marketing_unsubscribe_apply", { p_token: token });
      } catch {
        // a transient failure must not reveal anything either; the token
        // remains valid and a retry (or the next one-click) will apply it
      }
    }
  }
  return new Response(GENERIC_DONE, { status: 200, headers: PAGE_HEADERS });
});
