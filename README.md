# Orbit

A fresh black Meta Quest-inspired browser hub for games, proxy tools, utilities, and web apps — powered by the current Voltra functions, but with a completely new Orbit interface.

## Features

- Hero home with global search across Games, Proxies, Tools, and Info
- Section grids with optional per-section search
- Cookie Clicker embedded player with fullscreen and new-tab actions
- Settings: audio, accent themes, glow, particles, motion, contrast, compact cards
- Ambient particle canvas, intro screen, and hover sound effects

## Run locally

No build step required. Open `index.html` in a browser, or serve the folder with any static server:

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .
```

Then visit `http://localhost:8080` (or the port shown).

## Project structure

```
orbit/
├── index.html      # Page markup
├── css/
│   └── orbit.css   # Quest-inspired Orbit styles
├── js/
│   └── app.js      # Voltra app logic
└── README.md
```

## GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source**: Deploy from branch.
3. Branch: `main`, folder: `/ (root)`.
4. Save. The site will be at `https://<username>.github.io/<repo>/`.

## License

All rights reserved by the project owner unless otherwise noted.
