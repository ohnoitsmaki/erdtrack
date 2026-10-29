import { describe, expect, test } from "vitest";
import { bosses, findBoss, searchBosses } from "./bosses";

function displayNames(query: string) {
  return searchBosses(query).map((boss) => boss.displayName);
}

describe("boss list", () => {
  test("every one of the 207 bosses can be found by its defeat flag", () => {
    const flags = new Set(bosses.map((boss) => boss.flag));

    expect(flags.size).toBe(207);
  });

  test("a boss's display name is its name, place and region", () => {
    expect(findBoss("1043330800")?.displayName).toBe(
      "Erdtree Avatar — Minor Erdtree (Weeping Peninsula)",
    );
  });

  test("a boss with no place is shown with just its region", () => {
    expect(findBoss("1043370800")?.displayName).toBe(
      "Night's Cavalry (Limgrave)",
    );
  });

  // The save records a fight as won with one defeat flag, so a fight with
  // several bosses is one boss here, as the Watcher sees it.
  test("each boss has a defeat flag of its own", () => {
    expect(bosses).toHaveLength(207);
    expect(bosses.map((boss) => boss.id)).toEqual(
      bosses.map((boss) => String(boss.flag)),
    );
  });

  test("Radagon and the Elden Beast are one boss", () => {
    expect(findBoss("19000800")?.displayName).toBe(
      "Radagon of the Golden Order & Elden Beast — Fractured Marika (Leyndell, Ashen Capital)",
    );
  });
});

describe("search", () => {
  test("matches the name, ignoring case", () => {
    expect(displayNames("elden beast")).toEqual([
      "Radagon of the Golden Order & Elden Beast — Fractured Marika (Leyndell, Ashen Capital)",
    ]);
  });

  test("matches the place", () => {
    expect(displayNames("bellum church")).toEqual([
      "Night's Cavalry — Bellum Church (Liurnia of the Lakes)",
    ]);
  });

  test("matches the region, telling repeated names apart", () => {
    expect(displayNames("erdtree avatar liurnia")).toEqual([
      "Erdtree Avatar — Converted Tower (Liurnia of the Lakes)",
      "Erdtree Avatar — Mausoleum Compound (Liurnia of the Lakes)",
    ]);
  });

  test("matches a phase's name the boss list doesn't use", () => {
    expect(displayNames("hoarah loux")).toEqual([
      "Godfrey, First Elden Lord — Elden Throne (Leyndell, Ashen Capital)",
    ]);
    expect(displayNames("beast clergyman")).toEqual([
      "Maliketh, the Black Blade (Crumbling Farum Azula)",
    ]);
  });

  test("an empty search lists every boss", () => {
    expect(searchBosses("  ")).toHaveLength(bosses.length);
  });
});
