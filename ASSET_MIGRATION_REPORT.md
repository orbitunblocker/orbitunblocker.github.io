# Asset Migration Report

## Overview
All external image assets used by Orbit have been migrated from third-party hosts to first-party hosting on the Orbit domain. 80 images were downloaded and are now served directly from the Orbit server.

## Final URL Structure
```
/assets/images/logos/        — Orbit logo/favicon (1 file)
/assets/images/games/        — Game thumbnail images (50 files)
/assets/images/themes/       — Theme preview images (9 files)
/assets/images/icons/        — Search engine & service icons (9 files)
/assets/images/quicklinks/   — Quick-link cards for browser home page (10 files)
/assets/audio/               — Audio files (empty, ready for future use)
/assets/fonts/               — Font files (empty, ready for future use)
/assets/videos/              — Video files (empty, ready for future use)
```

## Files Modified

| File | Changes |
|------|---------|
| `server.js` | Added `express.static('public/')` middleware with `Cache-Control: public, max-age=31536000, immutable` for all assets under `public/assets/` |
| `index.html` | 5 logo GIF references changed from `https://i.ibb.co/...` to `/assets/images/logos/...` |
| `js/browser-engine.js` | 4 search engine favicons + 10 quick-link images + 1 replaced URL changed from external URLs to `/assets/images/icons/...` and `/assets/images/quicklinks/...` |
| `js/app.js` | 50 game thumbnails + 9 theme previews + 4 service icons + 1 placeholder changed from external URLs to `/assets/images/games/...`, `/assets/images/themes/...`, `/assets/images/icons/...` |

## URLs Changed (all external → local)

### Logo (1 URL, 5 instances in index.html)
- `https://i.ibb.co/xS3pNYjB/tet-ezgif-com-effects-1.gif` → `/assets/images/logos/tet-ezgif-com-effects-1.gif`

### Search Engine Icons (4 URLs in browser-engine.js)
- `https://t3.gstatic.com/faviconV2?...` → `/assets/images/icons/google-favicon.png`
- `https://www.bing.com/favicon.ico` → `/assets/images/icons/bing.ico`
- `https://duckduckgo.com/favicon.ico` → `/assets/images/icons/duckduckgo.ico`
- `https://4get.ca/favicon.ico` → `/assets/images/icons/4get.ico`

### Quick-Link Images (10 URLs in browser-engine.js)
- YouTube, Twitch, SoundCloud, Spotify, ChatGPT, Discord, GitHub, TikTok, Netflix, ESPN → `/assets/images/quicklinks/...`

### Game Thumbnails (50 URLs in app.js)
All from outred.org, blog.free-dyndns.org, crazygames.com, coolmathgames.com, polygonimages.com, imangistudios.com, nintendo.com, amazon.com, gstatic encrypted, medium.com, steamstatic.com, gamebrew.org → `/assets/images/games/...`

### Theme Previews (9 URLs in app.js)
All from i.ibb.co → `/assets/images/themes/...` (snow, sunset, grape, dracula, ocean, forest, lavender, amber, rose)

### Service/Cloak Icons (4 URLs in app.js)
- Google, Classroom, Google Drive, Google Docs favicons → `/assets/images/icons/...`

### Placeholder URL (1 URL in app.js)
- `https://example.com/favicon.ico` → `/assets/images/icons/google.ico`

## Exceptions (Not Migrated)
1. **Bookmark favicons** (`js/browser-engine.js:1441`): `https://www.google.com/s2/favicons?domain=${hostname}&sz=16` — This is a dynamic service URL that generates favicons for arbitrary user-bookmarked domains. Cannot be replaced with a static asset. If desired, Orbit could proxy this through its own server.

2. **Google Fonts** (`index.html:12`): External font CSS URL. Not in scope for image migration but could be self-hosted in the future.

3. **Audio files** (`files.catbox.moe`): Background music MP3s and hover sounds. Not in scope for this migration but `public/assets/audio/` directory is ready.

## Future-Proofing
- **Adding new images**: Create the file under `public/assets/images/<category>/` and reference as `/assets/images/<category>/<filename>` in HTML/CSS/JS.
- **Replacing existing images**: Overwrite the file with the same name; the 1-year immutable cache means you should use a new filename or a version query parameter for immediate updates.
- **No server changes needed**: The `express.static('public/')` middleware auto-serves any file in the `public/` directory.

## Cache Strategy
Assets in `public/assets/` are served with:
- `Cache-Control: public, max-age=31536000, immutable`
- 1-year browser cache, immutable flag prevents revalidation
- To force update after file change: rename the file or append `?v=<version>` to the URL

## Total Assets: 80 files (~7.6 MB)
- logos/: 1 file (563 KB)
- games/: 50 files (5.1 MB)
- themes/: 9 files (457 KB)
- icons/: 9 files (54 KB)
- quicklinks/: 10 files (191 KB)
- audio/: ready for future use
- fonts/: ready for future use
- videos/: ready for future use
