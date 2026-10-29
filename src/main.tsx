import { StrictMode } from "react";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { createRoot } from "react-dom/client";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  ConvexBetterAuthProvider,
  type AuthClient,
} from "@convex-dev/better-auth/react";
import { Toaster } from "@ui/components/toast";
import { TooltipProvider } from "@ui/components/tooltip";
import { authClient } from "./authClient";
import { App } from "./App";
import "@ui/theme.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

// Dev only: ?preview runs the Panel against sample data in this tab, with no
// sign-in, until ?preview=off. ?latency=1500 holds back sign-in and each
// query's first result for about that long, to watch the skeletons give way
// and score the layout shift; ?latency=hold keeps them back until the chip
// in the corner is pressed, and ?latency=0 stops it. See
// src/preview/fakeConvex.ts and src/preview/layoutShifts.ts.
const PREVIEW_KEY = "erdtrack.preview";
const LATENCY_KEY = "erdtrack.previewLatency";
async function previewClient() {
  if (!import.meta.env.DEV) {
    return null;
  }
  const params = new URLSearchParams(location.search);
  const asked = params.get("preview");
  if (asked !== null) {
    if (asked === "off") {
      sessionStorage.removeItem(PREVIEW_KEY);
    } else {
      sessionStorage.setItem(PREVIEW_KEY, "on");
    }
  }
  if (params.has("latency")) {
    sessionStorage.setItem(LATENCY_KEY, params.get("latency")!);
  }
  if (!sessionStorage.getItem(PREVIEW_KEY)) {
    return null;
  }
  const [{ FakeConvex }, { watchLayoutShifts }] = await Promise.all([
    import("./preview/fakeConvex"),
    import("./preview/layoutShifts"),
  ]);
  const latency = sessionStorage.getItem(LATENCY_KEY) ?? "0";
  const client = new FakeConvex(latency === "hold" ? "hold" : Number(latency) || 0);
  watchLayoutShifts({ onRelease: latency === "hold" ? () => client.release() : undefined });
  return client as unknown as ConvexReactClient;
}

// The preview's sign-in: there's always someone, and the fake client says
// when they're through.
const previewAuth = {
  isLoading: false,
  isAuthenticated: true,
  fetchAccessToken: async () => "preview",
};
const usePreviewAuth = () => previewAuth;

const preview = await previewClient();

// The component's AuthClient type was built against better-auth 1.6.15 and
// no longer matches 1.6.33's client type, though the runtime shape it uses
// (useSession and convex.token) is unchanged. Drop the cast once they agree.
const typedAuthClient = authClient as unknown as AuthClient;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The CSP refuses inline styles, so ui/theme.css has the rule Base UI
        would inject. */}
    <CSPProvider disableStyleElements>
      {preview ? (
        <ConvexProviderWithAuth client={preview} useAuth={usePreviewAuth}>
          <TooltipProvider>
            <Toaster>
              <App />
            </Toaster>
          </TooltipProvider>
        </ConvexProviderWithAuth>
      ) : (
        <ConvexBetterAuthProvider client={convex} authClient={typedAuthClient}>
          <TooltipProvider>
            <Toaster>
              <App />
            </Toaster>
          </TooltipProvider>
        </ConvexBetterAuthProvider>
      )}
    </CSPProvider>
  </StrictMode>,
);
