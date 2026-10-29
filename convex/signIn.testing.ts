/// <reference types="vite/client" />
// Shared by the backend tests. The second dot in the file name keeps Convex
// from deploying it.
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import staticHostingTest from "@convex-dev/static-hosting/test";
import { decodeJwt } from "jose";
import { expect, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEATH_COOLDOWN_MS } from "./deathLimits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

// In production the Panel is on the Convex site, as auth is.
export const SITE_URL = "https://test.convex.site";
export const OWNER_LOGIN = "streamer";

export type FakeTwitchUser = { id: string; login: string; displayName: string };

export const owner: FakeTwitchUser = {
  id: "111",
  login: OWNER_LOGIN,
  displayName: "Streamer",
};

export function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  staticHostingTest.register(t);
  return t;
}

export type T = ReturnType<typeof setup>;

// Fakes the clock, starting a minute from now, and returns that time to
// measure from. convex-test won't let a transaction's time go behind its last
// commit, so a test's clock must start after anything already committed: a
// fixed date that has fallen behind the real time would be raised to it.
export function useFutureClock() {
  const now = Date.now() + 60_000;
  vi.useFakeTimers({ now });
  return now;
}

export function stubAuthEnv() {
  vi.stubEnv("SITE_URL", SITE_URL);
  vi.stubEnv("CONVEX_CLOUD_URL", "https://test.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("TWITCH_CLIENT_ID", "fake-client-id");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "fake-client-secret");
  vi.stubEnv("OWNER_TWITCH_LOGIN", OWNER_LOGIN);
}

// Stands in for id.twitch.tv and api.twitch.tv while a test runs.
function fakeTwitch(user: FakeTwitchUser) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.href === "https://id.twitch.tv/oauth2/token") {
      return Response.json({
        access_token: "fake-access-token",
        refresh_token: "fake-refresh-token",
        id_token: fakeIdToken(user.id),
        expires_in: 14400,
        scope: ["openid"],
        token_type: "bearer",
      });
    }
    if (url.href === "https://api.twitch.tv/helix/users") {
      return Response.json({
        data: [
          { id: user.id, login: user.login, display_name: user.displayName },
        ],
      });
    }
    throw new Error(`Unexpected fetch in test: ${url.href}`);
  });
}

function fakeIdToken(sub: string) {
  const encode = (part: object) =>
    btoa(JSON.stringify(part)).replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode({
    sub,
    iss: "https://id.twitch.tv/oauth2",
    aud: "fake-client-id",
  })}.`;
}

// Browser-like headers, so the test can prove they don't end up stored.
export const browserHeaders = {
  origin: SITE_URL,
  "user-agent": "Mozilla/5.0 (TestBrowser)",
  "x-forwarded-for": "203.0.113.7",
  "x-real-ip": "203.0.113.7",
};

function cookiesFrom(response: Response, jar: Map<string, string>) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const [name, ...value] = pair!.split("=");
    jar.set(name!, value.join("="));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

// Signs in through the real auth routes, from the "Sign in with Twitch"
// click to the Convex JWT the Panel would use. The Panel and auth share an
// origin, so the browser keeps the auth cookies.
export async function signInWithTwitch(t: T, user: FakeTwitchUser) {
  fakeTwitch(user);
  const jar = new Map<string, string>();

  const start = await t.fetch("/api/auth/sign-in/oauth2", {
    method: "POST",
    headers: { ...browserHeaders, "content-type": "application/json" },
    body: JSON.stringify({ providerId: "twitch", callbackURL: "/" }),
  });
  expect(start.status).toBe(200);
  cookiesFrom(start, jar);
  const { url } = (await start.json()) as { url: string };
  const authorizeUrl = new URL(url);

  const callback = await t.fetch(
    `/api/auth/oauth2/callback/twitch?code=fake-code&state=${authorizeUrl.searchParams.get("state")}`,
    { headers: { ...browserHeaders, cookie: cookieHeader(jar) } },
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe("/");
  cookiesFrom(callback, jar);

  const tokenResponse = await t.fetch("/api/auth/convex/token", {
    headers: { ...browserHeaders, cookie: cookieHeader(jar) },
  });
  expect(tokenResponse.status).toBe(200);
  const { token } = (await tokenResponse.json()) as { token: string };
  const claims = decodeJwt(token);

  return {
    authorizeUrl,
    claims,
    asUser: t.withIdentity({
      subject: claims.sub!,
      sessionId: claims.sessionId as string,
    }),
  };
}

export type AsUser = Awaited<ReturnType<typeof signInWithTwitch>>["asUser"];

// Records Deaths one after another, as pressing the Panel's button does,
// moving a fake clock past the cooldown before each. Oldest first.
export async function recordDeaths(
  as: AsUser,
  runId: Id<"runs">,
  count: number,
  encounterId?: Id<"encounters">,
) {
  if (!vi.isFakeTimers()) {
    useFutureClock();
  }
  const deathIds = [];
  for (let i = 0; i < count; i++) {
    vi.setSystemTime(Date.now() + DEATH_COOLDOWN_MS);
    deathIds.push(await as.mutation(api.deaths.record, { runId, encounterId }));
  }
  return deathIds;
}
