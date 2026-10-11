import { Resolver } from "node:dns/promises";
import { signingDomain } from "./signed-source.js";
/** Public DNS only; no caller-controlled resolver address or arbitrary domains. */
export function providerKeyResolver(resolveTxt) {
  const dns = new Resolver({ timeout: 5000, tries: 1 });
  const resolver = resolveTxt ?? dns.resolveTxt.bind(dns);
  const cache = new Map();
  const stats = { dnsQueries: 0, refusedQueries: 0 };
  async function publicKey(name, type) {
    name = String(name).toLowerCase();
    const suffix = "._domainkey." + signingDomain;
    const selector = name.endsWith(suffix) ? name.slice(0, -suffix.length) : "";
    if (type !== "TXT" || !/^[a-z0-9_-]{1,63}$/.test(selector)) {
      stats.refusedQueries++;
      throw Object.assign(Error("Unapproved signing domain"), { code: "ENOTFOUND" });
    }
    if (!cache.has(name)) {
      if (cache.size >= 3) throw Error("DNS budget exceeded");
      stats.dnsQueries++;
      cache.set(
        name,
        Promise.resolve().then(() => resolver(name)),
      );
    }
    return cache.get(name);
  }
  return { resolve: publicKey, stats };
}
