"use client";

import { Badge } from "@/components/ui/badge";
import type { InfoFiRail } from "@/lib/infofi-types";

export function RailBadge({ rail }: { rail: InfoFiRail }) {
  return <Badge variant={rail === "FAST" ? "warning" : "secondary"}>{rail === "FAST" ? "FAST" : "BASE"}</Badge>;
}
