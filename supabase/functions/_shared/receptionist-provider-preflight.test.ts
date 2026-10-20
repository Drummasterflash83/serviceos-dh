import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectBirchillsLaunchBindings, summarizeVapiTestNumber } from "./receptionist-provider-preflight.ts";

const prefix = "https://pbx.sipcentric.com/api/v1/customers/3950";
const endpoint = (id: number) => `${prefix}/endpoints/${id}`;
const interval = (id: number) => `${prefix}/timeintervals/${id}`;
function fixtures(options: { duplicate603?: boolean; wrongDid?: boolean; mailboxEmail?: string } = {}) {
  const roster = [
    [501, 501, "ivr"], [502, 502, "ivr"], [205, 205, "virtual"],
    [109, 109, "virtual"], [105, 105, "virtual"], [603, 180997, "mailbox"],
  ] as const;
  const rows = roster.map(([short, id, type]) => ({ shortNumber: String(short), uri: endpoint(id), type }));
  if (options.duplicate603) rows.push({ shortNumber: "603", uri: endpoint(180998), type: "mailbox" });
  const map = new Map<string, unknown>([
    ["/phonenumbers/50371", {
      number: options.wrongDid ? "01794 000000" : "01794 341600",
      destination: endpoint(501),
      routingRules: [{ timeInterval: interval(800), destination: endpoint(502) }],
    }],
    ["/endpoints?pageSize=100&page=1", { totalItems: rows.length, items: rows }],
    ["/timeintervals/800", { name: "Out of hours", repeat: "WEEKLY",
      includedTimes: [{ dayOfWeek: "MON", startTime: "17:00", endTime: "23:59" }] }],
    ["/endpoints/501", { type: "ivr", shortNumber: "501" }],
    ["/endpoints/502", { type: "ivr", shortNumber: "502" }],
    ["/endpoints/205", { type: "virtual", shortNumber: "205", destination: "07426 924154", timeout: 60 }],
    ["/endpoints/109", { type: "virtual", shortNumber: "109", destination: "01794 378105" }],
    ["/endpoints/105", { type: "virtual", shortNumber: "105", destination: "01794 378097" }],
    ["/endpoints/180997", { type: "mailbox", shortNumber: "603", email: options.mailboxEmail ?? "rob@drummondheating.co.uk" }],
  ]);
  const calls: string[] = [];
  return {
    calls,
    read: async (path: string) => {
      calls.push(path);
      if (!map.has(path)) throw Error("Unexpected provider path");
      return map.get(path);
    },
  };
}

test("fixed Birchills preflight reports current DID, office/out-of-hours route, team targets and one 603 recipient", async () => {
  const provider = fixtures();
  const result = await inspectBirchillsLaunchBindings(provider.read);
  assert.equal(result.state, "checked");
  assert.equal(result.mainNumber?.defaultDestination, "501");
  assert.equal(result.mainNumber?.rules[0].destination, "502");
  assert.equal(result.extensions?.["205"].forwardsToEmmaTestNumber, true);
  assert.equal(result.extensions?.["109"].forwardsToSavedRobNumber, true);
  assert.equal(result.extensions?.["105"].forwardsToSavedTonyNumber, true);
  assert.equal(result.extensions?.["603"].emailRecipient, "Rob only");
  assert.match(result.sourceHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(provider.calls.every(path => path.startsWith("/phonenumbers/50371") || path.startsWith("/endpoints") || path.startsWith("/timeintervals")), true);
  assert.equal(JSON.stringify(result).includes("rob@drummondheating.co.uk"), false);
});

test("an ambiguous mailbox or wrong DID is held rather than accepted", async () => {
  const duplicate = await inspectBirchillsLaunchBindings(fixtures({ duplicate603: true }).read);
  assert.equal(duplicate.state, "review");
  const wrong = await inspectBirchillsLaunchBindings(fixtures({ wrongDid: true }).read);
  assert.equal(wrong.state, "review");
  assert.equal(wrong.mainNumberMatches, false);
});

test("Vapi test-number binding requires exactly one matching number and an approved assistant", async () => {
  const live = "4eb2bee8-ac25-47c9-b962-409ed250ceb6";
  const one = await summarizeVapiTestNumber([{ number: "+44 7426 924154", assistantId: live,
    fallbackDestination: { number: "+44 1794 378095" }, credentialId: "never-return-this" }]);
  assert.equal(one.state, "checked");
  assert.equal(one.matchesSavedLiveAssistant, true);
  assert.equal(one.fallbackToSavedMaryDdi, true);
  assert.equal(JSON.stringify(one).includes("never-return-this"), false);
  const two = await summarizeVapiTestNumber([
    { number: "+44 7426 924154", assistantId: live },
    { number: "+44 7426 924154", assistantId: live },
  ]);
  assert.equal(two.state, "review");
  const foreign = await summarizeVapiTestNumber([{ number: "+44 7426 924154", assistantId: "foreign" }]);
  assert.equal(foreign.state, "review");
});
