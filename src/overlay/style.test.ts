import { describe, expect, test } from "vitest";
import {
  asPanel,
  DEFAULT_STYLE,
  isPopout,
  listViewEncounters,
  parseStyle,
  pieceTag,
  statLabel,
  tagLabel,
  type OverlayStyle,
  type PlacedPiece,
} from "./style";

// The pieces added after Tags, which a style saved before them shows at the
// end.
const LATER: PlacedPiece[] = [
  { piece: "sinceDeath", show: true },
  { piece: "stream", show: true },
  { piece: "felled", show: true },
  { piece: "overworld", show: true },
  { piece: "playTime", show: true },
];

// A style the Streamer might have saved, with every control moved off its
// default.
const styled: OverlayStyle = {
  pieces: [
    { piece: "total", show: true },
    { piece: "encounter", show: true },
    { piece: "gravity", show: false },
    { piece: "tag", tagId: "k57birds", show: true },
    { piece: "stream", show: false },
    { piece: "overworld", show: true, popout: false },
    { piece: "felled", show: false, popout: true },
    { piece: "sinceDeath", show: false },
    { piece: "playTime", show: false, popout: true },
  ],
  layout: "banner",
  emblem: false,
  overworld: false,
  font: {
    family: "Cinzel",
    source: "google",
    faces: [
      { url: "https://fonts.gstatic.com/s/cinzel/v23/a.ttf", weight: 400, italic: false },
      {
        url: "https://fonts.gstatic.com/s/cinzel/v23/b.woff2",
        weight: 700,
        italic: false,
        unicodeRange: "U+0000-00FF, U+0131",
      },
    ],
    size: 48,
    weight: 700,
  },
  outline: { width: 2, color: "#000000" },
  shadow: { blur: 8, color: "#202020" },
  colors: {
    text: "#ffffff",
    accent: "#e8b04a",
    background: "#101018",
    backgroundOpacity: 0.5,
  },
  scale: 1.5,
  align: "right",
  offset: { x: -40, y: 120 },
  padding: 24,
  width: 480,
  height: 160,
  labels: { total: "Deaths", defeated: "Felled" },
  tagFeed: false,
  tagSeconds: 90,
  popouts: {
    timing: "every",
    bosses: "toughest",
    count: 3,
    seconds: 8,
    minutes: 10,
  },
  youDied: false,
};

