import * as React from "react"

// Whether an action it ran is still running.
export function usePending() {
  const [pending, setPending] = React.useState(false)
  const track = React.useCallback(async (action: () => Promise<unknown>) => {
    setPending(true)
    try {
      await action()
    } finally {
      setPending(false)
    }
  }, [])
  return [pending, track] as const
}
