/** Public-price estimate only. Reads the sanitized size baseline; never reads
 * recordings, accesses an AWS account, provisions services or transfers data. */
import { readFileSync } from "node:fs";
const refresh = process.argv.slice(2).join(" ") === "--refresh-public-prices";
if (process.argv.length > 2 && !refresh) throw Error("Unsupported estimate option");
const root = new URL("../../", import.meta.url);
const baseline = JSON.parse(
  readFileSync(new URL("docs/operations/evidence/learn-launch-baseline-2026-10-11.json", root)),
);
const spec = {
  AmazonS3: {
    storage: ["EUW2-TimedStorage-ByteHrs", "GB-Mo"],
    put: ["EUW2-Requests-Tier1", "Requests"],
    get: ["EUW2-Requests-Tier2", "Requests"],
  },
  AWSLambda: {
    compute: ["EUW2-Lambda-GB-Second", "Lambda-GB-Second"],
    invocation: ["EUW2-Request", "Request"],
  },
  AWSSecretsManager: {
    secret: ["EUW2-AWSSecretsManager-Secrets", "Secrets"],
    secretRead: ["EUW2-AWSSecretsManagerAPIRequest", "API Requests"],
  },
};
let pricing;
if (refresh) {
  const results = await Promise.allSettled(
    Object.entries(spec).map(async ([service, selections]) => {
      const url = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/eu-west-2/index.json`;
      const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Error("Public price list unavailable");
      const chunks = [];
      let bytes = 0;
      for await (const chunk of r.body) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) throw Error("Price list exceeds bound");
        chunks.push(chunk);
      }
      const p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const rates = {};
      for (const [name, [usage, unit]] of Object.entries(selections)) {
        const products = Object.entries(p.products).filter(
          ([, product]) =>
            product.attributes.regionCode === "eu-west-2" && product.attributes.usagetype === usage,
        );
        if (products.length !== 1) throw Error("Ambiguous price product");
        const [sku] = products[0];
        const terms = Object.values(p.terms.OnDemand[sku]);
        if (terms.length !== 1) throw Error("Ambiguous price term");
        const dimensions = Object.values(terms[0].priceDimensions).filter(
          (d) => d.beginRange === "0" && d.unit === unit,
        );
        if (dimensions.length !== 1) throw Error("Ambiguous first-tier price");
        const rate = Number(dimensions[0].pricePerUnit.USD);
        if (!Number.isFinite(rate) || rate <= 0) throw Error("Missing USD rate");
        rates[name] = { sku, usage, unit, usd: rate, effectiveDate: terms[0].effectiveDate };
      }
      return [service, { url, publicationDate: p.publicationDate, version: p.version, rates }];
    }),
  );
  if (results.some((r) => r.status !== "fulfilled"))
    throw Error("Public pricing incomplete; no estimate produced");
  pricing = Object.fromEntries(results.map((r) => r.value));
} else {
  pricing = JSON.parse(
    readFileSync(
      new URL("docs/operations/evidence/learn-recording-backup-estimate-2026-10-11.json", root),
    ),
  ).pricing;
}
const storage = baseline.production.recordingStorage;
if (
  storage.knownSizeObjects !== storage.objects ||
  !Number.isSafeInteger(storage.knownBytes) ||
  storage.knownBytes < 0
)
  throw Error("Complete size metadata required");
const rate = (service, name) => pricing[service].rates[name].usd;
const monthly = {
  s3Storage2GiB: 2 * rate("AmazonS3", "storage"),
  s3PutList10000: 10000 * rate("AmazonS3", "put"),
  s3GetHead100000: 100000 * rate("AmazonS3", "get"),
  lambda10000GiBSeconds: 10000 * rate("AWSLambda", "compute"),
  lambda100Invocations: 100 * rate("AWSLambda", "invocation"),
  oneSecret: rate("AWSSecretsManager", "secret"),
  secretReads100: 100 * rate("AWSSecretsManager", "secretRead"),
  supabaseUncachedEgress2GBIfOverQuota: 2 * 0.09,
  schedulingMonitoringRestoreAllowanceNotQuotedTariff: 1,
};
console.log(
  JSON.stringify(
    {
      contract: "learn-recording-backup-estimate/1",
      calculatedAt: new Date().toISOString(),
      region: "eu-west-2",
      currency: "USD",
      pricing,
      sourceObservation: baseline.production.observedAt,
      measured: {
        objects: storage.objects,
        bytes: storage.knownBytes,
        gib: storage.knownBytes / 2 ** 30,
      },
      initial: {
        storagePerMonth: (storage.knownBytes / 2 ** 30) * rate("AmazonS3", "storage"),
        putOnePerObject: storage.objects * rate("AmazonS3", "put"),
        verifyGetOnePerObject: storage.objects * rate("AmazonS3", "get"),
      },
      planningMonth: {
        items: monthly,
        total: Object.values(monthly).reduce((a, b) => a + b, 0),
        proposedBudgetAlert: 5,
      },
      assumptions: [
        "Planning volumes, not measured runner usage or a guaranteed invoice; 2 GiB allows current objects plus versions/metadata.",
        "No free-tier credit or remaining egress allowance assumed. USD before tax; currency conversion excluded.",
        "The $1 operations allowance is a contingency, not a verified vendor tariff or hard cap.",
        "Excludes existing Supabase subscription, engineering/support, new database restore hosting and optional KMS/customer-managed encryption.",
        "No resources created, source content read or customer data transferred. Budget alert does not cap charges.",
      ],
      egressSource: "https://supabase.com/docs/guides/platform/manage-your-usage/egress",
    },
    null,
    2,
  ),
);
