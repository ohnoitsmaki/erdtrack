import { parseStyle, type FontFace } from "./style";

// Looked up once, when a Mod picks the font in the Panel. The style keeps
// where each face's file is, so the Overlay loads them from Google without
// asking for the list again.
const TIMEOUT_MS = 20_000;

export type GoogleFont = { family: string; faces: FontFace[] };

// Every weight a family might have. Asked for one a family lacks, Google's
// older CSS API (/css) skips it, while its newer one (/css2) refuses the whole
// request, so the older one is used.
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

// The @font-face rules in Google's CSS, as faces of one family. Anything
// parseStyle wouldn't keep is dropped here too.
export function fontFaceRules(css: string): GoogleFont | null {
  let family: string | undefined;
  const faces: unknown[] = [];
  for (const [, body = ""] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const descriptor = (name: string) =>
      new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim();
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/.exec(
      descriptor("src") ?? "",
    )?.[1];
    family ??= descriptor("font-family")?.replace(/^['"]|['"]$/g, "");
    const unicodeRange = descriptor("unicode-range");
    if (url) {
      faces.push({
        url,
        weight: Number(descriptor("font-weight") ?? 400),
        italic: descriptor("font-style") === "italic",
        ...(unicodeRange ? { unicodeRange } : {}),
      });
    }
  }
  const font = parseStyle({ font: { family, source: "google", faces } }).font;
  return family && font.family === family && font.faces.length > 0
    ? { family, faces: font.faces }
    : null;
}

// Every weight of the family, by its name on fonts.google.com. Throws a
// message to show when it can't.
export async function findGoogleFont(name: string): Promise<GoogleFont> {
  const url = new URL("https://fonts.googleapis.com/css");
  url.searchParams.set("family", `${name.trim()}:${WEIGHTS.join(",")}`);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    referrerPolicy: "no-referrer",
  }).catch(() => null);
  if (response?.status === 400) {
    throw new Error(`Google Fonts has no font called “${name.trim()}”.`);
  }
  if (!response?.ok) {
    throw new Error("Couldn't reach Google Fonts. Check your connection.");
  }
  const font = fontFaceRules(await response.text());
  if (!font) {
    throw new Error(`Google Fonts has no files for “${name.trim()}”.`);
  }
  return font;
}
