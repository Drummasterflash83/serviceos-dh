// Source-only bridge to the service-role emma_603_prepare RPC. It deliberately
// has no scheduler, email/Slack transport or configuration writer. The ports
// must read trusted internal records; an external request may supply only a
// source ID. The database rechecks the published 603 source and proof atomically.
import {
  receivePublishedEmergency603,
  type Receiver603Ports,
  type Prepared603,
} from "./receptionist-emergency-603-receiver.ts";
import type { Emergency603CoreEvidence } from "./receptionist-emergency-fallback-proof.ts";

export type Stored603Row = {
  deliveryId: string;
  target: "rob_email" | "tony_email" | "urgent_slack";
  destination: string;
  state: "prepared" | "reserved" | "submitted" | "posted" | "uncertain";
};
export type Durable603Ports = Receiver603Ports & {
  // Must call only the service-role emma_603_prepare RPC. It must not insert
  // directly into the table, activate a config row or send a notification.
  prepareAtomically: (input: {
    tenantId: string;
    sourceId: string;
    core: Emergency603CoreEvidence;
    channelId: string;
  }) => Promise<readonly Stored603Row[]>;
};

function rowsMatch(prepared: Prepared603, rows: readonly Stored603Row[]) {
  const expected = [
    { deliveryId: prepared.emails[0].deliveryId, target: "rob_email", destination: prepared.emails[0].recipient },
    { deliveryId: prepared.emails[1].deliveryId, target: "tony_email", destination: prepared.emails[1].recipient },
    { deliveryId: prepared.slack.deliveryId, target: "urgent_slack", destination: prepared.slack.channelId },
  ];
  return rows.length === 3 && expected.every(e => rows.filter(r =>
    r.deliveryId === e.deliveryId && r.target === e.target && r.destination === e.destination).length === 1);
}

export async function reserveEmergency603Notifications(sourceId: string, ports: Durable603Ports) {
  const prepared = await receivePublishedEmergency603(sourceId, ports);
  if (prepared.state === "held") return prepared;
  let rows: readonly Stored603Row[];
  try {
    rows = await ports.prepareAtomically({
      tenantId: prepared.emails[0].tenantId,
      sourceId: prepared.sourceId,
      core: prepared.core,
      channelId: prepared.slack.channelId,
    });
  } catch {
    // Includes Off, route/source version conflict and database unavailability.
    // An atomic RPC rolls back on mismatch; no external notification is sent.
    return { state: "held" as const, code: "durable_preparation_unavailable" };
  }
  if (!rowsMatch(prepared, rows)) return { state: "held" as const, code: "durable_preparation_mismatch" };
  return { state: "durable" as const, sourceId, rows };
}
