// Shared by the backend and the Panel. The list ships as static JSON in both
// bundles and is never stored in the database, so searching it costs no
// reads.
import eroverlay from "./eroverlayBosses.json";
import { bossAliases } from "./bossAliases";

export type Boss = {
  // The boss's defeat flag, which never changes. A fight with several
  // bosses, like Radagon and the Elden Beast, is one boss with one flag, as
  // the save records it.
  id: string;
  flag: number;
  name: string;
  place: string;
  region: string;
  displayName: string;
  // Other names it's searched by, never shown.
  aliases: string[];
};

// Some bosses have no place in the list, and their name and region alone
// already tell them apart.
function displayName(name: string, place: string, region: string) {
  return place ? `${name} — ${place} (${region})` : `${name} (${region})`;
}

function boss(
  id: string,
  flag: number,
  name: string,
  place: string,
  region: string,
) {
  return {
    id,
    flag,
    name,
    place,
    region,
    displayName: displayName(name, place, region),
    aliases: bossAliases[flag] ?? [],
  };
}

export const bosses: readonly Boss[] = eroverlay.flatMap((region) =>
  region.bosses.map((entry) =>
    boss(
      String(entry.flag_id),
      entry.flag_id,
      entry.boss,
      entry.place,
      region.region_name,
    ),
  ),
);

const byId = new Map(bosses.map((boss) => [boss.id, boss]));

export function findBoss(id: string) {
  return byId.get(id);
}

const searchText = new Map(
  bosses.map((boss) => [
    boss,
    [boss.name, boss.place, boss.region, ...boss.aliases].join(" ").toLowerCase(),
  ]),
);

// Every word of the query must appear in the name, place, region or an
// alias, so "avatar liurnia" narrows to the Erdtree Avatars in Liurnia.
export function searchBosses(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return bosses.filter((boss) =>
    words.every((word) => searchText.get(boss)!.includes(word)),
  );
}
