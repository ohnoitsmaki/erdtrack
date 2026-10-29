import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDemo } from "./Demo";
import { useFontFaces } from "./fonts";
import { Overlay, OverlayList } from "./Overlay";
import { parseStyle, type OverlayStyle } from "./style";
import type { Overlay as OverlayData } from "../../convex/overlay";
import "./overlay.css";
import "./page.css";

// The page OBS shows, at /overlay or, for the List view, /overlay/list, and
// that StreamElements can show in a frame. It signs no one in: the counts and
// the style are public. Convex pushes each change, so OBS follows the Panel
// as it happens. While the connection is down, the last counts stay on
// screen, with no error on stream. At /overlay/demo it shows the demo's
// made-up counts instead, as the Framed banner in the Streamer's style.
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

const LIST_VIEW = /^\/overlay\/list\/?$/.test(location.pathname);
const DEMO = /^\/overlay\/demo\/?$/.test(location.pathname);

function OverlayPage() {
  const live = useQuery(api.overlay.current, DEMO ? "skip" : {});
  const demo = useDemo(DEMO);
  const overlay = DEMO ? demo : live;
  const saved = useQuery(api.overlayStyle.current);
  const style = useMemo(() => {
    if (saved === undefined) {
      return undefined;
    }
    const parsed = parseStyle(saved);
    return DEMO ? { ...parsed, layout: "framed" as const } : parsed;
  }, [saved]);
  // Nothing shows until the style has loaded, so OBS never flashes the
  // default one.
  return (
    style && overlay !== undefined && <Styled overlay={overlay} style={style} />
  );
}

function Styled({
  overlay,
  style,
}: {
  overlay: OverlayData | null;
  style: OverlayStyle;
}) {
  useFontFaces(style.font);
  return LIST_VIEW ? (
    <OverlayList overlay={overlay} style={style} />
  ) : (
    <Overlay overlay={overlay} style={style} />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <OverlayPage />
    </ConvexProvider>
  </StrictMode>,
);
