import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import overlayCss from "./overlay.css?inline";

// The Preview renders in a shadow root that holds only the Overlay's own
// stylesheet, so Tailwind's preflight and the theme can't change it and it
// matches what OBS shows. The host resets what the Panel's page
// would otherwise pass down by inheritance. Both are constructed
// stylesheets, which the CSP's style-src 'self' allows where an inline
// <style> would be refused. The fonts' @font-face rules stay in the page,
// since a shadow root doesn't load its own. Custom properties still inherit
// past `all: initial`, so the Overlay must keep setting every variable
// overlay.css reads on .overlay-frame (Overlay.tsx), or the theme's
// --background and the rest would show through.
let sheets: CSSStyleSheet[] | undefined;

function previewSheets() {
  if (!sheets) {
    const host = new CSSStyleSheet();
    host.replaceSync(":host { all: initial; display: block; }");
    const overlay = new CSSStyleSheet();
    overlay.replaceSync(overlayCss);
    sheets = [host, overlay];
  }
  return sheets;
}

export function PreviewRoot({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot>();

  useLayoutEffect(() => {
    const element = host.current!;
    // StrictMode runs this twice, and a host takes only one shadow root.
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    shadow.adoptedStyleSheets = previewSheets();
    setRoot(shadow);
  }, []);

  return <div ref={host}>{root && createPortal(children, root)}</div>;
}
