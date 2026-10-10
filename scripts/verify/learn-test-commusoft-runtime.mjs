/** Normalize only the recorded, source-preserving TEST trigger refresh. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { exactRuntimeRefresh } from "./learn-test-commusoft-key.mjs";
import { installedCommusoft } from "./learn-test-commusoft-release.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export function expectedCommusoftRuntime() {
  const raw = readFileSync(
    new URL(
      "../../supabase/release/learn-test/commusoft_trigger_refresh.expected.json",
      import.meta.url,
    ),
  );
  if (
    createHash("sha256").update(raw).digest("hex") !==
    "29ab137b92d9177ed9129ec7ed4c49a8ac5457b013eef6d90148955ce9986cdb"
  )
    throw Error("Reviewed Commusoft runtime refresh differs");
  const r = JSON.parse(raw);
  if (r.projectRef !== TEST_PROJECT || !exactRuntimeRefresh(r.beforeEndpoints, r.afterEndpoints))
    throw Error("Runtime refresh changes more than versions");
  return r;
}
export function beforeCommusoftTrigger(c) {
  const e = expectedCommusoftRuntime();
  if (digest(c.base.functions) !== digest(e.afterEndpoints))
    throw Error("Exact refreshed endpoint set required");
  const prior = structuredClone(c);
  prior.base.functions = e.beforeEndpoints;
  prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
  return prior;
}
export function installedCommusoftWithTrigger(c) {
  try {
    return installedCommusoft(beforeCommusoftTrigger(c));
  } catch {
    return false;
  }
}

export function expectedCommusoftEndpoint() {
  const raw = readFileSync(
    new URL(
      "../../supabase/release/learn-test/commusoft_worker_endpoint.expected.json",
      import.meta.url,
    ),
  );
  if (
    createHash("sha256").update(raw).digest("hex") !==
    "a63f6ec2559c4e2335af4f4876eade01ed3b2ffa67bcb7cecaaf5058a5304a0b"
  )
    throw Error("Reviewed Commusoft endpoint differs");
  const r = JSON.parse(raw);
  if (
    r.projectRef !== TEST_PROJECT ||
    r.endpoint.slug !== "learn-commusoft-worker" ||
    r.endpoint.verify_jwt !== true
  )
    throw Error("Invalid reviewed Commusoft endpoint");
  return r;
}
export function installedCommusoftWorker(c) {
  try {
    const expected = expectedCommusoftEndpoint(),
      endpoints = c.base.functions.filter((f) => f.slug === "learn-commusoft-worker");
    if (endpoints.length !== 1 || digest(endpoints[0]) !== digest(expected.endpoint)) return false;
    const prior = structuredClone(c);
    prior.base.functions = prior.base.functions.filter((f) => f.slug !== "learn-commusoft-worker");
    prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
    return installedCommusoftWithTrigger(prior);
  } catch {
    return false;
  }
}