describe("reading a saved style", () => {
  test("with nothing saved, the Overlay looks as it does by default", () => {
    expect(parseStyle(undefined)).toEqual(DEFAULT_STYLE);
    expect(parseStyle("not a style")).toEqual(DEFAULT_STYLE);
  });

  test("a saved style comes back exactly as it was saved", () => {
    expect(parseStyle(JSON.parse(JSON.stringify(styled)))).toEqual(styled);
  });

  test("anything missing takes its default, and the rest is kept", () => {
    expect(
      parseStyle({ font: { family: "Georgia" }, colors: { text: "#ff0000" } }),
    ).toEqual({
      ...DEFAULT_STYLE,
      font: { ...DEFAULT_STYLE.font, family: "Georgia" },
      colors: { ...DEFAULT_STYLE.colors, text: "#ff0000" },
    });
  });

  test("every piece is arranged exactly once, and a missing one shows at the end", () => {
    expect(
      parseStyle({
        pieces: [
          { piece: "gravity", show: false },
          { piece: "banner", show: true },
          { piece: "gravity", show: true },
          { piece: "encounter", show: true },
        ],
      }).pieces,
    ).toEqual([
      { piece: "gravity", show: false },
      { piece: "encounter", show: true },
      { piece: "total", show: true },
      ...LATER,
    ]);
  });

  test("the App's styles keep their Play Time where it was, and only the deadliest boss is dropped", () => {
    expect(
      parseStyle({
        pieces: [
          { piece: "playTime", show: false },
          { piece: "deadliest", show: true },
          { piece: "total", show: true },
        ],
      }).pieces,
    ).toEqual([
      { piece: "playTime", show: false },
      { piece: "total", show: true },
      { piece: "encounter", show: true },
      { piece: "gravity", show: true },
      ...LATER.filter(({ piece }) => piece !== "playTime"),
    ]);
  });

  test("a new style shows the Play Time", () => {
    expect(DEFAULT_STYLE.pieces).toContainEqual({ piece: "playTime", show: true });
  });

  test("a number outside what its control allows is brought into range", () => {
    const style = parseStyle({
      font: { size: 5000, weight: 1234 },
      outline: { width: -3 },
      shadow: { blur: 999 },
      colors: { backgroundOpacity: 7 },
      scale: 0,
      offset: { x: -5000, y: 5000 },
      padding: -10,
      width: 9000,
      height: -20,
      tagSeconds: 1,
      popouts: { count: 99, seconds: 0, minutes: 600 },
    });

    expect(style.font.size).toBe(200);
    expect(style.font.weight).toBe(900);
    expect(style.outline.width).toBe(0);
    expect(style.shadow.blur).toBe(30);
    expect(style.colors.backgroundOpacity).toBe(1);
    expect(style.scale).toBe(0.25);
    expect(style.offset).toEqual({ x: -1000, y: 1000 });
    expect(style.padding).toBe(0);
    expect(style.width).toBe(2000);
    expect(style.height).toBe(0);
    expect(style.tagSeconds).toBe(5);
    expect(style.popouts).toMatchObject({ count: 20, seconds: 2, minutes: 60 });
  });

  test("a font weight goes to the nearest hundred", () => {
    expect(parseStyle({ font: { weight: 449 } }).font.weight).toBe(400);
    expect(parseStyle({ font: { weight: 650 } }).font.weight).toBe(700);
  });

  test("a colour must be a plain hex colour, so nothing else can be slipped into the CSS", () => {
    const style = parseStyle({
      outline: { color: "#ABCDEF" },
      colors: {
        text: "red; background: url(https://example.com/x.png)",
        accent: "#fff",
        background: "#12345678",
      },
    });

    expect(style.outline.color).toBe("#abcdef");
    expect(style.colors.text).toBe(DEFAULT_STYLE.colors.text);
    expect(style.colors.accent).toBe(DEFAULT_STYLE.colors.accent);
    expect(style.colors.background).toBe(DEFAULT_STYLE.colors.background);
  });

  test("a font name can't close its quotes or carry CSS", () => {
    expect(parseStyle({ font: { family: "  Noto Sans JP " } }).font.family).toBe(
      "Noto Sans JP",
    );
    for (const family of [
      'Arial", url(https://example.com/x.woff)',
      "Arial; color: red",
      "Arial\\22",
      "Ari\nal",
      "",
      "x".repeat(101),
    ]) {
      expect(parseStyle({ font: { family } }).font.family).toBe(
        DEFAULT_STYLE.font.family,
      );
    }
  });

  test("a Google Font's faces can only name files on Google's font host", () => {
    const style = parseStyle({
      font: {
        family: "Cinzel",
        source: "google",
        faces: [
          { url: "https://evil.example/cinzel.ttf", weight: 400 },
          { url: "http://fonts.gstatic.com/s/cinzel.ttf", weight: 400 },
          { url: "https://fonts.gstatic.com.evil.example/a.ttf", weight: 400 },
          { url: "https://fonts.gstatic.com/s/cinzel/v23/a.ttf) , url(https://evil.example/x", weight: 400 },
          { file: "cinzel-400-0.ttf", weight: 400 },
          { url: "https://fonts.gstatic.com/s/cinzel/v23/a.ttf", weight: 400, unicodeRange: "U+0000-00FF" },
          {
            url: "https://fonts.gstatic.com/s/cinzel/v23/b.ttf",
            weight: 700,
            unicodeRange: "U+0000; } body { color: red",
          },
        ],
      },
    });

    expect(style.font.faces).toEqual([
      {
        url: "https://fonts.gstatic.com/s/cinzel/v23/a.ttf",
        weight: 400,
        italic: false,
        unicodeRange: "U+0000-00FF",
      },
      { url: "https://fonts.gstatic.com/s/cinzel/v23/b.ttf", weight: 700, italic: false },
    ]);
  });
});

