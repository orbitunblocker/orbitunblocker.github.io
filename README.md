# Orbit

Orbit is a customizable web hub with a games library, a single-view proxy browser, local settings, themes, audio controls, and an Ultraviolet-based rewriting proxy backend.

**Official Website:** https://orbitmath.up.railway.app  
**Repository:** https://github.com/orbitunblocker/orbitunblocker.github.io

## Overview

Orbit is built as a browser-based launchpad. The frontend is plain HTML, CSS, and JavaScript, while the local/production server is a Node.js Express app that also hosts the Bare server required by the Ultraviolet proxy stack.

The repository name includes `.github.io`, but the full Orbit application is not a static-only GitHub Pages app. The integrated proxy browser depends on a Node.js backend, a service worker, Bare-Mux, and `@tomphttp/bare-server-node`.

## Features

### Home And Navigation

- Animated Orbit home screen with a central search bar.
- Bottom dock navigation for Home, Games, Apps, Tools, Browser, Settings, and Info.
- First-run onboarding for username, theme, and audio preference setup.
- Local settings persistence through `localStorage`.

### Games

- A populated games library defined in `js/app.js`.
- Searchable game grid.
- Dedicated embedded game player with refresh, back, fullscreen, and external-open controls.
- Compatibility detection helper for some WebAssembly/Emscripten/Unity-style game pages via `js/game-compat.js` and `/game-probe`.

### Browser

- Single persistent browser view rendered by `js/browser-engine.js`.
- Address/search bar with URL detection and search routing.
- Search engine choices: DuckDuckGo, Brave Search, and Bing.
- Back, forward, refresh, home, bookmark, and menu controls.
- Bookmark storage in `localStorage`.
- Browser settings for search engine, bookmark bar behavior, and notification preferences.

Orbit's current browser UI is a single-view iframe model. It is not a true multi-tab browser.

### Customization And Settings

- Accent themes: Snow, Sunset, Grape, Dracula, Ocean, Forest, Lavender, Amber, and Rose.
- Theme-aware particle background with density controls.
- Background orb and glow controls.
- Smooth scrolling, reduced motion, high contrast, and compact-card settings.
- Background music presets, custom music URL input, music volume, sound effects, and sound effect volume.
- Tab-cloaking title/favicon options, optional site password, auto-lock controls, and launch behavior settings.

### Info, Apps, And Tools Sections

- Orbit includes an Info page and navigation entries for Apps and Tools.
- In the current code, `apps` and `tools` are empty data sets, so the README does not describe them as populated catalogs.

## Technology

- HTML, CSS, and vanilla JavaScript
- Node.js and Express
- Service Workers and SharedWorkers
- Ultraviolet `v3.2.8` assets in `uv/`
- Bare-Mux client runtime bundled in the UV client assets
- `@tomphttp/bare-server-node`
- Playwright dependency used by repository test/diagnostic scripts

No frontend framework such as React, Vue, or Next.js is used by the active app.

## Architecture

At a high level, Orbit's active proxy browser works like this:

1. The browser UI in `js/browser-engine.js` normalizes user input as either a URL or search query.
2. `window.encodeUVUrl()` in `js/app.js` encodes remote URLs into Orbit's `/service/` route.
3. `sw.js` intercepts `/service/` requests and delegates rewriting/fetching to Ultraviolet.
4. Ultraviolet rewrites HTML, CSS, JavaScript, and resource URLs so the remote page can run under Orbit's origin.
5. Bare-Mux requests a validated `MessagePort` from the page-owned `ProxyTransport` in `js/app.js`.
6. `ProxyTransport` creates and validates a `SharedWorker` running `uv/bare-mux-worker.js`.
7. `uv/bare-mux-worker.js` forwards Bare protocol fetches to `/bare/v1/`.
8. `server.js` routes `/bare/` traffic to `@tomphttp/bare-server-node`, which performs the upstream network request.

The current transport includes a readiness/reconnect path for Bare-Mux ports. The custom worker keeps response bodies streaming when possible and buffers request bodies before forwarding non-GET requests to the Bare server.

## Project Structure

