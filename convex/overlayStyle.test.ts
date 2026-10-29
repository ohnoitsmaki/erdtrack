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

describe("the Overlay's style", () => {
  test("OBS reads it without signing in, and it's null until it's styled", async () => {
    const t = setup();
    const asOwner = await signIn(t, owner);

    expect(await t.query(api.overlayStyle.current, {})).toBeNull();

    await asOwner.mutation(api.overlayStyle.save, { style: { layout: "card" } });

    expect(await t.query(api.overlayStyle.current, {})).toEqual({ layout: "card" });
  });

  test("with no channel yet there's nothing to read", async () => {
    const t = setup();

    expect(await t.query(api.overlayStyle.current, {})).toBeNull();
  });

  test("a Mod can style it, and a later save replaces the style", async () => {
    const t = setup();
    const asOwner = await signIn(t, owner);
    await asOwner.mutation(api.mods.add, { login: someMod.login });
    const asMod = await signIn(t, someMod);

    await asOwner.mutation(api.overlayStyle.save, { style: { layout: "card" } });
    await asMod.mutation(api.overlayStyle.save, { style: { layout: "row" } });

    expect(await t.query(api.overlayStyle.current, {})).toEqual({ layout: "row" });
  });

  test("no one signed out can style it", async () => {
    const t = setup();
    await signIn(t, owner);

    await expect(
      t.mutation(api.overlayStyle.save, { style: { layout: "card" } }),
    ).rejects.toThrow("Only the Streamer and Mods");
    await expect(
      t.mutation(api.overlayStyle.savePreset, { name: "x", style: {} }),
    ).rejects.toThrow("Only the Streamer and Mods");
    await expect(t.query(api.overlayStyle.presets, {})).rejects.toThrow(
      "Only the Streamer and Mods",
    );
  });

  test("a style too big for any real one is refused", async () => {
    const t = setup();
    const asOwner = await signIn(t, owner);

    await expect(
      asOwner.mutation(api.overlayStyle.save, {
        style: { font: { family: "x".repeat(40_000) } },
      }),
    ).rejects.toThrow("too big");
  });
});

describe("Presets", () => {
  test("saving under a name already taken replaces it in its place", async () => {
    const t = setup();
    const asOwner = await signIn(t, owner);

    await asOwner.mutation(api.overlayStyle.savePreset, {
      name: " Bosses ",
      style: { layout: "card" },
    });
    await asOwner.mutation(api.overlayStyle.savePreset, {
      name: "Plain",
      style: { layout: "row" },
    });
    await asOwner.mutation(api.overlayStyle.savePreset, {
      name: "Bosses",
      style: { layout: "banner" },
    });

    expect(await asOwner.query(api.overlayStyle.presets, {})).toEqual([
      { name: "Bosses", style: { layout: "banner" } },
      { name: "Plain", style: { layout: "row" } },
    ]);
  });

  test("a Preset needs a name, and a deleted one is gone", async () => {
    const t = setup();
    const asOwner = await signIn(t, owner);

    await expect(
      asOwner.mutation(api.overlayStyle.savePreset, { name: "  ", style: {} }),
    ).rejects.toThrow("name");

    await asOwner.mutation(api.overlayStyle.savePreset, { name: "A", style: {} });
    await asOwner.mutation(api.overlayStyle.deletePreset, { name: "A" });

    expect(await asOwner.query(api.overlayStyle.presets, {})).toEqual([]);
  });
});
