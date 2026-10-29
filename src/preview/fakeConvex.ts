// Dev only: a stand-in for the Convex client, for looking at the Panel
// without signing in. The real pages run against sample data held in this
// tab's memory, and their buttons change it. Nothing reaches a deployment.
// Each query is worked out from the Deaths, so the counts always agree.
//
// With a latency, sign-in and each query's first result arrive that long
// after they're asked for, give or take half, so skeletons show and each
// part of a page lands on its own, as over a real connection. "hold" never
// lets them arrive, until release(), to look at the skeletons at rest and
// then watch what's held land.
import { getFunctionName, type FunctionReference } from "convex/server";
import { DEATH_COOLDOWN_MS } from "../../convex/deathLimits";
import { findBoss, searchBosses } from "../../convex/bosses";

type Encounter = {
  _id: string;
  runId: string;
  kind: "overworld" | "boss" | "custom";
  bossId?: string;
  name: string;
  nickname: string | null;
  defeated: boolean;
  hidden: boolean;
};
type Death = { _id: string; runId: string; encounterId: string; tagIds: string[]; at: number };
type Run = { _id: string; characterName: string; archived: boolean };
type Change = { _id: string; at: number; action: string; description: string; actorName: string };

const ME = "NotMaki";
const MINUTE = 60_000;

let ids = 0;
const id = (prefix: string) => `${prefix}${++ids}`;

function sampleState() {
  const now = Date.now();
  const runs: Run[] = [
    { _id: "run1", characterName: "nyawning", archived: false },
    { _id: "run2", characterName: "Practice", archived: false },
    { _id: "run3", characterName: "Tarnished", archived: true },
  ];
  const encounters: Encounter[] = [];
  const overworld = (runId: string) => {
    const e: Encounter = { _id: id("e"), runId, kind: "overworld", name: "Overworld", nickname: null, defeated: false, hidden: false };
    encounters.push(e);
    return e;
  };
  // A boss from the bundled list, so its place and region show as they do.
  const boss = (runId: string, search: string, defeated: boolean, more: Partial<Encounter> = {}) => {
    const found = searchBosses(search)[0];
    if (!found) {
      throw new Error(`Preview: no bundled boss matches "${search}"`);
    }
    const e: Encounter = {
      _id: id("e"), runId, kind: "boss", bossId: found.id, name: found.name,
      nickname: null, defeated, hidden: false, ...more,
    };
    encounters.push(e);
    return e;
  };
  // In the Run's order, oldest first.
  const ow = overworld("run1");
  const run1: [Encounter, number][] = [
    [ow, 135],
    [boss("run1", "Commander Niall", true), 11],
    [boss("run1", "Morgott", true), 0],
    [boss("run1", "Godfrey First Elden Lord", true), 2],
    [boss("run1", "Fia's Champion", true, { nickname: "RANDY" }), 1],
    [boss("run1", "Valiant Gargoyle", true, { nickname: "gargoyle hell" }), 7],
    [boss("run1", "Starscourge Radahn", true), 1],
    [boss("run1", "Godskin Duo", true, { nickname: "600lb" }), 3],
    [boss("run1", "Mohg Lord of Blood", true), 12],
    [boss("run1", "Battlemage Hugues", true, { hidden: true }), 0],
    [boss("run1", "Maliketh", false), 34],
    [boss("run1", "Malenia", false), 47],
  ];
  overworld("run2");
  overworld("run3");
  const tags = [
    { _id: "tag1", name: "Gravity", gravity: true },
    { _id: "tag2", name: "Birds", gravity: false },
  ];
  // The newest Deaths are in streaks, as they'd be on stream; the rest are
  // spread back over the days before.
  const deaths: Death[] = [];
  const left = new Map(run1.map(([e, n]) => [e._id, n]));
  const take = (e: Encounter, n: number, tagIds: string[] = []) => {
    for (let i = 0; i < n && left.get(e._id)! > 0; i++) {
      left.set(e._id, left.get(e._id)! - 1);
      deaths.push({ _id: "", runId: "run1", encounterId: e._id, tagIds, at: 0 });
    }
  };
  const [malenia, maliketh] = [run1[11]![0], run1[10]![0]];
  take(malenia, 4); take(ow, 1, ["tag1"]); take(malenia, 6); take(ow, 2, ["tag2"]);
  take(maliketh, 3); take(ow, 1, ["tag1"]); take(maliketh, 5); take(ow, 3);
  for (const [e] of run1) {
    take(e, Infinity, e === ow && deaths.length % 3 === 0 ? ["tag1"] : []);
  }
  let at = now - 45_000;
  deaths.forEach((d, i) => {
    d._id = `d${deaths.length - i}`;
    d.at = at;
    at -= (i < 40 ? 2 + ((i * 7) % 5) : 20 + ((i * 13) % 50)) * MINUTE;
  });
  for (const d of deaths.filter((d) => d.tagIds.length === 0 && d.encounterId === ow._id).slice(0, 30)) {
    d.tagIds = ["tag1"];
  }
  return {
    runs,
    activeRunId: "run1" as string | null,
    current: new Map([["run1", malenia._id], ["run2", encounters.find((e) => e.runId === "run2")!._id], ["run3", encounters.find((e) => e.runId === "run3")!._id]]),
    encounters,
    deaths: deaths.reverse(),
    tags,
    stream: { startedAt: now - (1 * 3600 + 42 * 60) * 1000 } as { startedAt: number } | null,
    popoutAt: null as number | null,
    watcher: { online: true, since: now - 3 * 3600_000, characterName: "nyawning" },
    mods: [
      { _id: "mod1", login: "chatmod_jen", displayName: "chatmod_jen" },
      { _id: "mod2", login: "pebble", displayName: null },
    ],
    hasToken: true,
    changes: [
      { _id: "c1", at: now - 45_000, action: "recordDeath", description: `Recorded a Death in ${malenia.name}`, actorName: "Watcher" },
      { _id: "c2", at: now - 9 * MINUTE, action: "updateDeaths", description: "Tagged a Death Gravity", actorName: "chatmod_jen" },
      { _id: "c3", at: now - 25 * MINUTE, action: "setCurrent", description: `Switched to ${malenia.name}`, actorName: ME },
    ] as Change[],
    presets: [] as { name: string; style: unknown }[],
    style: null as unknown,
  };
}

