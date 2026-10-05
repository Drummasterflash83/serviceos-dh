// Resolve the LOCAL demo login password without ever committing a credential literal.
//
// Order: COMMAND_CENTRE_DEMO_PASSWORD env → ephemeral local-only fallback. The fallback is
// permitted ONLY when the resolved Supabase URL is unquestionably local (loopback + the
// standard local API port); it is REFUSED against any remote URL so a real deployment can
// never be seeded with a weak generated password. Never printed alongside secrets.
export function isLocalSupabaseUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const loopback = host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
    return loopback && (u.port === "54321" || u.port === "");
  } catch {
    return false;
  }
}

export function resolveDemoPassword(url) {
  const env = process.env.COMMAND_CENTRE_DEMO_PASSWORD;
  if (env && env.length >= 8) return env;
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      "COMMAND_CENTRE_DEMO_PASSWORD (>=8 chars) must be set — an ephemeral fallback is refused against a non-local Supabase URL: " + url,
    );
  }
  // Ephemeral, local-only. Not a committed literal; regenerated each run.
  const rand = Buffer.from(`${process.pid}-${process.hrtime.bigint()}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
  return `Local${rand.slice(0, 14)}Aa1!`;
}
