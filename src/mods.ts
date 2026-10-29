import { twitchLogin } from "../convex/twitchLogin";

// Shown inline under the Add Mod field. The backend refuses the same logins,
// and also ones it can only check itself, like an existing Mod's.
export function loginProblem(input: string) {
  return twitchLogin(input)
    ? undefined
    : "Twitch logins are letters, digits and underscores.";
}
