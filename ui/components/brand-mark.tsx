import { cn } from "@ui/lib/utils"

// Erdtrack's mark: the wordmark alone.
function BrandMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="brand-mark"
      className={cn("text-base font-semibold tracking-tight", className)}
      {...props}
    >
      Erdtrack
    </span>
  )
}

export { BrandMark }
