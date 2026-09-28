import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve the earlier Costs bookmark while APIs becomes the canonical location.
export const Route = createFileRoute("/openfolk/costs")({
  beforeLoad: () => {
    throw redirect({ to: "/openfolk/apis", replace: true });
  },
});
