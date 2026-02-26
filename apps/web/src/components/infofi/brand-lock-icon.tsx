import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandLockIcon({ className }: { className?: string }) {
  return (
    <Image
      src="/jumping_walls_icon.svg"
      alt=""
      width={24}
      height={24}
      aria-hidden="true"
      className={cn(
        "size-6 [filter:brightness(0)_saturate(100%)_opacity(0.9)] dark:[filter:invert(1)_brightness(0.95)]",
        className,
      )}
    />
  );
}
