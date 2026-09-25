import { LayoutDashboard, Mic, Sparkles, Users, Phone, SlidersHorizontal } from "lucide-react";

export const receptionistNavigation = [
  { id: "today", label: "Overview", Icon: LayoutDashboard },
  { id: "practice", label: "Practise and improve", Icon: Mic },
  { id: "improvements", label: "Make Emma better", Icon: Sparkles },
  { id: "callers", label: "People who called", Icon: Users },
  { id: "phones", label: "Phone system", Icon: Phone },
  { id: "details", label: "About your receptionist", Icon: SlidersHorizontal },
] as const;
