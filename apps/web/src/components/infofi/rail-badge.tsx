"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import type { InfoFiRail } from "@/lib/infofi-types";
import { cn } from "@/lib/utils";

const RAIL_LOGO_META: Record<InfoFiRail, { src: string; width: number; height: number; className: string }> = {
  FAST: {
    src: "https://fast.xyz/fast.svg",
    width: 414,
    height: 146,
    className: "h-3 w-auto [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]",
  },
  BASE: {
    src: "https://www.base.org/base-square.svg",
    width: 249,
    height: 249,
    className: "size-3 rounded-[3px]",
  },
};

export function RailLogo({
  rail,
  className,
  alt,
}: {
  rail: InfoFiRail;
  className?: string;
  alt?: string;
}) {
  const meta = RAIL_LOGO_META[rail];
  return (
    <Image
      src={meta.src}
      alt={alt ?? rail}
      width={meta.width}
      height={meta.height}
      unoptimized
      className={cn(meta.className, className)}
    />
  );
}

export function RailBadge({ rail, logoOnly = false }: { rail: InfoFiRail; logoOnly?: boolean }) {
  return (
    <Badge
      variant={rail === "FAST" ? "warning" : "secondary"}
      className={logoOnly ? "gap-0 px-2" : undefined}
    >
      {logoOnly ? (
        <>
          <RailLogo rail={rail} alt="" />
          <span className="sr-only">{rail}</span>
        </>
      ) : (
        rail
      )}
    </Badge>
  );
}
