import { StrictMode } from "react";
import { CSPProvider } from "@base-ui/react/csp-provider";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@ui/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The CSP refuses inline styles, so ui/theme.css has the rule Base UI
        would inject. */}
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
