/**
 * Settings → Phone / VoIP. The connection & onboarding journey for a tenant's telephony
 * provider: gallery → secure connection → verify → discover → calibrate → behaviour →
 * test call → complete, and connected-state management afterwards. All adapter-driven and
 * resumable; secrets are never rendered. See ./telephony/ProviderOnboarding.
 */

import { Phone } from "lucide-react";
import { ProviderOnboarding } from "./telephony/ProviderOnboarding";

export function PhoneVoipSettings() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-accent" />
        <div className="text-display text-xl font-semibold">Phone / VoIP</div>
      </div>
      <ProviderOnboarding />
    </div>
  );
}
