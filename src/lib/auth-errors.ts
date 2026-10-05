/**
 * Turn provider/authentication failures into safe, useful customer-facing copy.
 *
 * Provider messages are deliberately not rendered verbatim. They can expose
 * implementation details (and, in the case of a quota restriction, make a
 * healthy account look as though its password is wrong).
 */
export function friendlySignInError(message: string | null | undefined): string | null {
  if (!message) return null;

  const normalised = message.toLowerCase();

  if (
    normalised.includes("exceed_egress_quota") ||
    normalised.includes("service for this project is restricted") ||
    normalised.includes("spend caps")
  ) {
    return "OpenFolk is temporarily unavailable because its hosting allowance has been reached. Your account and password are not the problem. Please contact OpenFolk support or try again shortly.";
  }

  if (normalised.includes("invalid login credentials")) {
    return "The email address or password is incorrect.";
  }

  if (
    normalised.includes("failed to fetch") ||
    normalised.includes("network") ||
    normalised.includes("load failed")
  ) {
    return "OpenFolk cannot be reached at the moment. Please check your connection and try again.";
  }

  return "We couldn’t sign you in. Please try again. If the problem continues, contact OpenFolk support.";
}
