import { useCallback } from "react";
import { toast } from "@ui/components/toast";
import { refusalMessage } from "./refusal";

// Runs a mutation, showing its refusal as a toast. Field validation stays
// inline, beside the field.
export function useAttempt(fallback = "That failed.") {
  return useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        toast.add({ type: "error", title: refusalMessage(error, fallback) });
      }
    },
    [fallback],
  );
}

export type Attempt = ReturnType<typeof useAttempt>;
