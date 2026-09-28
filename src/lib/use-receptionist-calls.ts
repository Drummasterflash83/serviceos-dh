import { useInfiniteQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "./supabase";
import type { ReceptionistCall } from "./receptionist-data";
import {
  receptionistCallKey,
  receptionistCallFreshness,
  receptionistCallPollInterval,
} from "./receptionist-call-cache";

export type ReceptionistCallPage = {
  connection: string;
  calls: ReceptionistCall[];
  nextCursor: string | null;
  checkedAt: string;
};

// Home and receptionist share both in-flight requests and recent evidence. Identity
// remains scoped to the signed-in user AND tenant; reloads start a fresh query client.
export function useReceptionistCalls(
  userId: string | undefined,
  tenant: string | undefined,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: receptionistCallKey(userId, tenant),
    enabled: enabled && !!userId && !!tenant,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-calls", {
        body: { tenantId: tenant, before: pageParam },
      });
      if (
        error ||
        data?.error ||
        !Array.isArray(data?.calls) ||
        typeof data?.connection !== "string"
      )
        throw Error("Call data is unavailable. Your saved feedback is still safe.");
      return data as ReceptionistCallPage;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: receptionistCallFreshness,
    refetchInterval: receptionistCallPollInterval,
  });
}