describe("picking a panel layout", () => {
  test("it takes the look it was designed with, and keeps what shows", () => {
    const card = asPanel(styled);

    expect(card.layout).toBe("card");
    expect(card.font.family).toBe("Cinzel Variable");
    expect(card.colors.backgroundOpacity).toBeGreaterThan(0);
    expect(card.outline.width).toBe(0);
    expect(card.pieces).toEqual(styled.pieces);
    expect(parseStyle(JSON.parse(JSON.stringify(card)))).toEqual(card);
  });

  test("the Banner and Framed take the same look", () => {
    for (const layout of ["banner", "framed"] as const) {
      const panel = asPanel(styled, layout);

      expect(panel.layout).toBe(layout);
      expect(panel.font.family).toBe("Cinzel Variable");
      expect(panel.colors).toEqual(asPanel(styled).colors);
    }
  });
});

describe("the Banner's emblem", () => {
  test("shows unless it was switched off", () => {
    expect(DEFAULT_STYLE.emblem).toBe(true);
    expect(parseStyle({}).emblem).toBe(true);
    expect(parseStyle({ emblem: false }).emblem).toBe(false);
    expect(parseStyle({ emblem: "no" }).emblem).toBe(true);
  });
});

describe("the Tags' tallies in the Banner and the Framed banner", () => {
  test("show unless they were switched off", () => {
    expect(DEFAULT_STYLE.tagFeed).toBe(true);
    expect(parseStyle({}).tagFeed).toBe(true);
    expect(parseStyle({ tagFeed: false }).tagFeed).toBe(false);
    expect(parseStyle({ tagFeed: "no" }).tagFeed).toBe(true);
  });
});

describe("the Popouts", () => {
  test("come after each round of the feed, through the latest bosses, unless set otherwise", () => {
    expect(parseStyle({}).popouts).toEqual(DEFAULT_STYLE.popouts);
    expect(DEFAULT_STYLE.popouts).toMatchObject({ timing: "afterFeed", bosses: "latest" });
    expect(parseStyle({ popouts: { timing: "now", bosses: "worst" } }).popouts).toEqual(
      DEFAULT_STYLE.popouts,
    );
  });

  test("the time since the last Death and Overworld's count start as Popouts, and the rest in the feed", () => {
    const style = parseStyle({});
    const popouts = style.pieces.filter((entry) => isPopout(entry, style));

    expect(popouts.map(({ piece }) => piece)).toEqual(["sinceDeath", "overworld"]);
  });

  test("a stat the Streamer moved stays where they put it, but only one the feed has a place for", () => {
    const style = parseStyle({
      pieces: [
        { piece: "sinceDeath", show: true, popout: false },
        { piece: "stream", show: true, popout: true },
        { piece: "total", show: true, popout: true },
      ],
    });

    expect(style.pieces.slice(0, 3)).toEqual([
      { piece: "sinceDeath", show: true, popout: false },
      { piece: "stream", show: true, popout: true },
      { piece: "total", show: true },
    ]);
    expect(style.pieces.filter((entry) => isPopout(entry, style)).map(({ piece }) => piece)).toEqual([
      "stream",
      "overworld",
    ]);
  });

  test("the labels before a boss's name are the Streamer's, or else the usual ones", () => {
    const style = parseStyle({ labels: { popoutFelled: "Beaten" } });

    expect(statLabel(style, "popoutFelled")).toBe("Beaten");
    expect(statLabel(style, "popoutToughest")).toBe("Most deaths");
  });

  test("switched off, every stat is in the feed", () => {
    const style = parseStyle({ popouts: { timing: "off" } });

    expect(style.pieces.some((entry) => isPopout(entry, style))).toBe(false);
  });
});

describe("the panels' \"You died\"", () => {
  test("plays unless it was switched off", () => {
    expect(DEFAULT_STYLE.youDied).toBe(true);
    expect(parseStyle({}).youDied).toBe(true);
    expect(parseStyle({ youDied: false }).youDied).toBe(false);
    expect(parseStyle({ youDied: "no" }).youDied).toBe(true);
  });
});

describe("Overworld's line in the List view", () => {
  test("shows unless it was switched off", () => {
    expect(DEFAULT_STYLE.overworld).toBe(true);
    expect(parseStyle({}).overworld).toBe(true);
    expect(parseStyle({ overworld: false }).overworld).toBe(false);
    expect(parseStyle({ overworld: "no" }).overworld).toBe(true);
  });
});

