// Fixed Drummonds launch preflight. GET-only provider reads; no raw provider
// payloads, secrets, caller records or notification addresses leave this module.
import { evidenceHash } from "./receptionist-care.ts";
import { inspectLaunchGraph } from "./receptionist-launch-inspection.ts";
import { launchPromotionIds as ids } from "./receptionist-launch-promotion.ts";

type Read = (path: string) => Promise<unknown>;
type SafeObject = Record<string, unknown>;
const object = (value: unknown): SafeObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as SafeObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const digits = (value: unknown): string => text(value).replace(/\D/g, "");
const ukDigits = (value: unknown): string => {
  const valueDigits = digits(value);
  return valueDigits.startsWith("0") ? `44${valueDigits.slice(1)}` : valueDigits;
};
const expected = {
  did: "441794341600",
  test: "447426924154",
  rob: "441794378105",
  tony: "441794378097",
} as const;
const sameAccountId = (kind: "endpoints" | "timeintervals", uri: unknown): string | null => {
  if (typeof uri !== "string") return null;
  const match = new RegExp(`^https?://pbx\\.sipcentric\\.com/api/v1/customers/3950/${kind}/([1-9][0-9]{0,11})$`).exec(uri);
  return match?.[1] ?? null;
};
const time = (value: unknown) => {
  const v = object(value);
  return {
    dayOfWeek: text(v.dayOfWeek).slice(0, 3) || null,
    month: text(v.month).slice(0, 3) || null,
    dayOfMonth: typeof v.dayOfMonth === "number" && Number.isInteger(v.dayOfMonth) ? v.dayOfMonth : null,
    startTime: /^\d\d:\d\d$/.test(text(v.startTime)) ? v.startTime : null,
    endTime: /^\d\d:\d\d$/.test(text(v.endTime)) ? v.endTime : null,
  };
};

export async function inspectVapiLaunchBindings(db: any, api: Read, settings: unknown,
  workspace: unknown, actor: string) {
  const [graphResult, numberResult] = await Promise.allSettled([
    inspectLaunchGraph(db, api, settings, workspace, actor),
    api("phone-number?limit=1000"),
  ]);
  const graph = graphResult.status === "fulfilled" ? object(graphResult.value) : null;
  const testNumber = numberResult.status === "fulfilled"
    ? await summarizeVapiTestNumber(numberResult.value)
    : { state: "not_checked" };
  const graphState = graph ? "checked" : "not_checked";
  return {
    state: graphState === "checked" && testNumber.state === "checked" ? "checked" : "review",
    graph: graph ? {
      state: graphState,
      hashes: graph.hashes,
      savedSource: graph.savedSource,
      checks: graph.checks,
    } : { state: graphState },
    testNumber,
    providerChanged: false,
    callsPlaced: false,
  };
}

export async function summarizeVapiTestNumber(list: unknown) {
  const phones = array(list);
  const matching = phones.filter(row => ukDigits(object(row).number) === expected.test);
  const phone = matching.length === 1 ? object(matching[0]) : null;
  const target = text(phone?.assistantId);
  const targetKnown = target === ids.live || target === ids.candidate;
  return {
    state: phones.length >= 1000 || matching.length !== 1 || !targetKnown ? "review" : "checked",
    matchingCount: matching.length,
    listAtLimit: phones.length >= 1000,
    assistant: target === ids.live ? "published Emma" : target === ids.candidate ? "isolated candidate" : "other or missing",
    matchesSavedLiveAssistant: target === ids.live,
    matchesSavedCandidateAssistant: target === ids.candidate,
    fallbackToSavedMaryDdi: ukDigits(object(phone?.fallbackDestination).number) === "441794378095",
    configurationHash: phone ? await evidenceHash(phone) : null,
    updatedAt: text(phone?.updatedAt) || null,
    // Never return phone-number object, credentials, provider URLs or fallback number.
  };
}

