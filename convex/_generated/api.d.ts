/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bossAliases from "../bossAliases.js";
import type * as bosses from "../bosses.js";
import type * as changes from "../changes.js";
import type * as channels from "../channels.js";
import type * as currentEncounter from "../currentEncounter.js";
import type * as deathLimits from "../deathLimits.js";
import type * as deaths from "../deaths.js";
import type * as encounterLimits from "../encounterLimits.js";
import type * as encounters from "../encounters.js";
import type * as http from "../http.js";
import type * as mods from "../mods.js";
import type * as overlay from "../overlay.js";
import type * as overlayStyle from "../overlayStyle.js";
import type * as panel from "../panel.js";
import type * as runLimits from "../runLimits.js";
import type * as runs from "../runs.js";
import type * as streams from "../streams.js";
import type * as tagLimits from "../tagLimits.js";
import type * as tags from "../tags.js";
import type * as twitchLogin from "../twitchLogin.js";
import type * as watcher from "../watcher.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bossAliases: typeof bossAliases;
  bosses: typeof bosses;
  changes: typeof changes;
  channels: typeof channels;
  currentEncounter: typeof currentEncounter;
  deathLimits: typeof deathLimits;
  deaths: typeof deaths;
  encounterLimits: typeof encounterLimits;
  encounters: typeof encounters;
  http: typeof http;
  mods: typeof mods;
  overlay: typeof overlay;
  overlayStyle: typeof overlayStyle;
  panel: typeof panel;
  runLimits: typeof runLimits;
  runs: typeof runs;
  streams: typeof streams;
  tagLimits: typeof tagLimits;
  tags: typeof tags;
  twitchLogin: typeof twitchLogin;
  watcher: typeof watcher;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
