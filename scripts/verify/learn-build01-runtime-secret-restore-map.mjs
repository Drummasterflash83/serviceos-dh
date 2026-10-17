/** Compare active Edge secret digests with recoverable Vault values; no plaintext leaves SQL. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const bearer = `Bearer ${savedCliToken()}`;
const base = `https://api.supabase.com/v1/projects/${project}`;
async function get(path, init = {}) {
  const response = await fetch(base + path, {
    ...init, headers: { Authorization: bearer, ...(init.headers ?? {}) },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Runtime restore metadata read failed (HTTP ${response.status})`);
  return response.json();
}

const sql = `begin read only; select name,
  encode(extensions.digest(convert_to(decrypted_secret,'UTF8'),'sha256'),'hex') as digest
from vault.decrypted_secrets where name is not null order by name; commit;`;
const [secrets, vault] = await Promise.all([
  get("/secrets"),
  get("/database/query", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  }),
]);
if (!Array.isArray(secrets) || !Array.isArray(vault) ||
    secrets.length > 200 || vault.length > 100 ||
    secrets.some(x => typeof x.name !== "string" || !/^[a-f0-9]{64}$/.test(x.value ?? "")) ||
    vault.some(x => typeof x.name !== "string" || !/^[a-f0-9]{64}$/.test(x.digest ?? "")))
  throw Error("Runtime restore metadata shape changed");

const byName = new Map(secrets.map(x => [x.name, x.value]));
const overlapping = vault.filter(x => byName.has(x.name));
const matching = overlapping.filter(x => byName.get(x.name) === x.digest);
const mismatching = overlapping.filter(x => byName.get(x.name) !== x.digest);
const crossNameMatches = secrets.flatMap(edge => vault
  .filter(saved => edge.name !== saved.name && edge.value === saved.digest)
  .map(saved => ({ edgeName: edge.name, vaultName: saved.name })));
console.log(JSON.stringify({
  version: "learn-build01-runtime-secret-restore-map/1",
  observedAtUtc: new Date().toISOString(), environment: "LIVE", project,
  configuredEdgeEntries: secrets.length,
  configuredValuesAreDigestsOnly: true,
  archivedVaultEntries: vault.length,
  configuredNamesAlsoInVault: overlapping.length,
  digestMatchedVaultAndEdge: matching.length,
  digestMismatchedVaultAndEdge: mismatching.length,
  mismatchNames: mismatching.map(x => x.name),
  crossNameMatchCount: crossNameMatches.length,
  crossNameMatches,
  configuredNamesAbsentFromVault: secrets.length - overlapping.length,
  plaintextValuesReturned: false,
  productionDataWrites: false,
  limitation: "A matching digest proves value parity only for Vault-backed names. Other configured entries may be public, platform-injected, optional or independently sensitive; this readback does not back up their values or prove full application recovery.",
}));
