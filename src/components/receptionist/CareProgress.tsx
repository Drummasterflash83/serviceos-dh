import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
export function CareProgress({ tenantId, feedbackId }: { tenantId: string; feedbackId: string }) {
  const { user } = useAuth();
  const progress = useQuery({
    queryKey: ["care-customer-progress", user?.id, tenantId],
    queryFn: async () => {
      const r = await getSupabaseClient().rpc("care_customer_progress", { p_tenant: tenantId });
      if (r.error) throw Error("Progress is temporarily unavailable.");
      return r.data as {
        feedback_id: string;
        stage: string;
        message: string;
        updated_at: string;
      }[];
    },
    refetchInterval: 30000,
  });
  const item = progress.data?.find((i) => i.feedback_id === feedbackId);
  if (progress.isError)
    return (
      <p className="rw-footnote">Your report is saved. Progress is temporarily unavailable.</p>
    );
  if (!item) return null;
  return (
    <div className="rw-response">
      <strong>
        {item.stage === "resolved" ? "Checked by OpenFolk" : "OpenFolk is here to help"}
      </strong>
      <p>{item.message}</p>
    </div>
  );
}
