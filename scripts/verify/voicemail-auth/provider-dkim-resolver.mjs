import { Resolver } from "node:dns/promises";
import { signingDomain } from "./signed-voicemail.mjs";
export function providerKeyResolver() {
  const resolver = new Resolver({ timeout: 5000, tries: 1 });
  const cache = new Map();
  const stats = { dnsQueries: 0, refusedQueries: 0 };
  async function publicKey(name, type) {
    name = String(name).toLowerCase();
    if (
      type !== "TXT" ||
      !/^[a-z0-9_-]{1,63}\._domainkey\./.test(name) ||
      !name.endsWith("._domainkey." + signingDomain)
    ) {
      stats.refusedQueries++;
      throw Object.assign(Error("Unapproved signing domain"), { code: "ENOTFOUND" });
    }
    if (!cache.has(name)) {
      if (++stats.dnsQueries > 3) throw Error("DNS budget exceeded");
      cache.set(name, resolver.resolveTxt(name));
    }
    return cache.get(name);
  }
  return { resolve: publicKey, stats };
}
