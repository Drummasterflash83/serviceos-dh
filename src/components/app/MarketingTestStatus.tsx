/**
 * Inline test-send tracker — the honest post-click journey.
 *
 * After "Send test to myself" the user must never have to hunt for the result:
 * this widget shows the authoritative status of THAT delivery right where the
 * button was pressed, polls while the engine can still move it, explains a
 * workspace-mode pause in customer language, and offers one obvious
 * "View test activity" action that deep-links to the full history.
 *
 * It reads only the authoritative marketing-senders test_status projection —
 * no invented state, no optimistic "sent" claims.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { cancelTestSend, getTestSendStatus, type TestDelivery } from "@/lib/marketing/senders";
import {
  canCancelTest,
  customerTestStatus,
  type CustomerTestStatus,
} from "@/lib/marketing/test-status";

const POLL_MS = 5000;
const POLL_LIMIT_MS = 3 * 60 * 1000;

const TONE_CLS: Record<CustomerTestStatus["tone"], string> = {
  ok: "bg-success/10 text-success",
  warn: "bg-warning/10 text-foreground",
  err: "bg-destructive/10 text-destructive",
  muted: "bg-surface-alt text-muted-foreground",
};

export function TestSendTracker({
  deliveryId,
  modePermitsSend,
}: {
  deliveryId: string;
  modePermitsSend: boolean;
}) {
  const [delivery, setDelivery] = useState<TestDelivery | null>(null);
  const [looked, setLooked] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const r = await getTestSendStatus(20);
      if (stop) return;
      setLooked(true);
      const found = r.ok ? (r.data.deliveries.find((d) => d.id === deliveryId) ?? null) : null;
      if (found) setDelivery(found);
      const st = found
        ? customerTestStatus({
            status: found.status,
            intent_status: found.intent_status,
            failure_class: found.failure_class,
            modePermitsSend,
          })
        : null;
      // keep polling while the engine can still move it (paused-by-mode settles
      // immediately; a mode change is an operator act, not something to spin on)
      const keepPolling =
        !stop &&
        Date.now() - startedAt.current < POLL_LIMIT_MS &&
        (!st || (!st.terminal && st.key !== "paused_by_mode"));
      if (keepPolling) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [deliveryId, modePermitsSend]);

  const st = delivery
    ? customerTestStatus({
        status: delivery.status,
        intent_status: delivery.intent_status,
        failure_class: delivery.failure_class,
        modePermitsSend,
      })
    : null;

  return (
    <div className="rounded-lg border border-hairline bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {st ? (
          <span
            className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLS[st.tone])}
          >
            {st.label}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {looked ? "Waiting for the test to be recorded…" : "Checking test status…"}
          </span>
        )}
        {delivery && (
          <span className="text-muted-foreground">
            → {delivery.recipient_email}
            {delivery.provider_message_id && <> · provider id {delivery.provider_message_id}</>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {st && !st.terminal && delivery && canCancelTest(delivery) && (
            <button
              type="button"
              disabled={cancelBusy}
              onClick={async () => {
                if (!delivery) return;
                setCancelBusy(true);
                const r = await cancelTestSend(delivery.id);
                setCancelBusy(false);
                if (r.ok) {
                  // reflect the AUTHORITATIVE final state the atomic RPC returned
                  setCancelMsg(null);
                  setDelivery({
                    ...delivery,
                    status: (r.data.delivery_status as TestDelivery["status"]) ?? "failed",
                    failure_class: r.data.failure_class ?? "cancelled",
                    intent_status: "cancelled",
                  });
                } else {
                  setCancelMsg(r.error.message);
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 font-medium hover:bg-surface-alt disabled:opacity-50"
            >
              Cancel test
            </button>
          )}
          <Link
            to="/marketing"
            search={{ section: "campaigns", settings: true, focus: "test-activity" }}
            className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 font-medium hover:bg-surface-alt"
          >
            <Activity className="h-3 w-3" /> View test activity
          </Link>
        </span>
      </div>
      {st && <p className="mt-1.5 text-[11px] text-muted-foreground">{st.hint}</p>}
      {cancelMsg && <p className="mt-1 text-[11px] text-destructive">{cancelMsg}</p>}
    </div>
  );
}
