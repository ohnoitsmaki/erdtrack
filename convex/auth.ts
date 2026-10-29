import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);

// Better Auth stores more than a Twitch user ID and display
// name by default, so every place it would keep identity data is closed off
// here. The privacy test in auth.test.ts checks that this holds.
const withoutOAuthTokens = async <T extends object>(account: T) => ({
  data: {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  },
});

// The Panel's origin, where auth is too: the Convex site, unless SITE_URL
// says otherwise, as it does in development for the dev server, which
// passes /api/auth through.
function siteUrl() {
  return process.env.SITE_URL || process.env.CONVEX_SITE_URL!;
}

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl(),
    trustedOrigins: [siteUrl()],
    database: authComponent.adapter(ctx),
    advanced: { ipAddress: { disableIpTracking: true } },
    account: { updateAccountOnSignIn: false },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, userAgent: null },
          }),
        },
      },
      account: {
        create: { before: withoutOAuthTokens },
        update: { before: withoutOAuthTokens },
      },
    },
    plugins: [
      // Twitch is set up through genericOAuth rather than Better Auth's
      // built-in provider, because the built-in one always asks for the
      // email ID token claims, and Twitch refuses those without the
      // user:read:email scope we deliberately don't request.
      genericOAuth({
        config: [
          {
            providerId: "twitch",
            clientId: process.env.TWITCH_CLIENT_ID!,
            clientSecret: process.env.TWITCH_CLIENT_SECRET!,
            authorizationUrl: "https://id.twitch.tv/oauth2/authorize",
            tokenUrl: "https://id.twitch.tv/oauth2/token",
            scopes: ["openid"],
            overrideUserInfo: true,
            // Twitch's ID token carries the display name but not the login,
            // and the Streamer and Mods are configured by login. So ask Helix,
            // using the access token once before it is thrown away.
            getUserInfo: async (tokens) => {
              const twitchUser = await fetchTwitchUser(tokens.accessToken!);
              // Sign-in only ever runs in the auth HTTP routes, which can run
              // mutations. Other contexts never reach getUserInfo.
              if ("runMutation" in ctx) {
                await ctx.runMutation(internal.channels.bindOnSignIn, {
                  twitchId: twitchUser.id,
                  login: twitchUser.login,
                });
              }
              return {
                id: twitchUser.id,
                name: twitchUser.display_name,
                // Better Auth requires an email. This one is deliberately fake.
                email: `${twitchUser.id}@twitch.invalid`,
                emailVerified: false,
              };
            },
          },
        ],
      }),
      convex({
        authConfig,
        jwt: { definePayload: ({ user }) => ({ name: user.name }) },
      }),
    ],
  } satisfies BetterAuthOptions);

type TwitchUser = { id: string; login: string; display_name: string };

async function fetchTwitchUser(accessToken: string): Promise<TwitchUser> {
  const response = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "client-id": process.env.TWITCH_CLIENT_ID!,
    },
  });
  if (!response.ok) {
    throw new Error(`Twitch user lookup failed: ${response.status}`);
  }
  const { data } = (await response.json()) as { data: TwitchUser[] };
  if (!data[0]) {
    throw new Error("Twitch user lookup returned no user");
  }
  return data[0];
}
