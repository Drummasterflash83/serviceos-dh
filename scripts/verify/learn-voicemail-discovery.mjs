// Read-only provider discovery. Reuse existing secrets in environment; never log them.
// Explicit account allowlist prevents falling back to the first accessible account.
import {
  discoverVoicemail,
  DiscoveryError,
} from "../../supabase/functions/_shared/sipcentric-voicemail-discovery.ts";
const customerId = process.env.SIMWOOD_CUSTOMER_ID;
if (!customerId || process.env.VERIFY_ALLOW_SIMWOOD_CUSTOMER_ID !== customerId) {
  console.error(JSON.stringify({ success: false, code: "explicit_customer_allowlist_required" }));
  process.exitCode = 1;
} else {
  try {
    const result = await discoverVoicemail({
      customerId,
      username: process.env.SIMWOOD_USERNAME ?? "",
      password: process.env.SIMWOOD_PASSWORD ?? "",
      requestBudget:
        process.env.VERIFY_SIMWOOD_REQUEST_BUDGET === undefined
          ? 40
          : Number(process.env.VERIFY_SIMWOOD_REQUEST_BUDGET),
      inspectPublishedResources: process.env.VERIFY_INSPECT_VOICEMAIL_RESOURCE === "true",
    });
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
  } catch (e) {
    console.error(
      JSON.stringify({
        success: false,
        code: e instanceof DiscoveryError ? e.code : "discovery_failed",
        retryAfterSeconds: e instanceof DiscoveryError ? e.retryAfterSeconds : null,
        messageCoverage: "unverified",
      }),
    );
    process.exitCode = 1;
  }
}
