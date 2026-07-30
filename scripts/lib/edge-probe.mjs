// ServiceOS — shared "is this Edge function actually served?" classifier.
//
// Both staged Marketing HTTP suites must decide the same question the same way:
// may this run report a PASS, or must it honestly refuse?
//
// The rule is derived from observed local behaviour, not assumed. Against an
// unserved local stack the API gateway answers EVERY function path — real names
// and nonsense names alike — with:
//
//     HTTP 500  {"message":"An unexpected error occurred"}
//
// So a 5xx carries no information about whether our function exists. It cannot
// be read as "unserved" (a served-but-crashing function looks identical) and it
// certainly cannot be read as "served". Collapsing that into "endpoint
// unreachable, go serve the functions" states something the probe cannot know,
// and sends someone to fix the wrong thing when the function is deployed and
// broken.
//
// Hence three outcomes, not two:
//
//   served     — the FUNCTION's own gate answered (auth, permission or request
//                validation). Only this permits the suite to run and report.
//   unserved   — the gateway positively denied the route.
//   ambiguous  — a 5xx or a transport failure. The suite still refuses to
//                report a pass, but says WHY it cannot tell.
//
// Only `served` is ever treated as permission to claim a result.

/** @typedef {"served" | "unserved" | "ambiguous"} ProbeVerdict */

/**
 * Classify a probe response.
 * @param {{status?: number, transportError?: boolean}} observation
 * @returns {{verdict: ProbeVerdict, reason: string}}
 */
export function classifyProbe(observation) {
  if (observation?.transportError) {
    return {
      verdict: "ambiguous",
      reason: "the request never completed — nothing can be concluded about the function",
    };
  }
  const status = observation?.status;
  if (typeof status !== "number") {
    return { verdict: "ambiguous", reason: "no HTTP status was observed" };
  }
  // The function's own gate answered: auth, permission or request validation.
  if (status === 400 || status === 401 || status === 403) {
    return { verdict: "served", reason: `the function answered from its own gate (${status})` };
  }
  // Any other non-5xx answer still came from something willing to speak for
  // this route, so the suite may proceed and judge the real contract.
  if (status < 500) {
    return { verdict: "served", reason: `the route answered with ${status}` };
  }
  // The gateway positively denies the route.
  if (status === 503 || status === 504) {
    return {
      verdict: "unserved",
      reason: `the gateway reported the route unavailable (${status})`,
    };
  }
  return {
    verdict: "ambiguous",
    reason:
      `HTTP ${status} is returned both by an UNSERVED local gateway and by a SERVED ` +
      "function that is failing — this probe cannot tell them apart, so it refuses to guess",
  };
}

/** Only a positively served route permits a suite to report a result. */
export const mayReportResults = (v) => v === "served";

/**
 * The message a staged suite prints when it refuses to run.
 * @param {string} fnName
 * @param {{verdict: ProbeVerdict, reason: string}} c
 */
export function notRunMessage(fnName, c) {
  return [
    `NOT-RUN  ${fnName}: ${c.verdict.toUpperCase()}`,
    `Reason:  ${c.reason}`,
    "",
    c.verdict === "ambiguous"
      ? "Do NOT assume the function is merely unserved: check whether it is deployed and throwing."
      : "Serve the functions (supabase functions serve) or point at a deployed env.",
    "",
    "This suite deliberately refuses to report success it did not observe.",
  ].join("\n");
}
