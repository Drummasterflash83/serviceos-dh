/** The public home is built with the same Git source as the signed-in app. */
export function publishedBuildSha(html: string): string | null {
  const tag = html.match(/<meta\s+name="openfolk-build"\s+content="([^"]+)"\s*\/?\s*>/i);
  const sha = tag?.[1];
  return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
}

export function newerBuildAvailable(current: string, published: string | null): boolean {
  return /^[0-9a-f]{40}$/i.test(current) &&
    published !== null && current.toLowerCase() !== published;
}
