import { useRef } from "react";
import { cn } from "@ui/lib/utils";

// A count that rolls up into place when it changes, so a Mod sees it move.
// It doesn't roll when first shown.
export function Roll({ value, className }: { value: number; className?: string }) {
  const first = useRef(value);
  return (
    <span className={cn("inline-flex overflow-hidden align-bottom", className)}>
      <span
        key={value}
        className={cn("tabular-nums", value !== first.current && "animate-roll-in")}
      >
        {value.toLocaleString()}
      </span>
    </span>
  );
}
