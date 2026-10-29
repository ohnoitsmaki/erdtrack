import { useEffect } from "react";
// The bundled open-licence fonts. Vite bundles their files with the page, so
// they load from the Panel's own origin like the rest of it.
import "@fontsource-variable/cinzel";
import "@fontsource-variable/inter";
import "@fontsource/bebas-neue";
import type { OverlayStyle } from "./style";

// By the family name their CSS gives them.
export const BUNDLED_FONTS = ["Cinzel Variable", "Inter Variable", "Bebas Neue"];

// The CSS keywords for the system's own fonts, which mustn't be quoted.
const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace"]);

export function fontFamily(family: string) {
  const named = GENERIC.has(family) ? family : `"${family}"`;
  return `${named}, system-ui, sans-serif`;
}

// Loads a Google Font's faces straight from Google, and unloads them when the
// font changes. Installed and bundled fonts need nothing loaded: OBS's browser
// finds an installed font by name on the Streamer's PC.
export function useFontFaces(font: OverlayStyle["font"]) {
  const key = JSON.stringify(font.source === "google" ? font : null);
  useEffect(() => {
    if (font.source !== "google") {
      return;
    }
    const loaded: globalThis.FontFace[] = [];
    for (const face of font.faces) {
      // parseStyle only lets through URLs on fonts.gstatic.com with nothing
      // that could end the url().
      const fontFace = new globalThis.FontFace(font.family, `url(${face.url})`, {
        weight: String(face.weight),
        style: face.italic ? "italic" : "normal",
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
      });
      loaded.push(fontFace);
      document.fonts.add(fontFace);
      // A missing file leaves the fallback font in place.
      void fontFace.load().catch(() => undefined);
    }
    return () => {
      for (const fontFace of loaded) {
        document.fonts.delete(fontFace);
      }
    };
    // The key stands for the font, so a new but equal object doesn't reload.
  }, [key]);
}
