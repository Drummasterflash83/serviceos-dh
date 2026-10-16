/** Exact LIVE-only customer-card provenance frontend release.
 * Uses the existing Vercel CLI credential, never prints it or app secrets.
 * A deployment is created without assigning domains; promotion is separate. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
if (!["plan", "create", "inspect", "promote", "readback"].includes(mode)) throw Error("Mode required");
const root = ".verification-results/learn-build01-provenance-live-release-20261016";
mkdirSync(root, { recursive: true, mode: 0o700 });
const save = (name, data) => writeFileSync(join(root, `${name}.json`), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
const read = (name) => JSON.parse(readFileSync(join(root, `${name}.json`), "utf8"));
const projectId = "prj_XEuCp5gnEireW5WynUgkRp9QNiXa";
const teamId = "team_PGUQWiaAZZkMTCM9nSHahIpG";
const repoId = "1285975013";
const baseSha = "79d872084e089cc037dd4d5c06235951b028dfd4";
const candidateSha = "7ef08a5bffdb561350e5830518eee71cbb67b7c8";
const candidateBranch = "codex/learn-build01-provenance-live-20261016";
const domains = ["app.openfolk.ai", "openfolk.ai", "serviceos-dh.vercel.app", "www.openfolk.ai"];
const token = JSON.parse(readFileSync(join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"), "utf8")).token;
async function api(path, method = "GET", body) {
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method, redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Error(`Vercel ${response.status} on ${method} ${path}`);
  return response.json();
}
const project = await api(`/v9/projects/${projectId}`);
if (project.id !== projectId || project.accountId !== teamId ||
    project.ssoProtection?.deploymentType !== "all_except_custom_domains" || project.rollingRelease)
  throw Error("LIVE project identity or protection changed");
const aliases = [];
for (const alias of domains) {
  const row = await api(`/v4/aliases/${alias}`);
  if (row.projectId !== projectId) throw Error("LIVE alias project changed");
  aliases.push({ alias, deploymentId: row.deploymentId, redirect: row.redirect ?? null });
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const baselineId = aliases[0].deploymentId;
if (!aliases.every((row) => row.deploymentId === baselineId)) throw Error("LIVE aliases disagree");
const baseline = await api(`/v13/deployments/${baselineId}`);
const current = { aliases, protection: project.ssoProtection, productionId: project.targets?.production?.id ?? null };
if (mode === "readback") {
  const plan = read("plan"), saved = read("deployment");
  if (baselineId !== saved.id || baseline.readyState !== "READY" ||
      baseline.gitSource?.sha !== candidateSha ||
      !aliases.every((row) => row.deploymentId === saved.id) ||
      !same(current.protection, plan.current.protection) ||
      current.productionId !== plan.current.productionId ||
      !aliases.every((row, i) => row.redirect === plan.current.aliases[i].redirect))
    throw Error("Post-release LIVE readback differs");
  save("readback", { state: "LIVE aliases and protection verified", deploymentId: saved.id,
    candidateSha, aliases, protected: true });
  console.log(JSON.stringify({ mode, state: "LIVE aliases and protection verified", deploymentId: saved.id, candidateSha, domains }));
} else if (mode === "plan") {
  if (baseline.readyState !== "READY" || baseline.gitSource?.sha !== baseSha ||
      baseline.target !== "production" || current.productionId !== baselineId)
    throw Error("LIVE source baseline changed");
  save("plan", { current, baselineId, baseSha, candidateSha, candidateBranch });
  console.log(JSON.stringify({ mode, baselineId, baseSha, candidateSha, domains }));
} else {
  const plan = read("plan");
  if (!same(current, plan.current) || plan.candidateSha !== candidateSha || plan.baseSha !== baseSha)
    throw Error("LIVE baseline drifted");
  if (mode === "create") {
    const request = { name: "serviceos-dh", project: projectId, target: "production",
      autoAssignCustomDomains: false,
      gitSource: { type: "github", repoId, ref: candidateBranch, sha: candidateSha },
      projectSettings: { framework: "tanstack-start", buildCommand: "npm run build", installCommand: "npm install", nodeVersion: "24.x" } };
    save("create-intent", { candidateSha, baselineId, request });
    const result = await api("/v13/deployments", "POST", request);
    save("deployment", { id: result.id ?? result.uid, url: result.url, candidateSha });
    console.log(JSON.stringify({ mode, id: result.id ?? result.uid, url: result.url }));
  } else {
    const saved = read("deployment");
    const deployment = await api(`/v13/deployments/${saved.id}`);
    if (deployment.projectId !== projectId || deployment.ownerId !== teamId ||
        deployment.gitSource?.sha !== candidateSha ||
        String(deployment.gitSource?.repoId) !== repoId ||
        deployment.gitSource?.type !== "github" ||
        deployment.autoAssignCustomDomains !== false || deployment.target !== "production")
      throw Error("Candidate source or target differs");
    if (mode === "inspect") {
      save("inspection", { id: saved.id, url: saved.url, state: deployment.readyState, candidateSha });
      console.log(JSON.stringify({ mode, id: saved.id, state: deployment.readyState, url: saved.url }));
    } else {
      const binding = read("binding");
      if (deployment.readyState !== "READY" || binding.deploymentId !== saved.id ||
          binding.backend !== "tgbnakbxwcqjeimygroz" || binding.rendered !== true)
        throw Error("LIVE build/backend proof missing");
      for (const row of plan.current.aliases) {
        const latest = await api(`/v4/aliases/${row.alias}`);
        if (latest.projectId !== projectId || latest.deploymentId !== row.deploymentId ||
            (latest.redirect ?? null) !== row.redirect) throw Error("Alias changed before assignment");
        save(`alias-intent-${row.alias}`, { alias: row.alias, previousId: row.deploymentId, candidateId: saved.id });
        await api(`/v2/deployments/${saved.id}/aliases`, "POST", { alias: row.alias, ...(row.redirect ? { redirect: row.redirect } : {}) });
        const after = await api(`/v4/aliases/${row.alias}`);
        if (after.deploymentId !== saved.id || after.projectId !== projectId ||
            (after.redirect ?? null) !== row.redirect) throw Error("Alias assignment unconfirmed");
      }
      save("verified", { state: "LIVE aliases verified", candidateSha, deploymentId: saved.id, previous: plan.current.aliases });
      console.log(JSON.stringify({ mode, state: "LIVE aliases verified", id: saved.id, domains }));
    }
  }
}
