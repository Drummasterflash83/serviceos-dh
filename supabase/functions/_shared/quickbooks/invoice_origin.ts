/** The operator console moved to app.openfolk.ai while existing QuickBooks
 * configuration still names www.openfolk.ai. Keep this one route limited to
 * those exact HTTPS origins; the authenticated operator gate remains separate. */
export function invoiceCheckCorsOrigin(configuredOrigin: string, requestOrigin: string | null): string | null {
  const allowed = configuredOrigin === "https://www.openfolk.ai"
    ? [configuredOrigin, "https://app.openfolk.ai"]
    : [configuredOrigin];
  if (requestOrigin === null) return configuredOrigin;
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}
