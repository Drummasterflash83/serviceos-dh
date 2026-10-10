/** Exact installed verification endpoint layered over the release-028 catalog. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { installedConnectionSetup } from "./learn-test-commusoft-setup-release.mjs";
import {
  withoutVerificationEndpoint,
  VERIFICATION_ENDPOINT_SHA,
} from "./learn-test-commusoft-verification-deploy.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
export function expectedVerificationEndpoint() {
  const raw = readFileSync(
    new URL(
      "../../supabase/release/learn-test/commusoft_verification_endpoint.expected.json",
      import.meta.url,
    ),
  );
  if (
    createHash("sha256").update(raw).digest("hex") !==
    "682de38bbab80b28f57f188a4f5d338d88b7288d60a306a80e2ae30f7920ec57"
  )
    throw Error("Reviewed verification endpoint differs");
  const r = JSON.parse(raw);
  if (
    r.projectRef !== TEST_PROJECT ||
    r.sourceBundleSha256 !== VERIFICATION_ENDPOINT_SHA ||
    r.endpoint.slug !== "learn-commusoft-verify" ||
    r.endpoint.verify_jwt !== true
  )
    throw Error("Invalid verification endpoint record");
  return r;
}
export function installedVerificationRuntime(c) {
  const e = expectedVerificationEndpoint(),
    found = c.base.functions.filter((f) => f.slug === "learn-commusoft-verify");
  return (
    found.length === 1 &&
    digest(found[0]) === digest(e.endpoint) &&
    installedConnectionSetup(withoutVerificationEndpoint(c))
  );
}
