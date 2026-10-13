import test from "node:test";
import assert from "node:assert/strict";
import {
  learnRecap,
  recapAssistant,
  readRecapCounts,
  spokenCount,
} from "../../supabase/functions/_shared/learn-recap.ts";
import {
  londonPeriodStart,
  costQueries,
  scopedCostSummary,
} from "../../supabase/functions/_shared/receptionist-costs.ts";
test("recap distinguishes unavailable, zero and saved evidence, never adds costs", () => {
  const text = learnRecap("Drummonds", {
    email: 12345,
    calls: 0,
    recordings: 12,
    slack: null,
    voicemails: 4,
  });
  assert.match(text, /twelve thousand three hundred and forty-five emails/);
  assert.match(text, /zero call records/);
  assert.match(text, /couldn't verify the totals for Slack/);
  assert.match(text, /not a claim/);
  assert.doesNotMatch(text, /\$|£|cost|pricing|revenue generated/i);
  assert.throws(() =>
    learnRecap("Drummonds", {
      email: null,
      calls: null,
      recordings: null,
      slack: null,
      voicemails: null,
    }),
  );
  const candidate = recapAssistant(
    {
      voice: { voiceId: "Emma", speed: 1.05 },
      model: { provider: "openai", model: "existing", toolIds: ["transfer"], messages: [] },
    },
    text,
  );
  assert.equal((candidate as any).voice.speed, 1.05);
  assert.equal("toolIds" in candidate.model, false);
  assert.equal(candidate.firstMessage, text);
  assert.match(candidate.model.messages[0].content, /Do not discuss costs/);
});
test("counts are tenant filtered and voicemail stays on ordinary user RLS", async () => {
  const seen: string[] = [];
  const db = {
    from: (table: string) => ({
      select: (_s: string, opts: any) => ({
        eq: async (k: string, v: string) => {
          assert.equal(k, "tenant_id");
          assert.equal(v, "tenant");
          assert.equal(opts.head, true);
          seen.push(table);
          return table === "slack_messages" ? { error: true } : { count: 8 };
        },
      }),
    }),
  };
  const values = await readRecapCounts(
    db,
    "tenant",
    "production_metadata_views",
    "https://tgbnakbxwcqjeimygroz.supabase.co",
  );
  assert.equal(values.email, 8);
  assert.equal(values.slack, null);
  assert.ok(seen.includes("learn_launch_email_messages"));
  assert.ok(seen.includes("receptionist_voicemails"));
});
test("London date periods cross UTC midnight and daylight saving correctly", () => {
  assert.equal(londonPeriodStart(new Date("2026-10-13T12:00:00Z")), "2026-10-12T23:00:00.000Z");
  assert.equal(londonPeriodStart(new Date("2026-10-26T12:00:00Z")), "2026-10-26T00:00:00.000Z");
  assert.equal(
    londonPeriodStart(new Date("2026-10-26T12:00:00Z"), true),
    "2026-09-30T23:00:00.000Z",
  );
  assert.equal(
    londonPeriodStart(new Date("2026-07-01T00:15:00+01:00")),
    "2026-06-30T23:00:00.000Z",
  );
});
test("cost result exposes only the selected assistant and preserves pending costs", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const raw = ["today", "month"].map((name) => ({
    name,
    result: [
      { assistantId: "other", usd: 900, calls: 100, costedCalls: 100, minutes: 500 },
      { assistantId: "Emma", usd: 1.23, calls: 3, costedCalls: 2, minutes: 4 },
    ],
  }));
  const s = scopedCostSummary(raw, "Emma", now);
  assert.equal((s.periods.today as any).usd, 1.23);
  assert.equal((s.periods.today as any).pending, 1);
  assert.doesNotMatch(JSON.stringify(s), /900|other/);
  const stringValues = raw.map(q => ({...q, result: [{assistantId: "Emma", usd: "1.23", calls: "3", costedCalls: "2", minutes: "4"}]}));
  assert.deepEqual(scopedCostSummary(stringValues, "Emma", now), s);
  for (const invalid of ["", "NaN", "Infinity", "-1", "1e3", " 2 "]) {
    assert.throws(() => scopedCostSummary(raw.map(q => ({...q,
      result: [{assistantId: "Emma", usd: invalid, calls: 3, costedCalls: 2, minutes: 4}]})), "Emma", now));
  }
  assert.throws(() => scopedCostSummary([], "Emma", now));
  assert.deepEqual(costQueries(now).queries[0].groupBy, ["assistantId"]);
  assert.throws(() =>
    scopedCostSummary(
      raw.map((q) => ({
        ...q,
        result: [{ assistantId: "Emma", usd: -1, calls: 2, costedCalls: 2 }],
      })),
      "Emma",
      now,
    ),
  );
});

test("spoken totals use British whole-number phrasing, including scale boundaries", () => {
  for (const [value, words] of [
    [0, "zero"], [19, "nineteen"], [40, "forty"], [101, "one hundred and one"],
    [1000, "one thousand"], [1001, "one thousand and one"],
    [4454, "four thousand four hundred and fifty-four"],
    [21046, "twenty-one thousand and forty-six"],
    [1000000, "one million"], [1000100, "one million one hundred"],
  ] as const) assert.equal(spokenCount(value), words);
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => spokenCount(value));
  assert.doesNotMatch(learnRecap("Drummonds", {
    email: 21146, calls: 4454, recordings: 2955, slack: 5260, voicemails: 255,
  }), /\d/);
});
