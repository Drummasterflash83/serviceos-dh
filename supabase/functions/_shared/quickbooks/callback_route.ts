/** Supabase's gateway terminates TLS and strips /functions/v1 before
 * forwarding to the same project's function. Recover only that exact configured route; never
 * trust forwarded headers or a caller-provided return URL. OAuth state and the
 * registered redirect are still checked by the callback contract afterwards.
 */
export function quickBooksCallbackRoute(receivedUrl: string, projectUrl: string): {
  url: string;
  route: "public" | "functions" | "gateway";
} {
  const invalid = (): never => { throw Error("callback_route_invalid"); };
  const project = new URL(projectUrl), received = new URL(receivedUrl);
  if (project.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(project.hostname) ||
    project.port || project.username || project.password || project.search || project.hash || project.pathname !== "/") invalid();
  if (received.username || received.password || received.hash) invalid();
  const name = "quickbooks-oauth-callback";
  const publicUrl = new URL(`/functions/v1/${name}`, project.origin);
  const functionOrigin = `https://${project.hostname.replace(".supabase.co", ".functions.supabase.co")}`;
  const route = received.origin === publicUrl.origin && received.pathname === publicUrl.pathname ? "public"
    : received.origin === functionOrigin && received.pathname === `/${name}` ? "functions"
    : received.origin === `http://${project.hostname}` && received.pathname === `/${name}` ? "gateway" : invalid();
  publicUrl.search = received.search;
  return { url: publicUrl.href, route };
}
