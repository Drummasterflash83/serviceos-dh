/** Non-secret deployment diagnostics. Never expose the client key or session. */
export function publicAuthTarget(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    if (parsed.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:')) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
