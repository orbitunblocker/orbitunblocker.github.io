# Orbit Proxy Compatibility Matrix

This matrix tracks generic browser capability coverage for Orbit's Ultraviolet/Bare-Mux proxy stack. Avoid domain-specific fixes unless a limitation cannot be solved at the protocol or rewrite layer.

## Request Lifecycle

User navigation -> `js/browser-engine.js` normalization/routing -> `window.encodeUVUrl()` -> `/service/` iframe URL -> `sw.js` fetch interception -> Ultraviolet rewriting -> Bare-Mux `getPort` -> validated `ProxyTransport` SharedWorker port -> `uv/bare-mux-worker.js` -> `/bare/v1/` -> `@tomphttp/bare-server-node` -> upstream -> Bare response headers/body -> worker response -> UV response rewriting -> browser iframe.

## Capability Status

| Area | Current status | Notes |
| --- | --- | --- |
| Startup readiness | Supported | Page-owned `ProxyTransport` validates SharedWorker MessagePorts before UV navigation. |
| GET/HEAD/basic navigation | Supported | Verified with DuckDuckGo, Bing, Pixelsuft/hl initial page. |
| POST/PUT/PATCH/DELETE bodies | Fixed | Controlled second-origin tests pass for JSON, text, URL-encoded, FormData, binary POST, PUT, PATCH, and DELETE bodies. Worker buffers request streams before Bare fetch while preserving stream-first responses. |
| Redirects | Partially supported | Handled by UV/Bare; OAuth/cross-site flows need separate validation. |
| Headers | Partially supported | Bare protocol forwards allowed headers; browser-forbidden headers remain constrained by browser security. |
| Range requests | Supported | Verified `206`, `Content-Range`, and 1024-byte body through UV. |
| Large binary resources | Partially fixed | Worker is stream-first with ArrayBuffer fallback; 10 MB ZIP segment verified byte-correct. |
| Streaming fetch responses | Partially fixed | Transferable streams are attempted first; fallback buffers if unsupported. |
| Media | Partially supported | Range works; YouTube still has upstream/Bare 502 failures on some media/script endpoints. DRM is not supported. |
| WebSockets | Partially supported | Worker forwards ws/wss, but cookies/custom headers/auth behavior needs deeper testing. |
| WASM/Emscripten | Partially supported | Pixelsuft/hl initial scripts/memory load; package/ZIP workflows need full manual runtime test. |
| Workers | Partially supported | UV rewrites worker scripts; remote service worker registration is a fundamental proxy-origin limitation. |
| Blob/data/object URLs | Supported by browser/UV | Must not be routed through `/service/`; watch dynamically generated workers/downloads. |
| File uploads/File APIs | Partially fixed | Controlled multipart/FormData POST reaches upstream with correct body length. Browser local file picker remains native; full user-driven upload flows still need site testing. |
| Downloads | Partially supported | Binary integrity verified for fetch; user-triggered download filenames need manual validation. |
| IndexedDB/storage | Partially supported | UV virtualizes storage per emulated origin; collision testing still required. |
| Cookies/sessions | Partially supported | UV cookie DB handles proxy cookies; HttpOnly remains inaccessible to page JS. Complex auth may be blocked upstream. |
| Modern JS modules | Partially fixed | `rewriteImport(base, specifier)` compatibility fix exists; module-heavy apps still need broad tests. |
| Escaped same-origin `/service/` resources | Partially fixed | `sw.js` repairs GET/HEAD requests where a proxied app accidentally encodes Orbit's own `/service/...` URL as the remote target, resolving it against the decoded remote referrer. |
| CSS/assets/srcset/fonts | Partially supported | UV handles common rewrites; dynamic CSS/JS URL construction remains risk. |
| Compression/cache | Partially supported | Bare/UV mediate decoded/encoded layers; cache validation and 304 behavior need tests. |
| Error classification | Future work | Current logs distinguish proxy transport failures; UI still needs clearer user-facing categories. |

## Required Regression Tests

1. Fresh load, immediately search `hey`; expect `/service/` URL, no invalid MessagePort.
2. Fresh load, immediately navigate `https://roblox.com`; expect queued/ready `/service/` URL.
3. Range fetch through UV for a media/binary resource; expect `206` and correct `Content-Range`.
4. Large binary fetch through UV; verify exact byte length/hash where possible.
5. Pixelsuft/hl `xash.html`; verify initial page, `xash.html.mem`, `xash.js`, and split ZIP package resources.
6. Controlled second-origin non-GET matrix; verify JSON/text/urlencoded/FormData/binary POST, PUT, PATCH, and DELETE body integrity.
7. YouTube; verify shell renders, classify media/script failures, do not bypass DRM or anti-bot systems.
8. ChatGPT; verify initial render and auth/streaming limitations without bypassing controls.
9. Multipart upload to a controlled endpoint; verify filename, MIME type, and byte integrity.
10. WebSocket echo to a controlled endpoint; verify text, binary, close, and reconnect behavior.

## Development Endpoints

Orbit exposes local development-only compatibility endpoints under `/__compat/` and a separate compat origin on `localhost:8092` when the dev server is running:

| Endpoint | Purpose |
| --- | --- |
| `/__compat/echo` | Echo method, content type, content length, transfer encoding, byte count, SHA-256, and preview. |
| `/__compat/range.bin` | 1 MB deterministic binary with `Range`/`206` support. |
| `/__compat/stream` | Short chunked text stream. |
| `/__compat/sse` | Short Server-Sent Events stream. |
| `/__compat/test-page.html` | Loads CSS, image, SVG, classic script, module script, dynamic import, and POST. |

Second-origin endpoints on `localhost:8092` include `/get`, `/post-json`, `/post-text`, `/post-urlencoded`, `/post-formdata`, `/post-binary`, `/put`, `/patch`, `/delete`, `/range.bin`, `/stream`, `/sse`, and `/ws`. Bare access to local/private targets requires `ALLOW_LOCAL_BARE=1` and must remain development-only.

Do not rely on proxied `http://localhost:<port>/__compat/...` as a conclusive Bare test: self-proxying back into the same Orbit server can produce 502s that are not representative of upstream internet resources. These endpoints are still useful for direct server checks and future tests from a separate origin/port.

## Current Failure Groups

| Group | Representative sites | Classification | Notes |
| --- | --- | --- | --- |
| Generic POST/XHR/fetch body failure | Bing `xlsc.aspx`, YouTube telemetry/API, DuckDuckGo telemetry, controlled second-origin endpoints | Fixed for transport | Root cause was browser/Bare instability with transferred `ReadableStream` uploads to `/bare/v1/`. `uv/bare-mux-worker.js` now buffers request streams/Blobs to `ArrayBuffer` and forwards `content-length`; controlled non-GET matrix passes. Site-specific API/auth/media failures still need retesting. |
| Escaped `/service/` dynamic asset URLs | ChatGPT chunk-like script path resolving to `localhost/service/...` | Partially fixed | SW repair added for GET/HEAD resources using decoded remote referrer. Needs more module-heavy validation. |
| Upstream/Bare 502 GET resources | YouTube `googleads.g.doubleclick.net/pagead/id`, some ChatGPT/static generated paths | Partially diagnosed | Separate from DRM/media. Needs Bare metadata capture with updated server process and representative replay. |
| Startup MessagePort failure | First search after fresh load | Fixed | `ProxyTransport` validation still passes regression. |
| Large binary/Range | Pixelsuft split ZIP, GitHub raw MP3 range | Fixed/Partially fixed | 10 MB ZIP and external `206` range verified after this pass. |