```text
Orbit/
├── server.js                     # Express app, Bare server routing, local compatibility endpoints
├── package.json                  # Node scripts and dependencies
├── package-lock.json             # Locked dependency versions
├── index.html                    # Main Orbit document and script/style entry point
├── sw.js                         # Orbit service worker wrapper around Ultraviolet
├── css/
│   ├── orbit.css                 # Active application stylesheet
│   └── styles.css                # Older stylesheet retained in the repository, not loaded by index.html
├── js/
│   ├── app.js                    # Main app, settings, sections, particles, onboarding, UV boot logic
│   ├── browser-engine.js         # Single-view browser UI, search, history, bookmarks, proxy routing
│   ├── game-compat.js            # Game compatibility probing helper
│   └── proxy-engine.js           # Separate experimental/legacy proxy engine, not loaded by index.html
├── uv/
│   ├── uv.bundle.js              # Ultraviolet runtime bundle
│   ├── uv.client.js              # UV client/Bare-Mux runtime
│   ├── uv.config.js              # UV config, `/service/` prefix, navigation bridge, import rewrite hook
│   ├── uv.handler.js             # UV rewrite handler
│   ├── uv.sw.js                  # UV service worker implementation
│   └── bare-mux-worker.js        # Custom Bare-Mux SharedWorker transport
├── public/assets/                # First-party image asset files currently present in the repo
├── icons/                        # UI icon assets
└── docs/                         # Proxy compatibility notes
```

The repository also contains many root-level diagnostic and trace scripts from proxy/game compatibility work. They are not part of the main runtime entry path.

## Running Locally

Prerequisite: Node.js 18 or newer. The locked Bare server dependency declares Node `>=18.0.0`.

```bash
npm install
npm start
```

Then open:

```text
http://localhost:8080
```

`server.js` uses `process.env.PORT` when provided and defaults to `8080` locally.

Do not open `index.html` directly from the filesystem. The app explicitly blocks `file://` execution because the service worker and proxy stack require an HTTP origin.

## Deployment

The official public Orbit deployment is:

```text
https://orbitmath.up.railway.app
```

The server reads the deployment port from `PORT`, and `package.json` starts the app with `node server.js`. A Node-compatible host must serve both the frontend files and the Bare server route for the proxy browser to work.

Static hosting can serve some frontend files, but it cannot provide full Orbit proxy functionality by itself because `/bare/`, service-worker scope headers, and server-side game probing are implemented in `server.js`.

## Proxy Compatibility And Limitations

Orbit uses a rewriting proxy. Compatibility varies by website and by the browser APIs a site requires.

Some sites may fail or partially load because of:

- CAPTCHA or anti-bot verification
- DRM or protected media systems
- authentication flows that reject rewritten/proxied origins
- browser APIs that cannot be faithfully emulated through a rewriting proxy
- upstream blocks, rate limits, or network restrictions
- site code that intentionally detects or rejects proxy traffic

Orbit should not be treated as a privacy, anonymity, or security service. The repository does not establish claims such as anonymous browsing, guaranteed compatibility, or universal site access.

For lower-level proxy test notes, see `docs/proxy-compatibility-matrix.md`.

## FAQ

### What is Orbit?

Orbit is a web hub for launching games, using a single-view proxy browser, and customizing the interface with local settings, themes, particles, and audio options.

### What is the official Orbit website?

The official public website is https://orbitmath.up.railway.app.

### Is the GitHub Pages URL the official website?

No. The repository name contains `.github.io`, but the current full app requires a Node.js backend. The official public site is the Railway deployment listed above.

### Why does Orbit need a Node.js backend?

The proxy browser relies on the Bare server route mounted by `server.js`. Without the backend, the frontend cannot provide the full Ultraviolet/Bare-Mux proxy path.

### Can I run Orbit locally?

Yes. Install dependencies with `npm install`, start the server with `npm start`, and open `http://localhost:8080`.

### Does every website work through Orbit?

No. Rewriting proxies have compatibility limits. Some websites use verification systems, DRM, protected media, advanced browser APIs, or anti-proxy checks that may not work through Orbit.

### Does Orbit include games?

Yes. The current `js/app.js` includes a populated games library and an embedded game player. The Apps and Tools data sets are currently empty.

### Are settings saved?

Yes. Main Orbit settings are saved under `voltra-settings-v1`, browser preferences under `orbit-browser-settings`, bookmarks under `voltra-bookmarks`, browser history under `voltra-browser-history`, and the selected browser search engine under `orbit_search_engine`.

### Can Orbit be customized?

Yes. Current settings include accent themes, particles, particle density, glow, background orbs, smooth scrolling, reduced motion, high contrast, compact cards, audio options, cloaking options, username, password lock, and launch behavior controls.

### Why might a game or site fail to load?

The target may block embedding or proxy traffic, require unsupported browser features, depend on external assets that fail, or reject the rewritten origin. For games, Orbit includes a compatibility probe, but it cannot guarantee every external game URL will remain available.

## Contributing Notes

- Keep README claims tied to current code, not planned features.
- Avoid documenting temporary trace scripts as product features.
- Do not add claims of universal access, anonymity, or security unless the code and deployment actually support them.
- If changing proxy behavior, update `docs/proxy-compatibility-matrix.md` with durable capability-level notes rather than short-lived site-specific results.

## License

No explicit open-source license file is present in this repository at the time of this update. Unless a license is added by the project owner, the code should be treated as all rights reserved.
