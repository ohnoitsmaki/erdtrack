import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import {
  owner,
  setup,
  signInWithTwitch,
  stubAuthEnv,
  type T,
} from "./signIn.testing";

async function allAuthRows(t: T) {
  const models = ["user", "session", "account", "verification"] as const;
  const rows: Record<string, unknown>[] = [];
  for (const model of models) {
    const page = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findMany, {
        model,
        paginationOpts: { cursor: null, numItems: 1000 },
      }),
    );
    rows.push(...page.page.map((row: object) => ({ model, ...row })));
  }
  return rows;
}

beforeEach(() => {
  stubAuthEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("privacy", () => {
  test("signing in stores no IP, user agent, OAuth token or real email", async () => {
    const t = setup();
    const user = { id: "12345", login: "somemod", displayName: "SomeMod" };
    // Twice, so a returning user's sign-in is checked as well as the first.
    await signInWithTwitch(t, user);
    await signInWithTwitch(t, user);

    const rows = await allAuthRows(t);
    expect(rows.some((row) => row.model === "account")).toBe(true);
    for (const row of rows) {
      // Better Auth writes an empty string where it has no value.
      expect(row.ipAddress || null).toBeNull();
      expect(row.userAgent || null).toBeNull();
      expect(row.accessToken || null).toBeNull();
      expect(row.refreshToken || null).toBeNull();
      expect(row.idToken || null).toBeNull();
      expect(row.accessTokenExpiresAt || null).toBeNull();
      expect(row.refreshTokenExpiresAt || null).toBeNull();
      if ("email" in row) {
        expect(row.email).toBe("12345@twitch.invalid");
      }
      // Nothing from the request leaks into any other field either.
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain("203.0.113.7");
      expect(serialized).not.toContain("TestBrowser");
      expect(serialized).not.toContain("fake-access-token");
      expect(serialized).not.toContain("fake-refresh-token");
    }
  });
});

describe("Twitch sign-in", () => {
  test("requests only the openid scope", async () => {
    const t = setup();
    const { authorizeUrl } = await signInWithTwitch(t, {
      id: "12345",
      login: "somemod",
      displayName: "SomeMod",
    });

    expect(authorizeUrl.origin).toBe("https://id.twitch.tv");
    expect(authorizeUrl.searchParams.get("scope")).toBe("openid");
  });

  test("Twitch sends the browser back to the Convex site, where the Panel is", async () => {
    const t = setup();
    const { authorizeUrl } = await signInWithTwitch(t, owner);

    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "https://test.convex.site/api/auth/oauth2/callback/twitch",
    );
  });

  test("asks for no ID token claims, which Twitch rejects without more scopes", async () => {
    const t = setup();
    const { authorizeUrl } = await signInWithTwitch(t, {
      id: "12345",
      login: "somemod",
      displayName: "SomeMod",
    });

    expect(authorizeUrl.searchParams.has("claims")).toBe(false);
  });

  test("the Convex JWT carries the display name but no email", async () => {
    const t = setup();
    const { claims } = await signInWithTwitch(t, {
      id: "12345",
      login: "somemod",
      displayName: "SomeMod",
    });

    expect(claims.name).toBe("SomeMod");
    expect(JSON.stringify(claims)).not.toContain("@");
    expect(claims).not.toHaveProperty("email");
  });
});

describe("Panel access", () => {
  test("a signed-out visitor is not signed in", async () => {
    const t = setup();

    expect(await t.query(api.panel.viewer, {})).toEqual({ status: "signedOut" });
  });

  test("the Streamer's login is bound on first sign-in and sees the Panel", async () => {
    const t = setup();
    const { asUser } = await signInWithTwitch(t, {
      id: "111",
      login: "streamer",
      displayName: "Streamer",
    });

    expect(await asUser.query(api.panel.viewer, {})).toEqual({
      status: "owner",
      displayName: "Streamer",
    });
  });

  test("anyone else is not authorized", async () => {
    const t = setup();
    await signInWithTwitch(t, { id: "111", login: "streamer", displayName: "Streamer" });
    const { asUser } = await signInWithTwitch(t, {
      id: "222",
      login: "somemod",
      displayName: "SomeMod",
    });

    expect(await asUser.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
  });

  test("once bound, a different Twitch account that later takes the Streamer's login is not the Streamer", async () => {
    const t = setup();
    await signInWithTwitch(t, { id: "111", login: "streamer", displayName: "Streamer" });
    const { asUser } = await signInWithTwitch(t, {
      id: "333",
      login: "streamer",
      displayName: "Streamer",
    });

    expect(await asUser.query(api.panel.viewer, {})).toEqual({
      status: "notAuthorized",
    });
  });

  test("the Streamer is still recognized on a later sign-in", async () => {
    const t = setup();
    await signInWithTwitch(t, { id: "111", login: "streamer", displayName: "Streamer" });
    const { asUser } = await signInWithTwitch(t, {
      id: "111",
      login: "streamer",
      displayName: "STREAMER",
    });

    expect(await asUser.query(api.panel.viewer, {})).toEqual({
      status: "owner",
      displayName: "STREAMER",
    });
  });
});

describe("the Panel's address", () => {
  // A self-hosted copy needn't set SITE_URL: the Convex site is the Panel's.
  beforeEach(() => {
    vi.stubEnv("SITE_URL", undefined);
  });

  test("without SITE_URL, Twitch sends the Streamer back to the Convex site", async () => {
    const t = setup();
    const start = await t.fetch("/api/auth/sign-in/oauth2", {
      method: "POST",
      headers: { origin: "https://test.convex.site", "content-type": "application/json" },
      body: JSON.stringify({ providerId: "twitch", callbackURL: "/" }),
    });
    const { url } = (await start.json()) as { url: string };

    expect(new URL(url).searchParams.get("redirect_uri")).toBe(
      "https://test.convex.site/api/auth/oauth2/callback/twitch",
    );
  });
});
