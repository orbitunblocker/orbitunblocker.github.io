# Asset Status

This file records the current repository asset state. It is not a completed migration report.

## Current First-Party Assets

The repository contains first-party image assets under `public/assets/`:

```text
public/assets/images/backgrounds/
public/assets/images/games/
public/assets/images/icons/
public/assets/images/logos/
public/assets/images/quicklinks/
public/assets/images/themes/
```

It also contains additional UI icon files under `icons/`.

## Current Runtime Behavior

The current application still references a mix of first-party and external assets:

- `index.html` includes the main active stylesheet `css/orbit.css` and still references external font stylesheets.
- `index.html` still includes external logo/favicon image URLs in some places.
- `js/app.js` defines many game thumbnails and service icons directly, including external URLs, inline data URLs, and local constants.
- `js/browser-engine.js` defines browser-home quick-link images and browser/search icons, including external URLs.
- Bookmark favicons are generated dynamically with Google's favicon service for arbitrary bookmarked domains.

Because of this, do not claim that all Orbit runtime image assets have been migrated to first-party hosting unless the source code is updated to match.

## Notes For Future Asset Work

- New stable images can be placed under `public/assets/images/<category>/` and referenced with `/public/assets/images/...` or another path that matches the current server/static-file layout.
- `server.js` currently serves the repository root with `express.static(__dirname)`, so files in `public/` are served as ordinary static files.
- If long-lived cache headers or immutable asset caching are added later, document the exact server behavior in this file at that time.
- Dynamic third-party assets, such as bookmark favicons for arbitrary domains, cannot be fully replaced by a fixed static file set.
