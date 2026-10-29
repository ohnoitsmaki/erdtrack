import { cn } from "@ui/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-2xl bg-muted", className)}
      {...props}
    />
  )
}

// A line of text yet to come: exactly one line box of the text it stands
// for, so what replaces it is the same height, with a bar the height of its
// letters. Give it the text's own size and leading, and a width.
function SkeletonText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton-text"
      className={cn("flex h-lh items-center", className)}
      {...props}
    >
      <span className="h-[0.8em] w-full animate-pulse rounded-[0.25em] bg-muted" />
    </span>
  )
}

export { Skeleton, SkeletonText }
