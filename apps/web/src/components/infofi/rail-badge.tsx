"use client";

import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import type { InfoFiRail } from "@/lib/infofi-types";
import { cn } from "@/lib/utils";

const FAST_LOGO_META = {
  src: "https://fast.xyz/fast.svg",
  width: 414,
  height: 146,
  className: "h-3 w-auto [filter:brightness(0)] dark:[filter:brightness(0)_invert(1)]",
} as const;

function BaseLogo({
  className,
  alt,
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="249"
      height="249"
      viewBox="0 0 249 249"
      fill="none"
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn("size-3 rounded-[3px]", className)}
    >
      <path
        d="M0 19.671C0 12.9332 0 9.56425 1.26956 6.97276C2.48511 4.49151 4.49151 2.48511 6.97276 1.26956C9.56425 0 12.9332 0 19.671 0H229.329C236.067 0 239.436 0 242.027 1.26956C244.508 2.48511 246.515 4.49151 247.73 6.97276C249 9.56425 249 12.9332 249 19.671V229.329C249 236.067 249 239.436 247.73 242.027C246.515 244.508 244.508 246.515 242.027 247.73C239.436 249 236.067 249 229.329 249H19.671C12.9332 249 9.56425 249 6.97276 247.73C4.49151 246.515 2.48511 244.508 1.26956 242.027C0 239.436 0 236.067 0 229.329V19.671Z"
        fill="#0000FF"
      />
    </svg>
  );
}

export function RailLogo({
  rail,
  className,
  alt,
}: {
  rail: InfoFiRail;
  className?: string;
  alt?: string;
}) {
  if (rail === "BASE") return <BaseLogo className={className} alt={alt} />;
  return (
    <Image
      src={FAST_LOGO_META.src}
      alt={alt ?? rail}
      width={FAST_LOGO_META.width}
      height={FAST_LOGO_META.height}
      unoptimized
      className={cn(FAST_LOGO_META.className, className)}
    />
  );
}

export function RailBadge({ rail, logoOnly = false }: { rail: InfoFiRail; logoOnly?: boolean }) {
  if (logoOnly) return <RailLogo rail={rail} alt="" />;
  return <Badge variant={rail === "FAST" ? "warning" : "secondary"}>{rail}</Badge>;
}
