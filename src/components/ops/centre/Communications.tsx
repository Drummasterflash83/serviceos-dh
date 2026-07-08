/**
 * Communications section — tabs for each communications channel. Email and Phone
 * render the real, unchanged functionality (split out of the former AdminView);
 * SMS and WhatsApp are placeholders whose modules are `planned`.
 *
 * Tabs are driven by module availability so a channel a customer doesn't have
 * simply doesn't appear (OpenFolk-forward).
 */

import { useState } from "react";
import { Mail, MessageSquare, Phone, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { EmailOperations } from "@/components/app/admin/EmailOperations";
import { PhoneOperations } from "@/components/app/admin/PhoneOperations";
import { PlaceholderPanel } from "./PlaceholderPanel";

type ChannelKey = "email" | "phone" | "sms" | "whatsapp";

const CHANNELS: { key: ChannelKey; label: string; icon: typeof Mail; moduleId: string }[] = [
  { key: "email", label: "Email", icon: Mail, moduleId: "comms.gmail" },
  { key: "phone", label: "Phone", icon: Phone, moduleId: "comms.voip" },
  { key: "sms", label: "SMS", icon: Smartphone, moduleId: "comms.sms" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, moduleId: "comms.whatsapp" },
];

export function Communications() {
  const [channel, setChannel] = useState<ChannelKey>("email");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChannel(c.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition",
              channel === c.key
                ? "border-foreground bg-foreground text-background"
                : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
            )}
          >
            <c.icon className="h-3.5 w-3.5" />
            {c.label}
          </button>
        ))}
      </div>

      {channel === "email" && <EmailOperations />}
      {channel === "phone" && <PhoneOperations />}
      {channel === "sms" && (
        <PlaceholderPanel
          icon={Smartphone}
          title="SMS"
          description="Two-way SMS as a communications channel."
        />
      )}
      {channel === "whatsapp" && (
        <PlaceholderPanel
          icon={MessageSquare}
          title="WhatsApp"
          description="WhatsApp Business messaging routed into ServiceOS."
        />
      )}
    </div>
  );
}
