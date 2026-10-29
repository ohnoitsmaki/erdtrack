import { describe, expect, test } from "vitest";
import { fontFaceRules } from "./googleFonts";

const GSTATIC = "https://fonts.gstatic.com/s/cinzel/v23";

describe("reading Google's CSS for a font", () => {
  test("each face keeps its file on Google's font host, weight and range", () => {
    const css = `
/* latin */
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 400;
  src: url(${GSTATIC}/a.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
@font-face {
  font-family: 'Cinzel';
  font-style: italic;
  font-weight: 700;
  src: url(${GSTATIC}/b.woff2) format('woff2');
}`;

    expect(fontFaceRules(css)).toEqual({
      family: "Cinzel",
      faces: [
        {
          url: `${GSTATIC}/a.woff2`,
          weight: 400,
          italic: false,
          unicodeRange: "U+0000-00FF, U+0131",
        },
        { url: `${GSTATIC}/b.woff2`, weight: 700, italic: true },
      ],
    });
  });

  test("a file anywhere but Google's font host leaves nothing to use", () => {
    const css = `@font-face {
  font-family: 'Cinzel';
  font-weight: 400;
  src: url(https://evil.example/a.woff2) format('woff2');
}`;

    expect(fontFaceRules(css)).toBeNull();
  });
});