describe("the List view's Encounters", () => {
  const encounters = [
    { name: "Overworld", deathCount: 120, defeated: false },
    { name: "Margit", deathCount: 7, defeated: true },
    { name: "Godrick", deathCount: 3, defeated: false },
  ];

  test("all show, Overworld first, while Overworld's line is on", () => {
    expect(listViewEncounters(encounters, DEFAULT_STYLE)).toEqual(encounters);
  });

  test("leave out Overworld, the rest kept in order, while it's off", () => {
    expect(listViewEncounters(encounters, { ...DEFAULT_STYLE, overworld: false })).toEqual(
      encounters.slice(1),
    );
  });
});

describe("Tags' pieces", () => {
  const tags = [
    { tagId: "k57gravity", name: "Gravity", count: 7, gravity: true },
    { tagId: "k57birds", name: "Birds", count: 2, gravity: false },
  ];

  test("a style saved before Tags keeps Gravity's piece, and has no Tag's", () => {
    const pieces = [
      { piece: "encounter", show: true },
      { piece: "gravity", show: true },
      { piece: "total", show: false },
    ];

    expect(parseStyle({ pieces }).pieces).toEqual([...pieces, ...LATER]);
  });

  test("a Tag's piece is kept once, by an ID that can only be a Tag's", () => {
    expect(
      parseStyle({
        pieces: [
          { piece: "tag", tagId: "k57birds", show: false },
          { piece: "tag", tagId: "k57birds", show: true },
          { piece: "tag", tagId: "../x", show: true },
          { piece: "tag", show: true },
          { piece: "encounter", show: true },
          { piece: "total", show: true },
          { piece: "gravity", show: true },
        ],
      }).pieces,
    ).toEqual([
      { piece: "tag", tagId: "k57birds", show: false },
      { piece: "encounter", show: true },
      { piece: "total", show: true },
      { piece: "gravity", show: true },
      ...LATER,
    ]);
  });

  test("a Tag's piece keeps its label, at most two lines cut to length, and only a Tag's has one", () => {
    expect(
      parseStyle({
        pieces: [
          { piece: "gravity", show: true, label: " Falls \n\n taken\nextra" },
          { piece: "tag", tagId: "k57birds", show: true, label: "x".repeat(30) },
          { piece: "total", show: true, label: "Everything" },
          { piece: "encounter", show: true, label: " \n " },
        ],
      }).pieces.slice(0, 4),
    ).toEqual([
      { piece: "gravity", show: true, label: "Falls\ntaken" },
      { piece: "tag", tagId: "k57birds", show: true, label: "x".repeat(20) },
      { piece: "total", show: true },
      { piece: "encounter", show: true },
    ]);
  });

  test("a stat keeps its label, at most two lines cut to length, and an unknown stat's is dropped", () => {
    expect(
      parseStyle({
        labels: {
          total: " Deaths ",
          attempts: "Tries\nhere\nnow",
          defeated: "x".repeat(30),
          stream: " \n ",
          felled: 3,
          boss: "Who",
        },
      }).labels,
    ).toEqual({ total: "Deaths", attempts: "Tries\nhere", defeated: "x".repeat(20) });
  });

  test("a stat is called by its label, or else what the panels usually call it", () => {
    const style = parseStyle({ labels: { total: "Deaths" } });

    expect(statLabel(style, "total")).toBe("Deaths");
    expect(statLabel(style, "defeated")).toBe("Bosses\nfelled");
  });

  test("a Tag's tally is called by its label, or else its name over deaths", () => {
    expect(tagLabel({ piece: "gravity", show: true }, "Gravity")).toBe(
      "Gravity\ndeaths",
    );
    expect(
      tagLabel({ piece: "gravity", show: true, label: "Falls" }, "Gravity"),
    ).toBe("Falls");
  });

  test("Gravity's piece shows the Gravity Tag, and a Tag's piece that Tag", () => {
    expect(pieceTag({ piece: "gravity", show: true }, tags)).toBe(tags[0]);
    expect(pieceTag({ piece: "tag", tagId: "k57birds", show: true }, tags)).toBe(
      tags[1],
    );
    expect(pieceTag({ piece: "total", show: true }, tags)).toBeUndefined();
  });

  test("a removed Tag's piece shows nothing", () => {
    const live = tags.slice(1);

    expect(pieceTag({ piece: "gravity", show: true }, live)).toBeUndefined();
    expect(
      pieceTag({ piece: "tag", tagId: "k57crows", show: true }, live),
    ).toBeUndefined();
  });
});
