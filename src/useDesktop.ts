import { useSyncExternalStore } from "react";

// Tailwind's `lg`, where the Overview splits into two columns.
const DESKTOP = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches);
}
