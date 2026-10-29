import { ConvexError } from "convex/values";

// The backend explains a refusal in a ConvexError. Anything else is a fault
// the viewer can't act on, so it gets the fallback.
export function refusalMessage(error: unknown, fallback: string) {
  return error instanceof ConvexError ? String(error.data) : fallback;
}
