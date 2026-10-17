/** Names-only recovery coverage for every configured LIVE Edge binding.
 * No plaintext or digest is emitted. Every category must be exact/disjoint.
 */
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { REQUIRED_NAMES, OPTIONAL_NAMES } from "../backup/edge-runtime-seal.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const root = `https://api.supabase.com/v1/projects/${project}`;
const headers = { Authorization: `Bearer ${savedCliToken()}` };
const get = async (path, options = {}) => {
  const response = await fetch(root + path, { ...options,
    headers: { ...headers, ...(options.headers ?? {}) }, redirect: "error",
    signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Recovery metadata HTTP ${response.status}`);
  return response.json();
};
const vaultSql = "begin read only; select name from vault.decrypted_secrets where name is not null order by name; commit;";
const [edgeRows, vaultRows, keyRows] = await Promise.all([
  get("/secrets"),
  get("/database/query", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: vaultSql }) }),
  get("/api-keys?reveal=true"),
]);
if (!Array.isArray(edgeRows) || edgeRows.length > 200 ||
    edgeRows.some(row => typeof row.name !== "string" || !/^[a-f0-9]{64}$/.test(row.value ?? "")) ||
    !Array.isArray(vaultRows) || vaultRows.length > 100 ||
    vaultRows.some(row => typeof row.name !== "string") ||
    !Array.isArray(keyRows))
  throw Error("Recovery metadata shape changed");
const active = new Map(edgeRows.map(row => [row.name, row.value]));
if (active.size !== edgeRows.length) throw Error("Duplicate active setting names");
const vault = vaultRows.map(row => row.name).filter(name => active.has(name));
const packageNames = [...REQUIRED_NAMES, ...OPTIONAL_NAMES];
const rebound = ["LEARN_COMMUSOFT_WORKER_KEY", "LEARN_SLACK_WORKER_KEY"];
const projectBindings = ["SUPABASE_ANON_KEY", "SUPABASE_DB_URL", "SUPABASE_JWKS",
  "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"];
const reviewedReleaseControls = ["GOOGLE_REDIRECT_URI", "LEARN_INPUT_DISPATCH_ENABLED",
  "LEARN_QUICKBOOKS_DISPATCH_ENABLED", "LEARN_SLACK_DISPATCH_ENABLED",
  "LEARN_SLACK_EVENTS_ACTIVE", "LEARN_SLACK_EVENTS_APP_ID",
  "LEARN_SLACK_EVENTS_EXPECTED_CHANNELS", "LEARN_SLACK_EVENTS_MIN_TS",
  "LEARN_SLACK_EVENTS_ROSTER_SHA256", "LEARN_SLACK_EVENTS_TEAM_ID",
  "LEARN_SLACK_EVENTS_TENANT_ID", "LEARN_STATUS_READ_MODE",
  "QUICKBOOKS_MINOR_VERSION", "QUICKBOOKS_SITE_ORIGIN", "MARKETING_PUBLIC_BASE_URL",
  "OPENAI_ANALYSIS_MODEL", "OPENAI_EMMA_REVIEW_MODEL", "OPENAI_TRANSCRIPTION_MODEL"];
const databaseControls = ["GOOGLE_WORKSPACE_CLIENT_EMAIL", "GOOGLE_WORKSPACE_DOMAIN",
  "GOOGLE_WORKSPACE_PROJECT_ID"];
const additionalProviderBindings = ["MARKETING_TRACKING_SECRET", "OPENAI_EMMA_REVIEW_KEY",
  "RECEPTIONIST_SLACK_DRUMMONDS", "RECEPTIONIST_VAPI_DRUMMONDS", "RESEND_API_KEY"];
const legacyUnused = ["GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT"];
const categories = { vault, packageNames, rebound, projectBindings,
  reviewedReleaseControls, databaseControls, additionalProviderBindings, legacyUnused };
const all = Object.values(categories).flat();
const unknown = [...active.keys()].filter(name => !all.includes(name));
if (active.size !== 62 || new Set(all).size !== all.length ||
    all.some(name => !active.has(name)) || unknown.length)
  throw Error("Recovery coverage categories incomplete");
if (vault.length !== 15 || packageNames.length !== 11 ||
    reviewedReleaseControls.length !== 18 || databaseControls.length !== 3)
  throw Error("Recovery category counts changed");
const service = keyRows.filter(row => row.name === "service_role");
if (service.length !== 1 || typeof service[0].api_key !== "string")
  throw Error("Service key metadata changed");
const serviceDigest = createHash("sha256").update(service[0].api_key).digest("hex");
const reboundDigestMatches = rebound.every(name => active.get(name) === serviceDigest);
console.log(JSON.stringify({ version: "learn-build01-edge-recovery-coverage/1",
  observedAtUtc: new Date().toISOString(), project,
  activeBindings: active.size,
  categories: Object.fromEntries(Object.entries(categories).map(([name, names]) => [name,
    { count: names.length, names: names.sort() }])),
  unclassified: unknown.length, reboundDigestMatches,
  packageCiphertextCopiedAndDownloaded: true,
  packagePrivateKeyRestoreVerified: false,
  authenticatedProviderRestartVerified: false,
  plaintextValuesReturned: false, digestValuesReturned: false,
  productionDataWrites: false,
  limitation: "Classification and prior digest evidence show candidate restore sources, not a complete replacement runtime. The five additional configured provider bindings and one unused global Workspace subject are outside the exact one-time package." }));
