// ServiceOS — focused tests for the staged-HTTP-suite "is it served?" classifier.
//
// This logic decides whether a test run is allowed to CLAIM a result. Getting it
// wrong is worse than a failing test: it makes a suite print a pass it never
// observed, or send someone to fix a server that is already running. It was
// previously implicit inline logic duplicated in two probe scripts, so it could
// not be tested and the two copies could drift.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyProbe, mayReportResults, notRunMessage } from "./lib/edge-probe.mjs";

test("the function's own gate positively proves it is served", () => {
  for (const status of [400, 401, 403]) {
    const c = classifyProbe({ status });
    assert.equal(c.verdict, "served", `HTTP ${status} comes from the function itself`);
    assert.ok(mayReportResults(c.verdict));
  }
});

test("a 5xx is AMBIGUOUS — never reported as merely unserved", () => {
  // Observed: an unserved local gateway answers EVERY function path, real or
  // nonsense, with 500 {"message":"An unexpected error occurred"}. A served
  // function that is throwing produces the same 500. They cannot be told apart.
  for (const status of [500, 502]) {
    const c = classifyProbe({ status });
    assert.equal(c.verdict, "ambiguous", `HTTP ${status} cannot be attributed`);
    assert.ok(!mayReportResults(c.verdict), "an ambiguous probe must never permit a claimed pass");
    assert.match(c.reason, /cannot tell them apart/);
  }
});

test("a served-but-broken function is not misreported as NOT SERVED", () => {
  // The failure mode this guards: a DEPLOYED function crashing on every request
  // returns 500. Reporting that as "unserved — go serve the functions" sends
  // someone to start a server that is already running, and hides a real outage.
  const c = classifyProbe({ status: 500 });
  assert.notEqual(c.verdict, "unserved");
  const msg = notRunMessage("marketing-sequences", c);
  assert.match(msg, /AMBIGUOUS/);
  assert.match(msg, /check whether it is deployed and throwing/);
  assert.doesNotMatch(msg, /^Serve the functions/m);
});

test("the gateway positively denying the route is UNSERVED", () => {
  for (const status of [503, 504]) {
    assert.equal(classifyProbe({ status }).verdict, "unserved");
  }
  assert.match(notRunMessage("marketing-sequences", classifyProbe({ status: 503 })), /Serve the/);
});

test("a transport failure is ambiguous, never a pass", () => {
  const c = classifyProbe({ transportError: true });
  assert.equal(c.verdict, "ambiguous");
  assert.ok(!mayReportResults(c.verdict));
});

test("no verdict other than 'served' may ever permit a claimed result", () => {
  const verdicts = [
    classifyProbe({ status: 500 }),
    classifyProbe({ status: 503 }),
    classifyProbe({ transportError: true }),
    classifyProbe({}),
  ];
  for (const c of verdicts) assert.equal(mayReportResults(c.verdict), false);
  assert.equal(mayReportResults(classifyProbe({ status: 401 }).verdict), true);
});

test("a 2xx/3xx/4xx answer is treated as served", () => {
  // Something spoke for this route, so the suite may proceed and judge the
  // real contract rather than refusing on a technicality.
  for (const status of [200, 204, 404, 429]) {
    assert.equal(classifyProbe({ status }).verdict, "served", `HTTP ${status}`);
  }
});
