import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@ui/lib/utils"

import { PendingContent } from "@ui/components/spinner"

const toggleVariants = cva(
  "group/toggle tap-target inline-flex items-center justify-center gap-1 rounded-3xl text-sm font-medium whitespace-nowrap transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-pressed:bg-muted dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
      },
      size: {
        default:
          "h-9 min-w-9 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        sm: "h-8 min-w-8 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 min-w-10 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// While pending it shows a spinner and can't be pressed.
function Toggle({
  className,
  variant = "default",
  size = "default",
  pending = false,
  disabled,
  children,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants> & { pending?: boolean }) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={cn(toggleVariants({ variant, size, className }), pending && "relative")}
      {...props}
    >
      <PendingContent pending={pending}>{children}</PendingContent>
    </TogglePrimitive>
  )
}

export { Toggle, toggleVariants }
