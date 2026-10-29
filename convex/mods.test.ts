import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  owner,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  type FakeTwitchUser,
  type T,
} from "./signIn.testing";

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const someMod: FakeTwitchUser = {
  id: "222",
  login: "somemod",
  displayName: "SomeMod",
};

async function signIn(t: T, user: FakeTwitchUser) {
  const { asUser } = await signInWithTwitch(t, user);
  vi.unstubAllGlobals();
  return asUser;
}

// The Streamer signs in and adds the Mod by login.
async function ownerWithMod(t: T, login = someMod.login) {
  const asOwner = await signIn(t, owner);
  await asOwner.mutation(api.mods.add, { login });
  return asOwner;
}

describe("adding a Mod", () => {
  test("a pending Mod is bound on first sign-in and sees the Panel", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t, "SomeMod");

    expect(await asOwner.query(api.mods.list, {})).toEqual([
      expect.objectContaining({ login: "somemod", displayName: null }),
    ]);
    const asMod = await signIn(t, someMod);

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "mod",
      displayName: "SomeMod",
    });
    expect(await asOwner.query(api.mods.list, {})).toEqual([
      expect.objectContaining({ login: "somemod", displayName: "SomeMod" }),
    ]);
  });

  test("an unknown login is refused", async () => {
    const t = setup();
    await ownerWithMod(t);
    const asStranger = await signIn(t, {
      id: "333",
      login: "stranger",
      displayName: "Stranger",
    });

    expect(await asStranger.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
    await expect(asStranger.query(api.runs.list, {})).rejects.toThrow(
      "Only the Streamer and Mods can do this.",
    );
  });

  test("once bound, a different Twitch account that later takes the Mod's login is not the Mod", async () => {
    const t = setup();
    await ownerWithMod(t);
    await signIn(t, someMod);
    const asImpostor = await signIn(t, { ...someMod, id: "333" });

    expect(await asImpostor.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
  });

  test("a Mod who renamed on Twitch and was added again under the new login is still the one Mod", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    await signIn(t, someMod);
    await asOwner.mutation(api.mods.add, { login: "renamedmod" });

    const asMod = await signIn(t, { ...someMod, login: "renamedmod" });

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "mod",
      displayName: "SomeMod",
    });
  });

  test("a Mod's display name refreshes on every sign-in", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    await signIn(t, someMod);
    const asMod = await signIn(t, { ...someMod, displayName: "RenamedMod" });

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "mod",
      displayName: "RenamedMod",
    });
    expect(await asOwner.query(api.mods.list, {})).toMatchObject([
      { displayName: "RenamedMod" },
    ]);
  });

  test.each([
    ["isn't a Twitch login", "some mod", `"some mod" isn't a Twitch login.`],
    ["is the Streamer's", "Streamer", "That's the Streamer's login."],
    ["is already a Mod", "@SomeMod", "somemod is already a Mod."],
  ])("a login that %s is refused", async (_, login, refusal) => {
    const t = setup();
    const asOwner = await ownerWithMod(t);

    await expect(asOwner.mutation(api.mods.add, { login })).rejects.toThrow(
      refusal,
    );
  });
});

describe("removing a Mod", () => {
  test("their session stops working immediately", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    const asMod = await signIn(t, someMod);
    const [mod] = await asOwner.query(api.mods.list, {});

    await asOwner.mutation(api.mods.remove, { modId: mod!._id });

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "signedOut",
    });
    await expect(asMod.query(api.runs.list, {})).rejects.toThrow(
      "Only the Streamer and Mods can do this.",
    );
    expect(await asOwner.query(api.mods.list, {})).toEqual([]);
  });

  test("signing in again after being removed isn't let in", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    await signIn(t, someMod);
    const [mod] = await asOwner.query(api.mods.list, {});
    await asOwner.mutation(api.mods.remove, { modId: mod!._id });

    const asMod = await signIn(t, someMod);

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
  });

  test("a pending Mod can be removed before they ever sign in", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    const [mod] = await asOwner.query(api.mods.list, {});

    await asOwner.mutation(api.mods.remove, { modId: mod!._id });
    const asMod = await signIn(t, someMod);

    expect(await asMod.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
  });
});

describe("Streamer-only actions", () => {
  test("each is refused for a Mod", async () => {
    const t = setup();
    const asOwner = await ownerWithMod(t);
    const runId = await asOwner.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asOwner.mutation(api.runs.archive, { runId });
    const [mod] = await asOwner.query(api.mods.list, {});
    const asMod = await signIn(t, someMod);

    const refusal = "Only the Streamer can do this.";
    await expect(asMod.query(api.mods.list, {})).rejects.toThrow(refusal);
    await expect(
      asMod.mutation(api.mods.add, { login: "another" }),
    ).rejects.toThrow(refusal);
    await expect(
      asMod.mutation(api.mods.remove, { modId: mod!._id }),
    ).rejects.toThrow(refusal);
    await expect(
      asMod.mutation(api.runs.deleteRun, { runId }),
    ).rejects.toThrow(refusal);

    // Nothing changed.
    expect(await asOwner.query(api.mods.list, {})).toHaveLength(1);
    expect(await asOwner.query(api.runs.list, {})).toHaveLength(1);
  });

  test("a Mod can do everything else, such as creating and archiving a Run", async () => {
    const t = setup();
    await ownerWithMod(t);
    const asMod = await signIn(t, someMod);

    const runId = await asMod.mutation(api.runs.createRun, {
      characterName: "Tarnished",
    });
    await asMod.mutation(api.runs.archive, { runId });

    expect(await asMod.query(api.runs.list, {})).toMatchObject([
      { characterName: "Tarnished", archived: true },
    ]);
    expect(await asMod.query(api.changes.history, { runId })).toMatchObject([
      { actorName: "SomeMod", description: "Archived Tarnished's Run" },
      { actorName: "SomeMod", description: "Created Tarnished's Run" },
    ]);
  });
});