type State = ReturnType<typeof sampleState>;

export type Latency = number | "hold";

export class FakeConvex {
  private state: State = sampleState();
  private listeners = new Set<() => void>();
  private cache = new Map<string, unknown>();
  // The queries asked for whose first result hasn't arrived, by key.
  private waiting = new Set<string>();
  private arrived = new Set<string>();

  private signIn?: () => void;

  constructor(private latency: Latency = 0) {}

  // Lets everything held arrive at once, and what's asked for from now on
  // straight away.
  release() {
    this.latency = 0;
    this.waiting.clear();
    this.signIn?.();
    this.notify();
  }

  // When a result asked for as `key` arrives: spread over half to one and a
  // half times the latency, the same for a key every time.
  private delay(key: string) {
    if (this.latency === "hold") {
      return Infinity;
    }
    let hash = 0;
    for (const char of key) {
      hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return this.latency * (0.5 + (Math.abs(hash) % 1000) / 1000);
  }

  private notify() {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  private hasArrived(key: string) {
    if (this.latency === 0 || this.arrived.has(key)) {
      return true;
    }
    if (!this.waiting.has(key)) {
      this.waiting.add(key);
      const wait = this.delay(key);
      if (wait !== Infinity) {
        setTimeout(() => {
          this.waiting.delete(key);
          this.arrived.add(key);
          this.notify();
        }, wait);
      }
    }
    return false;
  }

  watchQuery(query: FunctionReference<"query">, args?: Record<string, unknown>) {
    const name = getFunctionName(query);
    const key = `${name}:${JSON.stringify(args ?? {})}`;
    return {
      onUpdate: (callback: () => void) => {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
      },
      // The same object until something changes, as the real client gives.
      localQueryResult: () => {
        if (!this.hasArrived(key)) {
          return undefined;
        }
        if (!this.cache.has(key)) {
          this.cache.set(key, this.query(name, args ?? {}));
        }
        return this.cache.get(key);
      },
      journal: () => undefined,
    };
  }

  async mutation(mutation: FunctionReference<"mutation">, args?: Record<string, unknown>) {
    const result = this.mutate(getFunctionName(mutation), args ?? {});
    this.cache.clear();
    this.notify();
    return result;
  }

  async action() {
    throw new Error("Actions don't run in the preview.");
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null };
  }

  subscribeToConnectionState() {
    return () => {};
  }

  // Signed in as the Streamer, once the latency has passed.
  setAuth(_fetchToken: unknown, onChange?: (isAuthenticated: boolean) => void) {
    this.signIn = () => {
      this.signIn = undefined;
      onChange?.(true);
    };
    const wait = this.delay("auth");
    if (wait !== Infinity) {
      setTimeout(() => this.signIn?.(), wait);
    }
  }
  clearAuth() {}
  async close() {}

  // Queries.

  private query(name: string, args: Record<string, unknown>): unknown {
    const s = this.state;
    switch (name) {
      case "panel:viewer":
        return { status: "owner", displayName: ME };
      case "runs:activeRun": {
        const run = s.runs.find((r) => r._id === s.activeRunId);
        return run ? this.summary(run) : null;
      }
      case "runs:run": {
        const run = s.runs.find((r) => r._id === args.runId);
        return run ? { ...this.summary(run), active: run._id === s.activeRunId } : null;
      }
      case "runs:list":
        return s.runs.map((run) => ({
          _id: run._id,
          characterName: run.characterName,
          total: this.deathsIn(run._id).length,
          archived: run.archived,
          active: run._id === s.activeRunId,
        }));
      case "runs:deathFeed": {
        const opts = args.paginationOpts as { numItems: number; cursor: string | null };
        const all = s.activeRunId ? this.deathsIn(s.activeRunId).reverse() : [];
        const from = opts.cursor ? Number(opts.cursor) : 0;
        const to = from + opts.numItems;
        const byId = new Map(s.encounters.map((e) => [e._id, e]));
        return {
          page: all.slice(from, to).map((d) => ({
            _id: d._id,
            _creationTime: d.at,
            encounterId: d.encounterId,
            encounterName: byId.get(d.encounterId)?.name,
            encounterNickname: byId.get(d.encounterId)?.nickname ?? null,
            tagIds: d.tagIds,
          })),
          isDone: to >= all.length,
          continueCursor: String(to),
        };
      }
      case "tags:list":
        return s.tags;
      case "streams:current":
        return s.stream && { startedAt: s.stream.startedAt, deaths: s.deaths.filter((d) => d.at >= s.stream!.startedAt).length };
      case "watcher:status":
        return s.hasToken ? { ...s.watcher, needsRun: false, otherCharacterRunId: null } : null;
      case "watcher:hasToken":
        return s.hasToken;
      case "mods:list":
        return s.mods;
      case "changes:history":
        return [...s.changes].reverse().map((c) => ({ ...c, isUndo: false, undone: false, blockedBy: null, refusal: null }));
      case "overlayStyle:current":
        return s.style;
      case "overlayStyle:presets":
        return s.presets;
      case "overlay:current":
        return this.overlay();
      default:
        console.warn(`Preview: no sample data for ${name}`);
        return null;
    }
  }

  private deathsIn(runId: string) {
    return this.state.deaths.filter((d) => d.runId === runId);
  }

  private counted(e: Encounter) {
    const deathCount = this.state.deaths.filter((d) => d.encounterId === e._id).length;
    return {
      _id: e._id, kind: e.kind, bossId: e.bossId, name: e.name, nickname: e.nickname,
      deathCount, defeated: e.defeated, hidden: e.hidden,
    };
  }

  private summary(run: Run) {
    const s = this.state;
    const deaths = this.deathsIn(run._id);
    return {
      _id: run._id,
      characterName: run.characterName,
      total: deaths.length,
      mismatch: null,
      lastDeathAt: deaths.at(-1)?.at ?? null,
      archived: run.archived,
      tallies: s.tags.map((t) => ({
        tagId: t._id, name: t.name, gravity: t.gravity,
        count: deaths.filter((d) => d.tagIds.includes(t._id)).length,
      })),
      currentEncounterId: s.current.get(run._id)!,
      encounters: s.encounters.filter((e) => e.runId === run._id).map((e) => this.counted(e)),
    };
  }

  private overlay() {
    const s = this.state;
    const run = s.runs.find((r) => r._id === s.activeRunId);
    if (!run) return null;
    const summary = this.summary(run);
    const nameOf = (e: { name: string; nickname: string | null }) => e.nickname ?? e.name;
    const current = summary.encounters.find((e) => e._id === summary.currentEncounterId)!;
    const listed = summary.encounters.filter((e) => !e.hidden);
    return {
      encounter: { name: nameOf(current), deathCount: current.deathCount },
      total: summary.total,
      gravity: summary.tallies.find((t) => t.gravity)?.count ?? 0,
      tags: summary.tallies,
      encounters: listed.map((e) => ({ name: nameOf(e), deathCount: e.deathCount, defeated: e.defeated })),
      defeated: listed.filter((e) => e.defeated).map((e) => ({ name: nameOf(e), deathCount: e.deathCount })),
      lastDeathAt: summary.lastDeathAt,
      streamDeaths: s.stream ? s.deaths.filter((d) => d.at >= s.stream!.startedAt).length : null,
      streamFelled: 0,
      popoutAt: s.popoutAt,
      playTime: { seconds: 187_651, running: false, receivedAt: Date.now(), lastSeenAt: null },
    };
  }

  // Mutations.

  private log(action: string, description: string) {
    this.state.changes.push({ _id: id("c"), at: Date.now(), action, description, actorName: ME });
  }

  private encounter(encounterId: unknown) {
    return this.state.encounters.find((e) => e._id === encounterId)!;
  }

  private addDeath(runId: string, encounterId: string, at = Date.now()) {
    this.state.deaths.push({ _id: id("d"), runId, encounterId, tagIds: [], at });
  }

  private mutate(name: string, a: Record<string, unknown>): unknown {
    const s = this.state;
    const runId = (a.runId as string | undefined) ?? s.activeRunId!;
    switch (name) {
      case "deaths:record": {
        const last = this.deathsIn(runId).at(-1)?.at ?? 0;
        if (Date.now() - last < DEATH_COOLDOWN_MS) {
          throw new Error("A Death was just recorded. Wait a moment.");
        }
        const current = s.current.get(runId)!;
        this.addDeath(runId, current);
        this.log("recordDeath", `Recorded a Death in ${this.encounter(current).name}`);
        return null;
      }
      case "deaths:update": {
        const chosen = s.deaths.filter((d) => (a.deathIds as string[]).includes(d._id));
        if (a.encounterId) {
          for (const d of chosen) d.encounterId = a.encounterId as string;
          this.log("updateDeaths", `Moved ${chosen.length} to ${this.encounter(a.encounterId).name}`);
        }
        const tag = a.tag as { tagId: string; tagged: boolean } | undefined;
        if (tag) {
          for (const d of chosen) {
            d.tagIds = tag.tagged ? [...new Set([...d.tagIds, tag.tagId])] : d.tagIds.filter((t) => t !== tag.tagId);
          }
          const tagName = s.tags.find((t) => t._id === tag.tagId)?.name;
          this.log("updateDeaths", `${tag.tagged ? "Tagged" : "Untagged"} ${chosen.length} ${tagName}`);
        }
        return null;
      }
      case "deaths:remove": {
        s.deaths = s.deaths.filter((d) => d._id !== a.deathId);
        this.log("removeDeath", "Removed a Death");
        return null;
      }
      case "deaths:addMany": {
        const count = a.count as number;
        let given = 0;
        for (const share of a.split as { encounterId?: string; bossId?: string; count: number; defeated?: boolean }[]) {
          let e = share.encounterId ? this.encounter(share.encounterId) : undefined;
          if (!e) {
            const found = findBoss(share.bossId!);
            e = { _id: id("e"), runId, kind: "boss", bossId: share.bossId, name: found?.name ?? "Boss", nickname: null, defeated: false, hidden: false };
            s.encounters.push(e);
          }
          if (share.defeated) e.defeated = true;
          for (let i = 0; i < share.count; i++) this.addDeath(runId, e._id, Date.now() - 86_400_000);
          given += share.count;
        }
        const ow = s.encounters.find((e) => e.runId === runId && e.kind === "overworld")!;
        for (let i = given; i < count; i++) this.addDeath(runId, ow._id, Date.now() - 86_400_000);
        s.deaths.sort((x, y) => x.at - y.at);
        this.log("addDeaths", `Added ${count} Deaths`);
        return null;
      }
      case "encounters:setCurrent":
        s.current.set(runId, a.encounterId as string);
        this.log("setCurrent", `Switched to ${this.encounter(a.encounterId).name}`);
        return null;
      case "encounters:markDefeated":
        this.encounter(a.encounterId).defeated = true;
        this.log("markDefeated", `Marked ${this.encounter(a.encounterId).name} Defeated`);
        return null;
      case "encounters:setHidden":
        this.encounter(a.encounterId).hidden = a.hidden as boolean;
        this.log("setHidden", `${a.hidden ? "Hid" : "Showed"} ${this.encounter(a.encounterId).name}`);
        return null;
      case "encounters:setNickname":
        this.encounter(a.encounterId).nickname = (a.nickname as string | null) ?? null;
        this.log("setNickname", `Nicknamed ${this.encounter(a.encounterId).name}`);
        return null;
      case "encounters:changeBoss": {
        const e = this.encounter(a.encounterId);
        const found = findBoss(a.bossId as string);
        e.bossId = a.bossId as string;
        e.name = found?.name ?? e.name;
        this.log("changeBoss", `Changed a boss to ${e.name}`);
        return null;
      }
      case "encounters:addBoss":
      case "encounters:addCustom": {
        const found = name === "encounters:addBoss" ? findBoss(a.bossId as string) : undefined;
        const e: Encounter = {
          _id: id("e"), runId, kind: found ? "boss" : "custom", bossId: found?.id,
          name: found?.name ?? (a.name as string), nickname: null, defeated: false, hidden: false,
        };
        s.encounters.push(e);
        this.log("addEncounter", `Added ${e.name}`);
        return e._id;
      }
      case "encounters:moveEncounter": {
        const moved = this.encounter(a.encounterId);
        s.encounters = s.encounters.filter((e) => e !== moved);
        const at = a.before ? s.encounters.indexOf(this.encounter(a.before)) : s.encounters.length;
        s.encounters.splice(at, 0, moved);
        this.log("moveEncounter", `Moved ${moved.name}`);
        return null;
      }
      case "runs:setActive":
        s.activeRunId = a.runId as string;
        this.log("setActiveRun", "Switched the active Run");
        return null;
      case "runs:createRun": {
        const run: Run = { _id: id("run"), characterName: a.characterName as string, archived: false };
        s.runs.push(run);
        const ow: Encounter = { _id: id("e"), runId: run._id, kind: "overworld", name: "Overworld", nickname: null, defeated: false, hidden: false };
        s.encounters.push(ow);
        s.current.set(run._id, ow._id);
        s.activeRunId = run._id;
        this.log("createRun", `Created ${run.characterName}'s Run`);
        return run._id;
      }
      case "runs:archive":
        s.runs.find((r) => r._id === a.runId)!.archived = true;
        if (s.activeRunId === a.runId) s.activeRunId = null;
        return null;
      case "runs:deleteRun":
        s.runs = s.runs.filter((r) => r._id !== a.runId);
        return null;
      case "streams:start":
        s.stream = { startedAt: Date.now() };
        return null;
      case "streams:end":
        s.stream = null;
        return null;
      case "overlay:popOut":
        s.popoutAt = Date.now();
        return null;
      case "tags:create": {
        const tag = { _id: id("tag"), name: a.name as string, gravity: false };
        s.tags.push(tag);
        this.log("createTag", `Created the Tag ${tag.name}`);
        return tag._id;
      }
      case "tags:rename":
        s.tags.find((t) => t._id === a.tagId)!.name = a.name as string;
        return null;
      case "tags:remove":
        s.tags = s.tags.filter((t) => t._id !== a.tagId);
        return null;
      case "mods:add":
        s.mods.push({ _id: id("mod"), login: a.login as string, displayName: null });
        return null;
      case "mods:remove":
        s.mods = s.mods.filter((m) => m._id !== a.modId);
        return null;
      case "watcher:createToken":
        s.hasToken = true;
        return "preview-token-not-real";
      case "watcher:revokeToken":
        s.hasToken = false;
        return null;
      case "overlayStyle:save":
        s.style = a.style;
        return null;
      case "overlayStyle:savePreset":
        s.presets = [...s.presets.filter((p) => p.name !== a.name), { name: a.name as string, style: a.style }];
        return null;
      case "overlayStyle:deletePreset":
        s.presets = s.presets.filter((p) => p.name !== a.name);
        return null;
      default:
        console.warn(`Preview: ${name} does nothing here`);
        return null;
    }
  }
}
