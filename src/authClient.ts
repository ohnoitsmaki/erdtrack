import { useState } from "react";
import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { genericOAuthClient } from "better-auth/client/plugins";
import { toast } from "@ui/components/toast";

// No baseURL: auth lives at /api/auth on the Panel's own origin.
export const authClient = createAuthClient({
  plugins: [convexClient(), genericOAuthClient()],
});

// Stays signing out once it has worked, until the viewer changes and the
// screen it was on goes away.
export function useSignOut() {
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    setSigningOut(true);
    const { error } = await authClient.signOut();
    if (error) {
      setSigningOut(false);
      toast.add({ type: "error", title: "Couldn't sign out. Try again." });
    }
  };
  return { signingOut, signOut };
}
