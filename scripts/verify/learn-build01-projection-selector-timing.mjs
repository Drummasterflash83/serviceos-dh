/** Read-only scoped RPC timing; never prints keys, source IDs or message rows. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--live-read-only --limit-100",
    "--live-read-only --reverse", "--live-read-only --limit-100 --reverse"].includes(mode))
  throw Error("Exact LIVE selector diagnostic required");
const limit = mode.includes("--limit-100") ? 100 : 200;
const sources = mode.endsWith("--reverse") ? ["all", "email"] : ["email", "all"];
const token = savedCliToken();
const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error",
});
if (!keysResponse.ok) throw Error(`Existing scoped key inventory HTTP ${keysResponse.status}`);
const keys = await keysResponse.json();
const service = Array.isArray(keys) ? keys.filter(k => k.name === "service_role") : [];
if (service.length !== 1 || typeof service[0].api_key !== "string")
  throw Error("Unique existing service key unavailable");
const key = service[0].api_key;
const parts = key.split(".");
if (parts.length !== 3) throw Error("Existing service key format changed");
const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
if (claims.ref !== project || claims.role !== "service_role")
  throw Error("Existing service key scope differs");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const results = [];
for (const source of sources) {
  const start = performance.now();
  const response = await fetch(`https://${project}.supabase.co/rest/v1/rpc/learn_projection_pending`, {
    method: "POST", headers, body: JSON.stringify({ p_tenant: tenant, p_source: source, p_limit: limit }),
    signal: AbortSignal.timeout(30000), redirect: "error",
  });
  const durationMs = Math.round(performance.now() - start);
  const body = await response.json().catch(() => null);
  if (response.ok) {
    if (!Array.isArray(body) || body.length > limit || body.some(row => row?.source_kind !== "email" && row?.source_kind !== "phone"))
      throw Error("Selector result invalid");
    results.push({ source, http: response.status, durationMs, rows: body.length,
      sourceKinds: { phone: body.filter(row => row.source_kind === "phone").length,
        email: body.filter(row => row.source_kind === "email").length } });
  } else {
    results.push({ source, http: response.status, durationMs,
      sqlstate: typeof body?.code === "string" && /^[A-Z0-9]{5}$/.test(body.code) ? body.code : null });
  }
}
console.log(JSON.stringify({ version: "learn-build01-projection-selector-timing/1",
  observedAt: new Date().toISOString(), limit, results, sourceProviderRequests: 0,
  productionDataWrites: false, customerRowsPrinted: false, credentialPrinted: false }));
