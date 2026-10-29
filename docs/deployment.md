# Deploying

Erdtrack is one Convex deployment. It runs the backend and, through its static-hosting component, serves the Panel at `https://<deployment>.convex.site`. The Panel serves the Overlay too, at `/overlay`, `/overlay/list` and `/overlay/demo`.

## Host your own copy

Your own copy keeps your channel's data in your own Convex account. It takes about 15 minutes, all in the browser, and needs free accounts on [GitHub](https://github.com/signup), [Convex](https://dashboard.convex.dev) and Twitch.

### 1. Convex

1. Sign in to the [Convex dashboard](https://dashboard.convex.dev) and create a project. Name it anything, like `erdtrack`.
2. Switch to the project's **Production** deployment, open its **Settings**, and click **Generate Production Deploy Key**. Copy the key. It's needed in the next step, and it's shown only once.

### 2. GitHub

1. On this repository's page, click **Fork**, then **Create fork**.
2. In your fork, open the **Actions** tab and click **I understand my workflows, go ahead and enable them**.
3. Open **Settings → Secrets and variables → Actions** and click **New repository secret**. Name it `CONVEX_DEPLOY_KEY` and paste the key.
4. Open **Actions → Set up**, click **Run workflow**, enter the Streamer's Twitch login, and click **Run workflow**.

When it's finished (about 2 minutes), open the run. Its summary lists your Panel's address and the **Twitch OAuth redirect URL**. Signing in won't work yet: Twitch comes next.

### 3. Twitch

1. Go to the [Twitch developer console](https://dev.twitch.tv/console/apps) and sign in. Twitch asks for two-factor authentication to be on first.
2. Click **Register Your Application**:
   - **Name**: anything not already taken, like `Erdtrack for <channel>`.
   - **OAuth Redirect URLs**: the redirect URL from the Set up run's summary.
   - **Category**: Website Integration.
   - **Client Type**: Confidential.
3. Click **Create**, then **Manage** beside the new application. Copy its **Client ID**, click **New Secret**, and copy the secret.
4. Back in your fork's **Settings → Secrets and variables → Actions**, add two more secrets: `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
5. Run **Actions → Set up** again with the same login.

That's it. Open the Panel's address, sign in with Twitch as the Streamer, and follow the [first-time setup](../README.md#first-time-setup-for-the-streamer).

### Getting updates

On your fork's page, click **Sync fork**, then **Update branch**. That deploys the new version. Your data and settings stay as they are.

### Changing a setting

- **The Streamer**: run **Set up** with the new login.
- **The Twitch application**: change the two secrets and run **Set up** again.

Running Set up again never signs anyone out.

## Watched mode: the App

The App is optional. Without it the channel is Manual, and Mods record every Death by hand. With it, the channel is Watched: the App reads the save on the Streamer's PC and records Deaths and beaten bosses itself. The [README](../README.md#watched-mode) says what changes for Mods.

The App is Windows only. Every self-hosted copy uses the same App, released from [ohnoitsmaki/erdtrack](https://github.com/ohnoitsmaki/erdtrack/releases). Nothing about a deployment is built in, so a fork never needs its own, but it can [build one itself](#or-build-it-yourself). It reads the save only while `eldenring.exe` is running, and only by listing process names: it never touches the game's process, so it gives Easy Anti-Cheat nothing to act on.

### 1. Download and check it

1. On the [releases page](https://github.com/ohnoitsmaki/erdtrack/releases), download `Erdtrack-<version>-windows.zip` from the latest release.
2. Check that GitHub built it from this repository. Each release's zip and the `erdtrack.exe` in it have a GitHub build attestation. With the [GitHub CLI](https://cli.github.com) installed and signed in (`gh auth login`), run:

   ```sh
   gh attestation verify Erdtrack-<version>-windows.zip --repo ohnoitsmaki/erdtrack
   ```

   It should say `✓ Verification succeeded!`. If it doesn't, don't run the App. Once it's unzipped, `erdtrack.exe` can be checked the same way.
3. Unzip it somewhere you can write to, such as Documents or Desktop, not Program Files. The App keeps everything in its own folder, its settings included, and won't start from one it can't write to.

The exe isn't code-signed, so the first time it's run Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**.

### Or build it yourself

To run an App built from your own fork rather than a release, build it in your fork's Actions. It's the same build as a release's, and it's free on a public fork.

1. In your fork, open **Actions → Build App**, click **Run workflow**, and click **Run workflow** again. Sync the fork first to build the latest version.
2. When it's finished (about 5 minutes), open the run, and under **Artifacts** download **Erdtrack-<version>-windows**. It's a zip holding `erdtrack.exe`.
3. Check that your fork built it:

   ```sh
   gh attestation verify erdtrack.exe --repo <you>/erdtrack
   ```

4. Make a folder named `Erdtrack` somewhere you can write to, as above, and put `erdtrack.exe` in it.

To update an App you built, run **Build App** again after syncing the fork, and replace `erdtrack.exe` in its folder.

### 2. Create the Watcher token

1. Sign in to the Panel as the Streamer, and open **Settings**. Only the Streamer sees the **Watcher** card.
2. Click **Create Watcher token**. The Panel shows its address and the token, each with a button to copy it.

The token is shown only this once. If it's lost, click **Replace token** to make a new one, which stops the old one working. Anyone with the token can report Deaths to the channel, so keep it as you would a password, and never show it on stream.

### 3. Connect the App

1. Run `erdtrack.exe`.
2. Paste the **Panel address**, like `https://happy-otter-123.convex.site`, and the **Watcher token**, and click **Save**.
3. Start Elden Ring and load a character. Once the game saves, the App shows the character, its slot, its Save Total and how many bosses it has beaten, and "Connected. The Panel accepted the last report.". The Panel's sidebar shows **Watcher Online** and the character being played.

If the character has no Run yet, the sidebar offers **Create X's Run**. Nothing is recorded for it until a Mod creates one. The first report for a character brings in the Deaths already in its save, in Overworld and outside the Stream's counts, and marks every boss it has beaten Defeated.

What the App's window can say:

| It says | What to do |
| --- | --- |
| Elden Ring is running, but no save was found yet. | Load a character. The save is looked for in `%APPDATA%\EldenRing`. |
| Elden Ring is running. Waiting for it to save, to see which character you're playing. | Play on: the game saves often, such as at a grace. |
| Elden Ring is running, but the save can't be read. A game update may have changed it, so Erdtrack needs an update too. | Wait for a release of the App that reads it, and record Deaths by hand meanwhile. |
| The Panel refused the Watcher token. Create a new one in the Panel's Settings and paste it here. | The token was replaced or revoked. Create a new one and paste it in. |
| Couldn't reach the Panel at this address. | Check the address, and that the PC is online. |
| The Panel refused the report. This App may need an update. | Download the latest release. |

Once the game closes, the Watcher stops reading, and the Panel shows it Offline after 90 seconds.

### Updating the App

Close the App, then download the latest release and check it as above. The zip holds an `Erdtrack` folder: extract it to the folder that holds the old `Erdtrack` folder, and replace the files. Its `settings.json` stays, so the App keeps the address and the token. Or extract it anywhere and paste them in again.

### Going back to Manual

Under **Settings → Watcher**, click **Revoke token**. The App's reports are refused from then on, the channel is Manual, and the counts stay as they are. To remove the App, delete its folder: that removes its settings too. To be Watched again, create a new token and paste it into the App.

## Development

```sh
pnpm install
pnpm dev          # Convex dev deployment, writes .env.local
pnpm dev:panel    # the Panel on http://localhost:5173, signing in against the dev deployment
```

The dev server passes `/api/auth` through to the dev deployment, so auth is on the Panel's origin, as in production. Auth trusts only the Convex site unless `SITE_URL` says otherwise, so the dev deployment's must be `http://localhost:5173`, and the dev Twitch application's OAuth redirect URL is `http://localhost:5173/api/auth/oauth2/callback/twitch`:

```sh
npx convex env set SITE_URL http://localhost:5173
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set TWITCH_CLIENT_ID <client id>
npx convex env set TWITCH_CLIENT_SECRET <client secret>
npx convex env set OWNER_TWITCH_LOGIN <your Twitch login>
```

Tests:

```sh
pnpm test         # backend, Panel and the App's window (vitest)
pnpm typecheck
pnpm build:app && cargo test --manifest-path src-tauri/Cargo.toml   # the App's Watcher
```

The App is Windows only. `pnpm tauri dev` runs it, and `pnpm tauri build --no-bundle` builds `src-tauri/target/release/erdtrack.exe`. Elsewhere it builds for development, and behaves as if Elden Ring were always running. It's tested by `.github/workflows/app.yml` when it changes, and a `v*` tag matching its version in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` releases it with `.github/workflows/release.yml`, which forks skip. Anyone can build it from **Actions → Build App** (`.github/workflows/build.yml`), which publishes nothing.

## How a deploy works

A push to `main` runs `.github/workflows/ci.yml`. Once its `test` job passes, it deploys with `.github/workflows/deploy.yml`, as Set up (`.github/workflows/setup.yml`) does after it writes the settings. The deploy:

1. Runs `static-hosting deploy --build-command 'pnpm build'`. It builds the Panel against production's `VITE_CONVEX_URL`, deploys the Convex functions to production, then uploads `dist` to the static-hosting component. Convex sends the Panel's CSP and other headers itself (`convex/http.ts`).
2. Runs `npx convex run tags:makeGravityTags`, which makes the Gravity Tag for any channel made before Tags. It changes nothing once every channel has one.
3. Prints the Panel's and the Overlay's addresses in the run's summary.

The functions go before the upload, so a new Panel never calls functions that don't exist yet. A failing test deploys nothing, pull requests never deploy, and one deploy waits for another to finish.

The deploy key decides where it all goes. The Convex settings it uses are:

| Setting | Set by |
| --- | --- |
| `OWNER_TWITCH_LOGIN` | Set up, from the login it's given |
| `BETTER_AUTH_SECRET` | Set up, made once |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Set up, from the repository's secrets |
| `SITE_URL` | Not needed in production, where the Convex site is the Panel's address |

To protect production, create an environment named `production` under **Settings → Environments** and limit its deployment branches to `main`. The secrets can go on it rather than on the repository.

### Roll back

Revert the bad commit on `main` and push. That redeploys Convex and then the Panel, so the two stay in step.
