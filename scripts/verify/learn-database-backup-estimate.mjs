/** Public metadata and prices only: never opens archives or contacts an account. */
import { readFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const file = new URL(
  "docs/operations/evidence/learn-database-backup-estimate-2026-10-12.json",
  root,
);
const refresh = process.argv.slice(2).join(" ") === "--refresh-public-prices";
if (process.argv.length > 2 && !refresh) throw Error("Unsupported option");
let pricing;
if (refresh) {
  const url =
    "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/eu-west-2/index.json";
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error("Public price list unavailable");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 8 * 1024 * 1024) throw Error("Public price list exceeds bound");
    chunks.push(chunk);
  }
  const p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const rates = {};
  for (const [name, usage, unit] of [
    ["storage", "EUW2-TimedStorage-ByteHrs", "GB-Mo"],
    ["put", "EUW2-Requests-Tier1", "Requests"],
    ["get", "EUW2-Requests-Tier2", "Requests"],
  ]) {
    const products = Object.entries(p.products).filter(
      ([, v]) => v.attributes.regionCode === "eu-west-2" && v.attributes.usagetype === usage,
    );
    if (products.length !== 1) throw Error("Ambiguous public price product");
    const [sku] = products[0];
    const terms = Object.values(p.terms.OnDemand[sku]);
    if (terms.length !== 1) throw Error("Ambiguous public price term");
    const dimensions = Object.values(terms[0].priceDimensions).filter(
      (d) => d.beginRange === "0" && d.unit === unit,
    );
    if (dimensions.length !== 1) throw Error("Ambiguous public price dimension");
    const usd = Number(dimensions[0].pricePerUnit.USD);
    if (!Number.isFinite(usd) || usd <= 0) throw Error("Invalid public price");
    rates[name] = { sku, usage, unit, usd, effectiveDate: terms[0].effectiveDate };
  }
  pricing = {
    url,
    observedAt: new Date().toISOString(),
    publicationDate: p.publicationDate,
    version: p.version,
    rates,
  };
} else pricing = JSON.parse(readFileSync(file, "utf8")).pricing;
const recovery = JSON.parse(
  readFileSync(
    new URL("docs/operations/evidence/learn-complete-database-recovery-2026-10-12.json", root),
    "utf8",
  ),
);
// Metadata lengths observed locally on 12 October; no source data read here.
const measured = {
  archive: recovery.archive.bytes,
  netSupplement: recovery.netSupplement.bytes,
  sourceInventory: 62654,
  exportReport: 1349,
};
const totalBytes = Object.values(measured).reduce((a, n) => a + n, 0);
if (!Object.values(measured).every((n) => Number.isSafeInteger(n) && n > 0))
  throw Error("Incomplete size baseline");
const planningBytes = 256 * 1024 ** 2;
console.log(
  JSON.stringify(
    {
      contract: "learn-database-backup-estimate/1",
      calculatedAt: new Date().toISOString(),
      currency: "USD",
      region: "eu-west-2",
      pricing,
      sourceSnapshotAt: recovery.sourceSnapshotAt,
      measured: { ...measured, totalBytes, gib: totalBytes / 1024 ** 3 },
      planning: {
        bytesPerSnapshot: planningBytes,
        snapshotsPerDay: 1,
        storageRateAt30RetainedSnapshotsPerMonth:
          ((30 * planningBytes) / 1024 ** 3) * pricing.rates.storage.usd,
        storageRateAt365RetainedSnapshotsPerMonth:
          ((365 * planningBytes) / 1024 ** 3) * pricing.rates.storage.usd,
        putListAllowance1000PerMonth: 1000 * pricing.rates.put.usd,
        getHeadAllowance1000PerMonth: 1000 * pricing.rates.get.usd,
        sourceEgress30ExportsGB: (30 * planningBytes) / 1e9,
        sourceEgressIfEntirelyOverQuota: ((30 * planningBytes) / 1e9) * 0.09,
      },
      egressSource: "https://supabase.com/docs/guides/platform/manage-your-usage/egress",
      assumptions: [
        "Storage figures are monthly run rates at the stated retained volume, not first-month invoices. No automatic expiry; cost accumulates.",
        "256 MiB includes planning headroom, not measured encrypted output or a guaranteed growth bound.",
        "Uncached Supabase egress uses $0.09/GB only above shared quota; remaining quota is unverified.",
        "Excludes restore-download network charges, hosted runner/monitoring, existing subscriptions, taxes, conversion and engineering. No free credits assumed.",
        "Initial proposal provisions storage and bounded backup/restore only. Dependable unattended daily scheduling needs separate verified runtime.",
        "Existing account-wide $5 alert is not a spending cap; delivery must still be verified.",
      ],
    },
    null,
    2,
  ),
);
