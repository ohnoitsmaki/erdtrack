// Twitch logins are lower case letters, digits and underscores. The Streamer
// may type one with an @ or in any case.
const LOGIN = /^[a-z0-9_]{1,25}$/;

// The login as Twitch has it, or undefined if it can't be one.
export function twitchLogin(input: string) {
  const login = input.trim().replace(/^@/, "").toLowerCase();
  return LOGIN.test(login) ? login : undefined;
}
