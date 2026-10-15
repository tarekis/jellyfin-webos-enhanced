# Jellyfin + Seerr for webOS

A fork of [jellyfin-webos](https://github.com/jellyfin/jellyfin-webos) that adds **Seerr search and requests** to the Jellyfin web UI on LG TVs, including old ones (webOS 3.x / Chromium 38).

It installs **next to** the official app (`org.jellyfin.webos`) as `org.himmer.jellyfin.seerr`, titled "Jellyfin + Seerr". Everything else (server selection, playback, the device profile) is the upstream app unchanged.

## Why the official app shows no Seerr results

The [Jellyfin Enhanced](https://github.com/n00bcodr/Jellyfin-Enhanced) plugin injects a `<script>` tag into the server's `web/index.html`. The webOS app loads that page, so the TV does fetch the plugin script. The script is modern JavaScript (arrow functions, `async`/`await`, spread, optional chaining). webOS 3.x runs **Chromium 38, which only parses ES5**. The plugin script fails with a `SyntaxError` before it runs, so no Seerr UI ever appears. webOS 4.x (Chromium 53) and 5.x (Chromium 68) also lack parts of that syntax.

Transpiling the whole plugin frontend, about 100 files loaded at runtime from the server, would be brittle. So this app ships its own small ES5 overlay. It uses the plugin's **server-side** endpoints, which work for any client:

| Action | Endpoint (on the Jellyfin server) |
| --- | --- |
| Search | `GET /JellyfinEnhanced/jellyseerr/search?query=…` |
| Request | `POST /JellyfinEnhanced/jellyseerr/request` with `{mediaType, mediaId, seasons: "all"}` |

Both calls carry the signed-in Jellyfin user's own access token. The plugin maps that Jellyfin user to the linked Seerr user and makes the request **as that user**. Seerr permissions, quotas and auto-approval all apply. No Seerr URL, API key or password is in this app.

## Using it on the TV

- **Search page:** search as usual. After a moment, a purple bar appears below the search field, e.g. *"3 titles not in your library — request on Seerr"*. Move to it and press **OK**.
- **Anywhere:** press the **green** button on the remote to open the Seerr search. On the search page, it's prefilled with your current query.
- In the overlay: **arrows** move, **OK** opens a title, **OK** on *Request* sends the request, **Back** closes the dialog or the overlay. A green toast confirms the request; red means it failed, with the reason.
- Badges show the Seerr state: *Not in library*, *Requested*, *Downloading*, *Partly in library*, *In library*.

Posters load from `image.tmdb.org`, like the plugin and Seerr itself do. Nothing else leaves your LAN.

### Server requirements

- Jellyfin with the Jellyfin Enhanced plugin, Seerr integration enabled and working (it works in a desktop browser).
- The Jellyfin user is imported/linked in Seerr and has the Request permission.

## Install with webOS Dev Manager (Windows)

1. Build the IPK (see below) or download `org.himmer.jellyfin.seerr_<version>_all.ipk` from the releases.
2. Open **webOS Dev Manager** and select your TV.
3. Go to **Apps** → **Install** (the "+" / install-from-file button) and choose the `.ipk`.
4. On the TV, open **Jellyfin + Seerr** from the launcher. Enter the server URL, e.g. `http://192.168.178.20:8096`, then **Connect** and sign in. The URL is stored in the app's local storage like the upstream app does; nothing is hard-coded.

**Updating:** build or download the new IPK and install it the same way. Dev Manager replaces the existing app and keeps its stored settings.

**Developer Mode only (no root):** the Dev Mode session expires (normally after 1000 hours on current Developer Mode apps; older ones after 50 hours), and dev-installed apps then disappear. Extend the session in the Developer Mode app or via Dev Manager. A rooted TV with Homebrew Channel doesn't have this limit.

## Debugging on the TV

The app is inspectable while the TV is in Developer Mode (or rooted with Homebrew Channel):

```sh
ares-inspect -d tv --app org.himmer.jellyfin.seerr
```

Or open `http://<TV_IP>:9998` in a browser. On webOS 3.x, modern Chrome's DevTools often fail to render. Use a Chrome 38 build (links on [webosbrew: Inspecting a Web App](https://www.webosbrew.org/develop/guides/web-app/inspecting)), or add `<TV_IP>:9998` as a remote target in `chrome://inspect`. The Jellyfin UI runs in the `contentFrame` iframe; the overlay logs lines prefixed with `[Seerr]`.

## Testing in a desktop browser

```sh
npm run snippet   # writes build/seerr-devtools-snippet.js
```

Open `http://192.168.178.20:8096` in Chrome or Firefox and sign in. Paste the file's contents into the DevTools console. Then use the search page, or run `SeerrOverlay.open("dune")`. Arrows, Enter and Escape act like the remote's keys. The overlay only reads the page's `ApiClient`, so it works the same as on the TV. Note that in a desktop browser the plugin's own Seerr UI shows up as well.

Automated tests (Playwright, mocked Jellyfin and plugin endpoints):

```sh
npm install
npm test
```

## Build

```sh
npm install
npm run package          # -> build/org.himmer.jellyfin.seerr_<version>_all.ipk
```

What's changed versus upstream:

- `frontend/js/seerr.js`, `frontend/css/seerr.css`: the overlay, injected into the Jellyfin web UI frame by `frontend/js/index.js` (same mechanism upstream uses for `webOS.js`).
- App id, title and service id renamed so it installs side by side with the official app.

## License

MPL-2.0, like upstream; see `LICENSE`. Some parts incorporate content under the Apache 2.0 license. All images are taken from and licensed under the same license as https://github.com/jellyfin/jellyfin-ux. Modified and new source files carry the MPL-2.0 header. This is an unofficial fork, not affiliated with the Jellyfin project.

---

## Development

The general development workflow looks like this:

- Prepare a build environment of your choice (see below)
- Compile an IPK either with the IDE or with ares-package
- Test the app on the emulator or ares-server or install it on your tv by following http://webostv.developer.lge.com/develop/app-test/

There are three ways to create the required build environment:

- Full WebOS SDK Installation
- Docker
- NPM ares-cli

### Full WebOS SDK Installation

- Install the WebOS SDK from http://webostv.developer.lge.com/sdk/installation/

### Docker

A prebuilt docker image is available that includes the build and deployment dependencies, see [Docker Hub](https://ghcr.io/oddstr13/docker-tizen-webos-sdk).

### Managing the ares-tools via npm

This requires `npm`, the Node.js package manager.

Execute the following to install the required WebOS toolkit for building & deployment:

`npm install`

Now you can package the app by running:

`npm run package`

## Building with Docker or WebOS SDK

`dev.sh` is a wrapper around the Docker commands. If you have installed the SDK directly, just omit that part.

```sh
# Build the package via Docker
./dev.sh ares-package --no-minify services frontend
# Build the package with natively installed WebOS SDK
ares-package --no-minify services frontend
```

## Usage
Fill in your hostname, port, and schema and click connect. The app will check for a server by grabbing the manifest and the public serverinfo.
Afterwards, the app hands off control to the hosted webUI.


## Testing
Testing on a TV requires [registering a LG developer account](https://webostv.developer.lge.com/develop/app-test/preparing-account/) and [setting up the devmode app](https://webostv.developer.lge.com/develop/app-test/using-devmode-app/).

Once you have installed the devmode app on your target TV and logged in with your LG developer account, you need to turn on the `Dev Mode Status` and `Key Server`.
**Make sure** to take a note of the passphrase.

```sh
# Add your TV. The defaults are fine, but I recommend naming it `tv`.
./dev.sh ares-setup-device --search

# This command sets up the SSH key for the device `tv` (Key Server must be running)
./dev.sh ares-novacom --device tv --getkey

# Run this command to verify that things are working.
./dev.sh ares-device-info -d tv

# This command installs the app. Remember to build it first.
./dev.sh ares-install -d tv org.himmer.jellyfin.seerr_*.ipk

# Launch the app and the web developer console.
./dev.sh ares-inspect -d tv org.himmer.jellyfin.seerr

# Or just launch the app.
./dev.sh ares-launch -d tv org.himmer.jellyfin.seerr
```