export async function inspectBirchillsLaunchBindings(read: Read) {
  // The endpoint page is bounded. An incomplete inventory is a review hold,
  // never proof of an absent or unique internal extension.
  const did = object(await read("/phonenumbers/50371"));
  const first = object(await read("/endpoints?pageSize=100&page=1"));
  const total = Number(first.totalItems);
  if (!Number.isInteger(total) || total < 0 || total > 500)
    return { state: "review", reason: "endpoint_inventory_unbounded", mainNumberMatches: ukDigits(did.number) === expected.did };
  const pages = Math.max(1, Math.ceil(total / 100));
  const rows = [...array(first.items)];
  for (let page = 2; page <= pages; page++)
    rows.push(...array(object(await read(`/endpoints?pageSize=100&page=${page}`)).items));
  const targets = ["501", "502", "205", "109", "105", "603"] as const;
  const selected = Object.fromEntries(targets.map(short => [short,
    rows.filter(row => text(object(row).shortNumber) === short)]));
  const unique = targets.every(short => array(selected[short]).length === 1);
  const idsByShort: Record<string, string> = {};
  const shortById: Record<string, string> = {};
  if (unique) for (const short of targets) {
    const id = sameAccountId("endpoints", object(array(selected[short])[0]).uri);
    if (!id) return { state: "review", reason: "endpoint_identity_invalid", mainNumberMatches: ukDigits(did.number) === expected.did };
    idsByShort[short] = id;
    shortById[id] = short;
  }
  if (!unique || rows.length < total)
    return { state: "review", reason: "endpoint_inventory_ambiguous", mainNumberMatches: ukDigits(did.number) === expected.did };
  const endpointDetails = Object.fromEntries(await Promise.all(targets.map(async short =>
    [short, object(await read(`/endpoints/${idsByShort[short]}`))])));
  if (idsByShort["603"] !== "180997")
    return { state: "review", reason: "mailbox_603_identity_changed", mainNumberMatches: ukDigits(did.number) === expected.did };
  const rules = array(did.routingRules);
  if (rules.length > 8)
    return { state: "review", reason: "main_number_rules_unbounded", mainNumberMatches: ukDigits(did.number) === expected.did };
  const intervalIds = [...new Set(rules.map(row => sameAccountId("timeintervals", object(row).timeInterval)).filter(Boolean))] as string[];
  if (intervalIds.length !== rules.length)
    return { state: "review", reason: "main_number_interval_ambiguous", mainNumberMatches: ukDigits(did.number) === expected.did };
  const intervals = Object.fromEntries(await Promise.all(intervalIds.map(async id =>
    [id, object(await read(`/timeintervals/${id}`))])));
  const route = (uri: unknown) => shortById[sameAccountId("endpoints", uri) ?? ""] ?? "other or missing";
  const detail = (short: string) => object(endpointDetails[short]);
  const mailbox = detail("603");
  const email = text(mailbox.email).trim().toLowerCase();
  return {
    state: ukDigits(did.number) === expected.did ? "checked" : "review",
    mainNumberMatches: ukDigits(did.number) === expected.did,
    mainNumber: {
      defaultDestination: route(did.destination),
      rules: rules.map(row => {
        const r = object(row);
        const id = sameAccountId("timeintervals", r.timeInterval) ?? "";
        const interval = object(intervals[id]);
        return {
          destination: route(r.destination),
          interval: text(interval.name).slice(0, 100),
          repeat: text(interval.repeat).slice(0, 20),
          includedTimes: array(interval.includedTimes).slice(0, 40).map(time),
        };
      }),
    },
    extensions: {
      "205": { type: text(detail("205").type), forwardsToEmmaTestNumber: ukDigits(detail("205").destination) === expected.test,
        timeoutSeconds: typeof detail("205").timeout === "number" ? detail("205").timeout : null },
      "109": { type: text(detail("109").type), forwardsToSavedRobNumber: ukDigits(detail("109").destination) === expected.rob },
      "105": { type: text(detail("105").type), forwardsToSavedTonyNumber: ukDigits(detail("105").destination) === expected.tony },
      "501": { type: text(detail("501").type) },
      "502": { type: text(detail("502").type) },
      "603": { type: text(mailbox.type), savedEndpointMatches: idsByShort["603"] === "180997",
        emailRecipient: email === "rob@drummondheating.co.uk" ? "Rob only" :
          email === "tony@drummondheating.co.uk" ? "Tony only" : email ? "other one-address recipient" : "none" },
    },
    sourceHash: await evidenceHash({ did, endpoints: endpointDetails, intervals }),
    providerChanged: false,
    callsPlaced: false,
  };
}
