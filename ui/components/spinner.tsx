import * as React from "react"
import { IconLoader2 } from "@tabler/icons-react"
import { cn } from "@ui/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <IconLoader2
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

// While pending, the content keeps its place but is hidden, and a spinner
// sits over its middle, so the control doesn't change size. The control
// needs to be `relative`.
function PendingContent({
  pending,
  children,
}: {
  pending: boolean
  children: React.ReactNode
}) {
  if (!pending) {
    return children
  }
  return (
    <>
      <span className="invisible contents">{children}</span>
      <Spinner className="absolute inset-0 m-auto" />
    </>
  )
}

// For a wait with nothing yet to shape a skeleton on, like sign-in: a grid
// of cells lit in a wave.
function PixelLoader({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("pixel-loader text-foreground", className)}
      {...props}
    >
      {Array.from({ length: 9 }, (_, cell) => (
        <span key={cell} />
      ))}
    </span>
  )
}

export { PendingContent, PixelLoader, Spinner }
