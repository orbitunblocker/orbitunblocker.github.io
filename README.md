# Orbit

A fresh black Meta Quest-inspired browser hub for games, proxy tools, utilities, and web apps.

## Features

- Hero home with real-time clock, notification center, global search
- Built-in web browser with tabs, history, navigation controls
- Games, tools, settings, and info pages
- Ultraviolet proxy integration for unrestricted browsing
- Custom accent themes, background music, particle effects

## Run locally

### With Ultraviolet proxy (recommended)

```bash
npm install
npm start
```

Then visit `http://localhost:8080`.

### Static-only (no proxy)

Open `index.html` in a browser or use any static server:

```bash
python -m http.server 8080
```

## Architecture

```
orbit/
├── server.js          # Node.js backend (Express + bare server)
├── package.json
├── index.html         # Orbit UI markup
├── css/
│   ├── orbit.css      # Orbit styles
│   └── styles.css     # Legacy styles
├── js/
│   ├── app.js         # Orbit app logic + UV init
│   ├── browser-engine.js  # Browser chrome (tabs, nav, address bar)
│   └── proxy-engine.js    # Legacy proxy (disconnected, removable)
└── uv/
    ├── uv.config.js   # Ultraviolet configuration
    ├── uv.bundle.js   # Core Ultraviolet class
    ├── uv.sw.js       # Service worker (intercepts /service/*)
    ├── uv.client.js   # Client-side bare-mux transport
    └── uv.handler.js  # HTML/CSS/JS rewrite engine
```

### UV proxy flow

1. User enters URL → `encodeUVUrl()` produces `/service/<xor-encoded-url>`
2. Browser sets `iframe.src` to that path
3. Service worker intercepts, decodes the URL
4. SW fetches the real page through the bare server (`/bare/`)
5. SW rewrites HTML/CSS/JS so content is same-origin
6. Iframe renders the proxied content without X-Frame-Options errors

## Deployment

### Option 1: VPS (DigitalOcean, Linode, Hetzner)

```bash
git clone <repo> orbit
cd orbit
npm install
npm start
```

Run behind nginx with PM2 for process management:

```bash
npm install -g pm2
pm2 start server.js --name orbit
pm2 save
```

### Option 2: Railway / Render

1. Push to GitHub
2. Connect repo on Railway or Render
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Set `PORT` environment variable (auto-assigned by platform)

### Option 3: Replit

1. Create a new Node.js repl
2. Import from GitHub or copy files
3. Set run command: `node server.js`
4. Replit auto-assigns a URL

### Static-only hosting (no proxy)

Deploy the root folder to any static host (GitHub Pages, Cloudflare Pages, Netlify).
The browser will work but UV proxy features won't be available without a bare server backend.

## License

All rights reserved by the project owner unless otherwise noted.
