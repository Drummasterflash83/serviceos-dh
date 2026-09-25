import { useQuery } from "@tanstack/react-query";
import { Headphones, ArrowRight, Layers, Receipt, MessageSquare } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { receptionistHref, type ClientSection } from "@/lib/client-workspace-nav";
import { emmaHealthCards, mainNumberStatus } from "@/lib/emma-health";
import type { ReceptionistCall } from "@/lib/receptionist-data";

export function WorkspaceHome({
  tenant,
  userId,
  company,
  open,
}: {
  tenant: string;
  userId: string;
  company: string;
  open: (section: ClientSection) => void;
}) {
  const receptionist = useQuery({
    queryKey: ["workspace-receptionist-summary", userId, tenant],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("receptionist_workspaces")
        .select("name,launch_stage")
        .eq("tenant_id", tenant)
        .maybeSingle();
      if (error) throw new Error("Receptionist details are temporarily unavailable.");
      return data;
    },
    staleTime: 30_000,
  });
  const callEvidence = useQuery({
    queryKey: ["workspace-emma-calls", userId, tenant],
    enabled: !!userId && !!receptionist.data,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-calls", {
        body: { tenantId: tenant, before: null },
      });
      if (error || data?.error) throw new Error("Emma's latest calls could not be checked.");
      if (!Array.isArray(data?.calls) || typeof data?.connection !== "string")
        throw new Error("Emma's call response needs a check.");
      return data as { connection: string; calls: ReceptionistCall[]; checkedAt: string };
    },
    staleTime: 45_000,
    refetchInterval: 60_000,
  });
  const status = emmaHealthCards(callEvidence.data?.calls ?? [], {
    connected: callEvidence.data?.connection === "connected" && !callEvidence.isError,
    loading: callEvidence.isPending,
    error: callEvidence.isError,
    launchStage: receptionist.data?.launch_stage,
  })[0]!;
  return (
    <div className="cp-work-home">
      <section className="cp-emma-entry" aria-label="AI Receptionist">
        <div className="cp-emma-orb" aria-hidden="true">
          <Headphones size={42} />
        </div>
        <div className="cp-emma-copy">
          <p className="of-eyebrow">YOUR AI RECEPTIONIST</p>
          <h2>{receptionist.data?.name || "Your receptionist"}</h2>
          <p>Every call in view. The next step clear.</p>
          {receptionist.data && (
            <div className={`cp-emma-status cp-emma-status-${status.tone}`}>
              <span>HOW EMMA IS DOING</span>
              <strong>{status.headline}</strong>
              <small>{status.summary}</small>
              {callEvidence.data?.connection === "connected" && (
                <small>
                  Call data connected to OpenFolk · Latest {callEvidence.data.calls.length} calls
                </small>
              )}
            </div>
          )}
          {receptionist.isPending ? (
            <small role="status">Loading receptionist details…</small>
          ) : receptionist.isError ? (
            <div role="alert">
              <small>Details unavailable — not a phone-line health assessment.</small>
              <button onClick={() => void receptionist.refetch()}>Retry details</button>
            </div>
          ) : receptionist.data ? (
            <>
              <span className="cp-recorded-stage">
                {mainNumberStatus(receptionist.data.launch_stage)}
              </span>
            </>
          ) : (
            <small>No receptionist workspace has been assigned yet.</small>
          )}
        </div>
        <a className="cp-open-emma" href={receptionistHref(tenant)}>
          Open AI Receptionist <ArrowRight size={18} />
        </a>
      </section>
      <div className="cp-home-intro">
        <h2>Your workspace, at a glance.</h2>
        <p>The essentials for {company}. Choose what you need.</p>
      </div>
      <div className="cp-home-cards">
        <button className="cp-home-card" onClick={() => open("overview")}>
          <Layers size={24} />
          <h3>Your programme</h3>
          <p>What we’re building, the outcomes and what comes next.</p>
          <span>
            View programme <ArrowRight size={16} />
          </span>
        </button>
        <button className="cp-home-card" onClick={() => open("investment")}>
          <Receipt size={24} />
          <h3>Invoices & delivery</h3>
          <p>See your recorded spend, download invoices and follow delivery.</p>
          <span>
            View invoices <ArrowRight size={16} />
          </span>
        </button>
        <button className="cp-home-card" onClick={() => open("notes")}>
          <MessageSquare size={24} />
          <h3>Talk to OpenFolk</h3>
          <p>Share feedback, ask a question or flag something that needs attention.</p>
          <span>
            Leave feedback <ArrowRight size={16} />
          </span>
        </button>
      </div>
      <p className="cp-home-disclosure">
        Receptionist call evidence lives in its dashboard. A recorded launch stage is not a live
        uptime guarantee.
      </p>
    </div>
  );
}
