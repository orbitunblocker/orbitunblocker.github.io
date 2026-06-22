/**
 * Voltra Browser Engine v1.0
 * Modular browser-style navigation and search engine
 * 
 * Modules:
 *   - InputParser    : URL detection / search query routing
 *   - HistoryManager : Per-tab back/forward navigation stack
 *   - (tab system removed - single persistent view)
 *   - BrowserUI      : Renders the browser chrome (address bar, nav controls, bookmarks)
 *   - SearchEngine   : Autocomplete suggestions from history & popular sites
 */

(function() {
  'use strict';

  // ==================== Ultraviolet Proxy Integration ====================
  
  // UV is configured in app.js (service worker registration + encode helper).
  // The browser engine uses window.encodeUVUrl() to encode URLs through UV.
  // If UV is unavailable, it falls back to direct iframe loading.
  
  function shouldUseUV(url) {
    return url && !url.startsWith('about:') && url !== 'about:blank';
  }

  window.__UV_ROUTE_DEBUG__ = {
    lastUrl: '',
    lastEncoded: '',
    lastShouldUseUV: false,
    lastFinalSrc: '',
  };

  // ==================== Search Engine Selection ====================

  const SEARCH_ENGINES = {
    google: {
      name: 'Google',
      url: 'https://www.google.com/search?q=',
      icon: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://google.com&size=256'
    },
    brave: {
      name: 'Brave',
      url: 'https://search.brave.com/search?q=',
      icon: 'icons/brave icon.svg'
    },
    bing: {
      name: 'Bing',
      url: 'https://www.bing.com/search?q=',
      icon: 'https://www.bing.com/favicon.ico'
    },
    duckduckgo: {
      name: 'DuckDuckGo',
      url: 'https://duckduckgo.com/?q=',
      icon: 'https://duckduckgo.com/favicon.ico'
    },
    '4get': {
      name: '4get',
      url: 'https://4get.ca/web?q=',
      icon: 'https://4get.ca/favicon.ico'
    }
  };

  let currentSearchEngine = 'brave'; // Default to Brave

  function setSearchEngine(engineKey) {
    if (SEARCH_ENGINES[engineKey]) {
      currentSearchEngine = engineKey;
      localStorage.setItem('orbit_search_engine', engineKey);
    }
  }

  function getSearchEngine() {
    const saved = localStorage.getItem('orbit_search_engine');
    if (saved && SEARCH_ENGINES[saved]) {
      currentSearchEngine = saved;
    }
    return SEARCH_ENGINES[currentSearchEngine];
  }

  function getSearchUrl(query) {
    const engine = getSearchEngine();
    return engine.url + encodeURIComponent(query);
  }

  // ==================== InputParser ====================

  class InputParser {
    /**
     * Parse a user's input and determine if it's a URL or search query.
     * @param {string} input
     * @returns {{ type: string, url: string, query: string }}
     */
    static parse(input) {
      input = input.trim();
      if (!input) return { type: 'empty', url: '', query: '' };

      // Detect if input looks like a URL
      let url = input;

      // If no protocol, try adding https://
      if (!/^https?:\/\//i.test(url)) {
        // Check for common domain patterns
        const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(\/|$|\?|#)/;
        const simpleDomain = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
        
        if (domainPattern.test(url) || simpleDomain.test(url)) {
          url = 'https://' + url;
        } else if (/^(https?:\/\/)?localhost/i.test(url)) {
          url = url.startsWith('http') ? url : 'http://' + url;
        } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(url)) {
          url = 'http://' + url;
        } else {
          // It's a search query
          const query = input;
          const searchUrl = getSearchUrl(query);
          return { type: 'search', url: searchUrl, query };
        }
      }

      // Validate URL structure
      try {
        new URL(url);
        return { type: 'url', url, query: '' };
      } catch (e) {
        // Fallback to search
        const query = input;
        const searchUrl = getSearchUrl(query);
        return { type: 'search', url: searchUrl, query };
      }
    }

  }

  // ==================== HistoryManager ====================

  class HistoryManager {
    constructor() {
      this.stacks = {}; // tabId -> { entries: [], index: -1 }
    }

    _getStack(tabId) {
      if (!this.stacks[tabId]) {
        this.stacks[tabId] = { entries: [], index: -1 };
      }
      return this.stacks[tabId];
    }

    /**
     * Navigate to a new URL in a tab, pushing onto the history stack.
     * @param {string} tabId
     * @param {string} url
     * @param {string} title
     */
    push(tabId, url, title = '') {
      const stack = this._getStack(tabId);
      // Remove any forward entries if we're not at the end
      if (stack.index < stack.entries.length - 1) {
        stack.entries = stack.entries.slice(0, stack.index + 1);
      }
      stack.entries.push({ url, title, timestamp: Date.now() });
      stack.index = stack.entries.length - 1;
      this._persist(tabId);
    }

    /**
     * Go back in history.
     * @param {string} tabId
     * @returns {{ url: string, title: string } | null}
     */
    back(tabId) {
      const stack = this._getStack(tabId);
      if (stack.index > 0) {
        stack.index--;
        this._persist(tabId);
        return stack.entries[stack.index];
      }
      return null;
    }

    /**
     * Go forward in history.
     * @param {string} tabId
     * @returns {{ url: string, title: string } | null}
     */
    forward(tabId) {
      const stack = this._getStack(tabId);
      if (stack.index < stack.entries.length - 1) {
        stack.index++;
        this._persist(tabId);
        return stack.entries[stack.index];
      }
      return null;
    }

    /**
     * Check if back navigation is available.
     * @param {string} tabId
     * @returns {boolean}
     */
    canGoBack(tabId) {
      const stack = this._getStack(tabId);
      return stack.index > 0;
    }

    /**
     * Check if forward navigation is available.
     * @param {string} tabId
     * @returns {boolean}
     */
    canGoForward(tabId) {
      const stack = this._getStack(tabId);
      return stack.index < stack.entries.length - 1;
    }

    /**
     * Get the current URL in the tab (for address bar display).
     * @param {string} tabId
     * @returns {string}
     */
    getCurrentUrl(tabId) {
      const stack = this._getStack(tabId);
      if (stack.index >= 0 && stack.entries[stack.index]) {
        return stack.entries[stack.index].url;
      }
      return '';
    }

    /**
     * Get all history entries for a tab.
     * @param {string} tabId
     * @returns {Array}
     */
    getEntries(tabId) {
      return this._getStack(tabId).entries;
    }

    /**
     * Clear all history.
     */
    clearAll() {
      this.stacks = {};
      try {
        localStorage.removeItem('voltra-browser-history');
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Persist history to localStorage.
     */
    _persist(tabId) {
      try {
        const key = 'voltra-browser-history';
        const allData = JSON.parse(localStorage.getItem(key) || '{}');
        allData[tabId] = this.stacks[tabId];
        localStorage.setItem(key, JSON.stringify(allData));
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Load persisted history from localStorage.
     */
    loadAll() {
      try {
        const key = 'voltra-browser-history';
        const allData = JSON.parse(localStorage.getItem(key) || '{}');
        Object.keys(allData).forEach(tabId => {
          this.stacks[tabId] = allData[tabId];
        });
      } catch (e) {
        // Silently fail
      }
    }

  }



  // ==================== BookmarkManager ====================

  class BookmarkManager {
    constructor() {
      this.STORAGE_KEY = 'voltra-bookmarks';
      this.bookmarks = this._load();
    }

    getAll() {
      return this.bookmarks;
    }

    add(title, url) {
      const existing = this.bookmarks.find(b => b.url === url);
      if (existing) return existing;
      const bookmark = {
        id: 'bm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: title || url,
        url: url,
        order: this.bookmarks.length
      };
      this.bookmarks.push(bookmark);
      this._save();
      return bookmark;
    }

    remove(id) {
      this.bookmarks = this.bookmarks.filter(b => b.id !== id);
      this._save();
    }

    isBookmarked(url) {
      return this.bookmarks.some(b => b.url === url);
    }

    reorder(fromIndex, toIndex) {
      if (fromIndex < 0 || fromIndex >= this.bookmarks.length) return;
      if (toIndex < 0 || toIndex >= this.bookmarks.length) return;
      const [moved] = this.bookmarks.splice(fromIndex, 1);
      this.bookmarks.splice(toIndex, 0, moved);
      this.bookmarks.forEach((b, i) => b.order = i);
      this._save();
    }

    _load() {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    }

    _save() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.bookmarks));
      } catch (e) {
        // Silently fail
      }
    }
  }

  // ==================== BrowserUI ====================

  // ==================== Navigation Helpers ====================
  const SEARCH_PROVIDER_NAME = 'Brave Search';
  const SEARCH_ENGINE_BASE = 'https://search.brave.com/search?q=';
  const BRAVE_HOME_URL = 'https://search.brave.com/';
  const BRAVE_HOME_INTERNAL = 'voltra://brave-home';

  /**
   * Check if a URL is our internal home page marker.
   * @param {string} url
   * @returns {boolean}
   */
  function isBraveHome(url) {
    return url === BRAVE_HOME_INTERNAL || url === '';
  }

  /**
   * Generate the custom Brave Search home page HTML (embedded via srcdoc).
   * This page is self-contained and can be embedded in an iframe.
   * It communicates with the parent browser via window.parent.VoltraBrowser.
   */
  function getBraveHomeSrcDoc() {
    return `<!DOCTYPE html>
<html lang="en" style="background:#0c0d10">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Brave Search</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent-a:125,211,252;--accent-b:192,132,252;--hover-ease:cubic-bezier(0.22,1,0.36,1);--hover-glow-duration:.65s;--hover-glow:0 0 0 1px rgba(var(--accent-a),.82),0 0 16px rgba(var(--accent-a),.58),0 0 38px rgba(var(--accent-b),.42),0 0 78px rgba(var(--accent-b),.26)}
body{color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;overflow:hidden}
.wrap{display:flex;flex-direction:column;align-items:center;gap:20px;width:100%;max-width:580px;padding:20px}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.logo svg{width:42px;height:42px}
.logo-text{font-size:1.7rem;font-weight:700;color:#fff;letter-spacing:-0.01em}
.tagline{color:rgba(255,255,255,0.45);font-size:0.9rem;text-align:center}
.search-box{width:100%;display:flex;gap:0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:4px;transition:border-color .45s var(--hover-ease),background .45s var(--hover-ease),box-shadow var(--hover-glow-duration) var(--hover-ease)}
.search-box:hover,.search-box:focus-within{background:rgba(255,255,255,0.08);border-color:rgba(var(--accent-a),.82);box-shadow:var(--hover-glow)}
.search-box input{flex:1;background:0 0;border:none;outline:none;color:#fff;font-size:1rem;padding:12px 18px}
.search-box input::placeholder{color:rgba(255,255,255,0.3)}
.search-box button{background:rgba(255,255,255,0.1);border:none;color:#fff;padding:10px 22px;border-radius:20px;cursor:pointer;font-size:.9rem;font-weight:500;transition:background .45s var(--hover-ease),box-shadow var(--hover-glow-duration) var(--hover-ease)}
.search-box button:hover{background:rgba(255,255,255,0.18);box-shadow:var(--hover-glow)}
.shortcuts{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-top:6px}
.sc{display:flex;flex-direction:column;align-items:center;gap:5px;color:rgba(255,255,255,0.55);font-size:.72rem;cursor:pointer;background:0 0;border:none;padding:8px 10px;border-radius:12px;transition:background .45s var(--hover-ease),color .45s var(--hover-ease),box-shadow var(--hover-glow-duration) var(--hover-ease);font-family:inherit}
.sc:hover{color:#fff;background:rgba(255,255,255,0.06);box-shadow:var(--hover-glow)}
.sc-i{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,0.07);display:flex;align-items:center;justify-content:center;font-size:1rem}
.brave-footer{position:fixed;bottom:16px;color:rgba(255,255,255,0.2);font-size:.7rem}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">
    <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M26.4 5H5.6C3.1 5 1 7.1 1 9.6v12.8C1 24.9 3.1 27 5.6 27h20.8c2.5 0 4.6-2.1 4.6-4.6V9.6C31 7.1 28.9 5 26.4 5z" fill="#FB542B"/><path d="M16.3 8l-5.8 6.5c-.3.3-.3.8 0 1.1l6.5 7.2c.3.3.8.3 1.1 0l6.5-7.2c.3-.3.3-.8 0-1.1L17.4 8c-.3-.3-.8-.3-1.1 0z" fill="#fff"/></svg>
    <span class="logo-text">Brave Search</span>
  </div>
  <p class="tagline">Search the web privately</p>
  <form class="search-box" id="_bsf">
    <input type="text" id="_bsi" placeholder="Search the web..." autocomplete="off" autofocus>
    <button type="submit">Search</button>
  </form>
  <div class="shortcuts">
    <button class="sc" data-url="https://www.google.com"><div class="sc-i">G</div>Google</button>
    <button class="sc" data-url="https://www.youtube.com"><div class="sc-i" style="color:#ff0000">\u25B6</div>YouTube</button>
    <button class="sc" data-url="https://www.wikipedia.org"><div class="sc-i">W</div>Wikipedia</button>
    <button class="sc" data-url="https://www.reddit.com"><div class="sc-i" style="color:#ff4500">R</div>Reddit</button>
    <button class="sc" data-url="https://github.com"><div class="sc-i">GH</div>GitHub</button>
    <button class="sc" data-url="https://www.twitch.tv"><div class="sc-i" style="color:#9146ff">TW</div>Twitch</button>
  </div>
</div>
<div class="brave-footer">Brave Search &mdash; privacy by default</div>
<script>
document.getElementById('_bsf').addEventListener('submit',function(e){
  e.preventDefault();
  var q=document.getElementById('_bsi').value.trim();
  if(q&&window.parent&&window.parent.VoltraBrowser){window.parent.VoltraBrowser.navigate(q);}
});
document.querySelectorAll('.sc').forEach(function(btn){
  btn.addEventListener('click',function(){
    var url=this.getAttribute('data-url');
    if(url&&window.parent&&window.parent.VoltraBrowser){window.parent.VoltraBrowser.navigate(url);}
  });
});
</script>
</body>
</html>`;
  }

  /**
   * Normalize a target URL for iframe loading (UV proxy handles encoding).
   * @param {string} targetUrl
   * @returns {string}
   */
  function normalizeUrl(targetUrl) {
    if (!targetUrl || targetUrl === 'about:blank') return targetUrl;
    if (/^about:/i.test(targetUrl)) return targetUrl;
    if (targetUrl === BRAVE_HOME_INTERNAL) return targetUrl;
    
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    return targetUrl;
  }

  function getBraveFallbackUrl(targetUrl) {
    if (!targetUrl) return BRAVE_HOME_URL;
    return SEARCH_ENGINE_BASE + encodeURIComponent(targetUrl);
  }

  // Tab cloaking functions
  function openInAboutBlank() {
    const newWindow = window.open('about:blank', '_blank');
    const clonedDocument = document.documentElement.cloneNode(true);
    newWindow.document.write(clonedDocument.outerHTML);
    newWindow.document.close();
  }

  async function openInBlob() {
    const htmlDocument = document.documentElement.cloneNode(true);
    const scripts = htmlDocument.querySelectorAll('script[src], script:not([src])');
    
    scripts.forEach(script => {
      const deferredScript = document.createElement('script');
      deferredScript.type = 'text/javascript';
      if (script.textContent) {
        deferredScript.textContent = `
          document.addEventListener('DOMContentLoaded', function() {
            ${script.textContent}
          });
        `;
      }
      if (script.src) {
        deferredScript.textContent = `
          document.addEventListener('DOMContentLoaded', function() {
            const script = document.createElement('script');
            script.src = "${script.src}";
            document.body.appendChild(script);
          });
        `;
      }
      script.parentNode.replaceChild(deferredScript, script);
    });

    const stylesheets = Array.from(document.styleSheets).filter(sheet => sheet.href);
    const cssPromises = stylesheets.map(async sheet => {
      try {
        const response = await fetch(sheet.href);
        const text = await response.text();
        const style = document.createElement('style');
        style.textContent = text;
        htmlDocument.querySelector('head').appendChild(style);
      } catch (e) {
        console.warn('Could not inline CSS:', sheet.href, e);
      }
    });

    await Promise.all(cssPromises);

    const blob = new Blob([htmlDocument.outerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // User ID generation
  function generateUserID() {
    const lowercase = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '01234567890123456789';
    let userId = 'Session ID: ';

    for (let i = 0; i < 14; i++) {
      if (i % 3 === 0) {
        userId += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
      } else if (i % 3 === 1) {
        userId += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
      } else {
        userId += numbers.charAt(Math.floor(Math.random() * numbers.length));
      }
    }

    return userId;
  }

  // Fullscreen toggle
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  // Data URL generation
  function generateDataURL() {
    const htmlContent = document.documentElement.outerHTML;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  }

  // Clear all data
  function clearAllData() {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(';').forEach((cookie) => {
      const cookieName = cookie.split('=')[0].trim();
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
    });
  }

  class BrowserUI {
    constructor() {
      this.container = null;
      this.historyManager = new HistoryManager();
      this.historyManager.loadAll();
      this.bookmarkManager = new BookmarkManager();
      this._onUrlChange = null;
      this._pendingRestoreTabs = [];
    }

    /**
     * Set callback for when the URL/address bar should update.
     * @param {Function} cb
     */
    onUrlChange(cb) {
      this._onUrlChange = cb;
    }

    /**
     * Build the full browser HTML.
     * @returns {string}
     */
    buildHTML() {
      const currentUrl = this.historyManager.getCurrentUrl('main');
      const canBack = this.historyManager.canGoBack('main');
      const canForward = this.historyManager.canGoForward('main');

      return `
        <div class="browser-container" id="browserContainer">
          <!-- Navigation / Address Bar -->
          <div class="browser-nav-bar" id="browserNavBar">
            <button class="browser-nav-btn" onclick="VoltraBrowser.goBack()" ${canBack ? '' : 'disabled'} title="Back">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="VoltraBrowser.goForward()" ${canForward ? '' : 'disabled'} title="Forward">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="this.querySelector('svg').classList.add('spinning');VoltraBrowser.refresh()" title="Refresh">
              <svg id="refreshIcon" viewBox="0 0 24 24" fill="currentColor" onanimationend="this.classList.remove('spinning')"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="VoltraBrowser.goHome()" title="Home">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
            </button>
            <div class="browser-address-bar-wrapper">
              <div class="browser-address-bar" id="browserAddressBar">
                <div class="browser-search-engine-selector" onclick="VoltraBrowser.toggleSearchEngineDropdown()" title="Search Engine">
                  <img src="${this._escapeHtml(getSearchEngine().icon)}" alt="Search Engine" id="searchEngineIcon">
                </div>
                <div class="browser-search-engine-dropdown" id="searchEngineDropdown" style="display:none;">
                  ${Object.entries(SEARCH_ENGINES).map(([key, engine]) => `
                    <div class="browser-search-engine-option" data-engine="${key}" onclick="VoltraBrowser.selectSearchEngine('${key}')">
                      <img src="${this._escapeHtml(engine.icon)}" alt="${engine.name}">
                      <span>${engine.name}</span>
                    </div>
                  `).join('')}
                </div>
                <input
                  type="text"
                  class="browser-address-input"
                  id="browserAddressInput"
                  value="${this._escapeHtml(currentUrl || '')}"
                  placeholder="Search or enter URL..."
                  autocomplete="off"
                  spellcheck="false"
                  onkeydown="VoltraBrowser.handleAddressKeydown(event)">
              </div>
            </div>
            <button class="browser-nav-btn" onclick="VoltraBrowser.toggleBookmark()" id="browserBookmarkBtn" title="Bookmark">
              <svg class="browser-bookmark-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            </button>
            <div style="position:relative; display:flex; align-items:center;">
              <button class="browser-nav-btn" onclick="VoltraBrowser.toggleMenu()" title="Menu">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
              </button>
              <!-- Menu Dropdown -->
              <div class="browser-menu-dropdown" id="browserMenuDropdown">
                <div class="browser-menu-section">Browser Controls</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.toggleSound()">
                  <span class="browser-menu-toggle">
                    <span class="browser-menu-toggle-label">Toggle Sound</span>
                    <span class="browser-menu-toggle-switch" id="soundToggleSwitch"></span>
                  </span>
                </div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.reloadPage()">Reload Page</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.hardRefresh()">Hard Refresh</div>

                <div class="browser-menu-separator"></div>
                <div class="browser-menu-section">Privacy</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.resetCookies()">Reset Cookies</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.wipePageData()">Wipe Page Data</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.clearSiteStorage()">Clear Site Storage</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.clearCache()">Clear Cache</div>

                <div class="browser-menu-separator"></div>
                <div class="browser-menu-section">Site Controls</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.sitePermissions()">Site Permissions</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.pageInformation()">Page Information</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.viewSecurityStatus()">View Security Status</div>

                <div class="browser-menu-separator"></div>
                <div class="browser-menu-section">Orbit</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.orbitSettings()">Orbit Settings</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.appearance()">Appearance</div>
                <div class="browser-menu-item" onclick="event.stopPropagation(); VoltraBrowser.browserPreferences()">Browser Preferences</div>
              </div>
            </div>
          </div>

          <!-- Bookmarks Bar -->
          <div class="browser-bookmarks-bar" id="browserBookmarksBar"></div>

          <!-- Loading Bar -->
          <div class="browser-loading-bar" id="browserLoadingBar"></div>

          <!-- Content Area -->
          <div class="browser-viewport" id="browserViewport">
            <div class="browser-frame-wrapper">
              <iframe
                id="browserFrame-main"
                class="browser-frame"
                src="about:blank"
                allow="fullscreen; microphone; camera; autoplay"
                allowfullscreen
                onload="VoltraBrowser.handleFrameLoad()"
                onerror="VoltraBrowser.handleFrameError()"
              ></iframe>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * Update the address bar value.
     * @param {string} url
     */
    updateAddressBar(url) {
      const input = document.getElementById('browserAddressInput');
      if (input) input.value = url || '';
    }

    /**
     * Update nav button states.
     */
    updateNavButtons() {
      const backBtn = document.querySelector('#browserNavBar .browser-nav-btn:first-child');
      const forwardBtn = document.querySelectorAll('#browserNavBar .browser-nav-btn')[1];
      
      if (backBtn) backBtn.disabled = !this.historyManager.canGoBack('main');
      if (forwardBtn) forwardBtn.disabled = !this.historyManager.canGoForward('main');
    }

    /**
     * Show loading bar animation.
     */
    showLoading() {
      const bar = document.getElementById('browserLoadingBar');
      if (bar) {
        bar.classList.remove('loaded');
        bar.classList.add('loading');
      }
    }

    /**
     * Hide loading bar.
     */
    hideLoading() {
      const bar = document.getElementById('browserLoadingBar');
      if (bar) {
        bar.classList.add('loaded');
        setTimeout(() => bar.classList.remove('loading', 'loaded'), 400);
      }
    }

    _escapeHtml(str) {
      return String(str).replace(/&/g, '&').replace(/"/g, '"').replace(/</g, '<').replace(/>/g, '>');
    }

    /**
     * Navigate to a URL.
     */
    navigate(url) {
      const parsed = InputParser.parse(url);
      const targetUrl = parsed.url;

      if (targetUrl === 'about:blank') {
        this._loadBlank();
        this.historyManager.push('main', 'about:blank', 'New Tab');
        this.updateAddressBar('about:blank');
        this.updateNavButtons();
        return;
      }

      const isSearch = parsed.type === 'search';

      this.historyManager.push('main', targetUrl, parsed.query || targetUrl);
      this._loadUrlInFrame(targetUrl);

      this.updateAddressBar(targetUrl);
      this.updateNavButtons();
      this._updateBookmarkBtn();
    }

    _loadBlank() {
      const iframe = document.getElementById('browserFrame-main');
      if (iframe) {
        iframe.srcdoc = '<!DOCTYPE html><html><head><style>body{margin:0;background:#05070b;color:rgba(255,255,255,0.6);display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;flex-direction:column;gap:12px;}h2{color:rgba(255,255,255,0.3);font-weight:400;font-size:1.1rem;}</style></head><body><h2>Enter a URL or search to start browsing</h2></body></html>';
        iframe.src = 'about:blank';
      }
    }

    _getDisplayTitle(url) {
      try {
        const u = new URL(url);
        return u.hostname.replace('www.', '');
      } catch (e) {
        return url;
      }
    }

    _refreshTabBar() {
      // Tab bar removed - no-op
    }

    handleAddressKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = e.target.value;
        if (value.trim()) {
          this.navigate(value);
        }
        e.target.blur();
      }
      if (e.key === 'Escape') {
        e.target.blur();
      }
    }

    toggleMenu() {
      const menu = document.getElementById('browserMenuDropdown');
      if (menu) {
        menu.classList.toggle('open');
      }
      const searchDropdown = document.getElementById('searchEngineDropdown');
      if (searchDropdown) {
        searchDropdown.style.display = 'none';
      }
      if (menu && menu.classList.contains('open')) {
        this._attachMenuOutsideClick();
      }
    }

    _attachMenuOutsideClick() {
      const menu = document.getElementById('browserMenuDropdown');

      const closeMenu = () => {
        if (menu) menu.classList.remove('open');
        document.removeEventListener('click', clickHandler, true);
        document.removeEventListener('keydown', keyHandler);
      };

      const clickHandler = (e) => {
        const btn = e.target.closest('.browser-nav-btn[onclick*="toggleMenu"]') || e.target.closest('#browserMenuDropdown');
        if (!btn && menu) {
          closeMenu();
        }
      };

      const keyHandler = (e) => {
        if (e.key === 'Escape') {
          closeMenu();
        }
      };

      setTimeout(() => {
        document.addEventListener('click', clickHandler, true);
        document.addEventListener('keydown', keyHandler);
      }, 0);
    }

    toggleBookmarksBar() {
      const bar = document.getElementById('browserBookmarksBar');
      const sw = document.getElementById('bookmarksToggleSwitch');
      if (bar && sw) {
        bar.classList.toggle('visible');
        sw.classList.toggle('on');
      }
    }

    toggleSound() {
      const sw = document.getElementById('soundToggleSwitch');
      if (sw) {
        sw.classList.toggle('on');
      }
    }

    clearCache() {
      try {
        localStorage.clear();
        sessionStorage.clear();
        alert('Cache cleared successfully');
      } catch (err) {
        alert('Failed to clear cache: ' + err.message);
      }
      this.toggleMenu();
    }

    toggleSearchEngineDropdown() {
      const dropdown = document.getElementById('searchEngineDropdown');
      if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      }
      // Close menu dropdown if open
      const menu = document.getElementById('browserMenuDropdown');
      if (menu) {
        menu.style.display = 'none';
      }
    }

    selectSearchEngine(engineKey) {
      setSearchEngine(engineKey);
      const icon = document.getElementById('searchEngineIcon');
      if (icon) {
        icon.src = getSearchEngine().icon;
      }
      const dropdown = document.getElementById('searchEngineDropdown');
      if (dropdown) {
        dropdown.style.display = 'none';
      }
    }

    showUserID() {
      const userId = generateUserID();
      alert(userId);
      this.toggleMenu();
    }

    goHome() {
      this.navigate(BRAVE_HOME_INTERNAL);
    }

    openSettings() {
      // Navigate to settings page
      this.navigate('orbit://settings');
      this.toggleMenu();
    }

    clearHistory() {
      this.historyManager.clearAll();
      this.historyManager.push('main', BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
      this._rebuildAll();
      alert('History cleared successfully');
      this.toggleMenu();
    }

    openInAboutBlank() {
      openInAboutBlank();
      this.toggleMenu();
    }

    openInBlob() {
      openInBlob();
      this.toggleMenu();
    }

    toggleFullscreen() {
      toggleFullscreen();
      this.toggleMenu();
    }

    generateDataURL() {
      const dataURL = generateDataURL();
      // Copy to clipboard
      navigator.clipboard.writeText(dataURL).then(() => {
        alert('Data URL copied to clipboard!');
      }).catch(() => {
        alert('Failed to copy Data URL');
      });
      this.toggleMenu();
    }

    clearAllData() {
      if (confirm('Are you sure you want to clear all data? This will delete all tabs, history, and settings.')) {
        clearAllData();
        location.reload();
      }
      this.toggleMenu();
    }

    // --- Menu action handlers (Ultraviolet integration) ---

    reloadPage() {
      this.refresh();
      this.toggleMenu();
    }

    hardRefresh() {
      const iframe = document.getElementById('browserFrame-main');
      if (iframe) {
        this.showLoading();
        const src = iframe.src;
        iframe.src = '';
        setTimeout(() => { iframe.src = src; }, 10);
        this.updateNavButtons();
      }
      this.toggleMenu();
    }

    // Privacy actions
    resetCookies() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    wipePageData() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    clearSiteStorage() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    // Site controls
    sitePermissions() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    pageInformation() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    viewSecurityStatus() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    // Orbit settings
    orbitSettings() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    appearance() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    browserPreferences() {
      // TODO: Connect to Ultraviolet
      this.toggleMenu();
    }

    duplicateTab() {
      // Tab system removed
    }

    goBack() {
      const entry = this.historyManager.back('main');
      if (entry) {
        this._loadUrlInFrame(entry.url);
        this.updateAddressBar(entry.url);
        this.updateNavButtons();
        this._updateBookmarkBtn();
      }
    }

    goForward() {
      const entry = this.historyManager.forward('main');
      if (entry) {
        this._loadUrlInFrame(entry.url);
        this.updateAddressBar(entry.url);
        this.updateNavButtons();
        this._updateBookmarkBtn();
      }
    }

    refresh() {
      const iframe = document.getElementById('browserFrame-main');
      if (iframe) {
        this.showLoading();
        const currentSrc = iframe.src;
        iframe.src = '';
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 10);
        this.updateNavButtons();
      }
    }

    toggleBookmark() {
      const url = this.historyManager.getCurrentUrl('main');
      if (!url || url === 'about:blank' || url === BRAVE_HOME_INTERNAL) return;

      const bm = this.bookmarkManager;
      const btn = document.getElementById('browserBookmarkBtn');
      if (bm.isBookmarked(url)) {
        const existing = bm.getAll().find(b => b.url === url);
        if (existing) bm.remove(existing.id);
        if (btn) btn.classList.remove('active');
      } else {
        const title = this._getDisplayTitle(url);
        bm.add(title, url);
        if (btn) btn.classList.add('active');
      }
      this._renderBookmarksBar();
    }

    handleFrameLoad() {
      this.hideLoading();
      const iframe = document.getElementById('browserFrame-main');
      try {
        if (iframe && iframe.contentDocument && iframe.contentDocument.title) {
          // title extracted but no tab bar to update
        }
      } catch (e) {
        // cross-origin
      }
      this.updateAddressBar(this.historyManager.getCurrentUrl('main'));
      this.updateNavButtons();
      this._updateBookmarkBtn();
    }

    handleFrameError() {
      this.hideLoading();
    }

    _loadUrlInFrame(url) {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe) return;

      if (isBraveHome(url)) {
        iframe.srcdoc = getBraveHomeSrcDoc();
        this.updateAddressBar(BRAVE_HOME_INTERNAL);
        this.updateNavButtons();
        return;
      }

      this.showLoading();
      const normalized = normalizeUrl(url);
      const useUv = shouldUseUV(normalized) && typeof window.encodeUVUrl === 'function';
      let finalSrc;
      if (useUv) {
        finalSrc = window.encodeUVUrl(normalized);
      } else {
        finalSrc = normalized;
      }
      console.log('[UV-ROUTE] input:', url, '| normalized:', normalized, '| shouldUseUV:', useUv, '| encoded:', finalSrc !== normalized ? finalSrc : '(direct)', '| has /service/:', finalSrc.includes('/service/'));
      window.__UV_ROUTE_DEBUG__ = {
        lastUrl: url,
        lastNormalized: normalized,
        lastShouldUseUV: useUv,
        lastEncoded: finalSrc !== normalized ? finalSrc : '',
        lastFinalSrc: finalSrc,
        lastHasService: finalSrc.includes('/service/'),
      };
      iframe.removeAttribute('srcdoc');
      iframe.src = finalSrc;
      this.updateNavButtons();
    }

    _restoreTabUrl(url) {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe || !url || url === 'about:blank') return;

      if (isBraveHome(url)) {
        iframe.srcdoc = getBraveHomeSrcDoc();
        console.log('[RESTORE] restored Brave Home');
        return;
      }

      const normalized = normalizeUrl(url);
      const useUv = shouldUseUV(normalized) && typeof window.encodeUVUrl === 'function';
      let finalSrc;
      if (useUv) {
        finalSrc = window.encodeUVUrl(normalized);
      } else {
        finalSrc = normalized;
      }
      console.log('[RESTORE] at', Date.now(), 'url:', url, 'encoded:', (finalSrc !== normalized ? finalSrc : '(direct)'));
      window.__UV_ROUTE_DEBUG__ = {
        lastUrl: url,
        lastNormalized: normalized,
        lastShouldUseUV: useUv,
        lastEncoded: finalSrc !== normalized ? finalSrc : '',
        lastFinalSrc: finalSrc,
        lastHasService: finalSrc.includes('/service/'),
      };
      iframe.removeAttribute('srcdoc');
      iframe.src = finalSrc;
      this.updateNavButtons();
    }

    _restoreUrlDeferred(url) {
      const portReady = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady;
      if (!portReady) {
        console.log('[DEFER] url=' + url + ' portReady=' + portReady);
        if (!this._pendingRestoreTabs) this._pendingRestoreTabs = [];
        if (!this._pendingRestoreTabs.find(t => t.url === url)) {
          this._pendingRestoreTabs.push({ url });
        }
        return;
      }
      this._restoreTabUrl(url);
    }

    _processPendingRestoreTabs() {
      const pending = this._pendingRestoreTabs || [];
      this._pendingRestoreTabs = [];
      if (pending.length === 0) return;
      pending.forEach(({ url }) => {
        this._restoreTabUrl(url);
      });
    }

    _updateBookmarkBtn() {
      const btn = document.getElementById('browserBookmarkBtn');
      if (!btn) return;
      const url = this.historyManager.getCurrentUrl('main');
      if (url && this.bookmarkManager.isBookmarked(url)) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }

    _renderBookmarksBar() {
      const bar = document.getElementById('browserBookmarksBar');
      if (!bar) return;
      const bookmarks = this.bookmarkManager.getAll();

      if (bookmarks.length === 0) {
        bar.innerHTML = '<span class="browser-bookmark-add-btn" onclick="VoltraBrowser.addBookmark()">+ Add Bookmark</span>';
        bar.classList.remove('hidden');
        this._initBookmarkDrop(bar);
        return;
      }

      bar.innerHTML = bookmarks.map((bm) => {
        let hostname = '';
        try { hostname = new URL(bm.url).hostname; } catch (e) {}
        return `
        <span class="browser-bookmark-item" data-bm-id="${bm.id}">
          <img class="browser-bookmark-icon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=16" onerror="this.style.display='none'" alt="">
          <span class="browser-bookmark-label">${this._escapeHtml(bm.title)}</span>
          <span class="browser-bookmark-remove" onclick="event.stopPropagation(); VoltraBrowser.removeBookmark('${bm.id}')">×</span>
        </span>
      `}).join('') + `
        <span class="browser-bookmark-add-btn" onclick="VoltraBrowser.addBookmark()">+ Add Bookmark</span>
      `;

      bar.querySelectorAll('.browser-bookmark-item').forEach(item => {
        item.addEventListener('click', (e) => {
          if (e.target.closest('.browser-bookmark-remove')) return;
          const id = item.dataset.bmId;
          const bm = this.bookmarkManager.getAll().find(b => b.id === id);
          if (bm) this.navigate(bm.url);
        });
      });

      this._initBookmarkDrop(bar);
    }

    addBookmark() {
      const url = this.historyManager.getCurrentUrl('main');
      if (!url || url === 'about:blank' || url === BRAVE_HOME_INTERNAL) return;
      const title = this._getDisplayTitle(url);
      this.bookmarkManager.add(title, url);
      this._renderBookmarksBar();
      this._updateBookmarkBtn();
    }

    removeBookmark(id) {
      this.bookmarkManager.remove(id);
      this._renderBookmarksBar();
      this._updateBookmarkBtn();
    }

    toggleBookmarksBar() {
      const bar = document.getElementById('browserBookmarksBar');
      const sw = document.getElementById('bookmarksToggleSwitch');
      if (bar && sw) {
        bar.classList.toggle('hidden');
        sw.classList.toggle('on');
      }
    }

    _isValidBookmarkDrop(text) {
      if (!text || typeof text !== 'string') return false;
      const trimmed = text.trim();
      if (!trimmed) return false;

      // Allow http/https URLs
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
          new URL(trimmed);
          return true;
        } catch (e) {
          return false;
        }
      }

      // Allow valid domain-like strings (e.g., "example.com")
      const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(\/[^\s]*)?$/;
      if (domainPattern.test(trimmed)) {
        return true;
      }

      return false;
    }

    _initBookmarkDrop(bar) {
      let dragEnterCount = 0;

      bar.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragEnterCount++;
        bar.classList.add('drag-over');
      });

      bar.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      bar.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragEnterCount--;
        if (dragEnterCount <= 0) {
          dragEnterCount = 0;
          bar.classList.remove('drag-over');
        }
      });

      bar.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragEnterCount = 0;
        bar.classList.remove('drag-over');

        let droppedText = '';

        // Try to get URL from various data transfer formats
        const url = e.dataTransfer.getData('text/uri-list');
        if (url && this._isValidBookmarkDrop(url)) {
          droppedText = url;
        }

        if (!droppedText) {
          const html = e.dataTransfer.getData('text/html');
          if (html) {
            const match = html.match(/href="([^"]+)"/i);
            if (match && this._isValidBookmarkDrop(match[1])) {
              droppedText = match[1];
            }
          }
        }

        if (!droppedText) {
          const plain = e.dataTransfer.getData('text/plain');
          if (plain && this._isValidBookmarkDrop(plain)) {
            droppedText = plain;
          }
        }

        if (!droppedText) return;

        const trimmed = droppedText.trim();
        let title = trimmed;

        // Try to extract a title from HTML data
        if (e.dataTransfer.getData('text/html')) {
          const titleMatch = e.dataTransfer.getData('text/html').match(/<a[^>]*>([^<]+)<\/a>/i);
          if (titleMatch) {
            title = titleMatch[1].trim();
          }
        }

        // Ensure URL is fully qualified for domain-only drops
        let finalUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          finalUrl = 'https://' + trimmed;
        }

        this.bookmarkManager.add(title, finalUrl);
        this._renderBookmarksBar();
        this._updateBookmarkBtn();
      });
    }

    _rebuildAll() {
      const container = document.getElementById('browserContainer');
      if (!container) return;
      container.outerHTML = this.buildHTML();

      this.updateAddressBar(this.historyManager.getCurrentUrl('main') || '');
      this.updateNavButtons();

      this._renderBookmarksBar();
      this._updateBookmarkBtn();

      const bar = document.getElementById('browserLoadingBar');
      if (bar) bar.classList.remove('loading', 'loaded');
    }

    /**
     * Main render function - builds the full browser and initializes.
     */
    render(containerElement) {
      if (containerElement) {
        containerElement.innerHTML = this.buildHTML();
      }

      this.updateAddressBar(this.historyManager.getCurrentUrl('main') || '');
      this.updateNavButtons();

      this._renderBookmarksBar();
      this._updateBookmarkBtn();

      const bar = document.getElementById('browserLoadingBar');
      if (bar) bar.classList.remove('loading', 'loaded');

      // Restoration pass: load persisted URL through UV proxy
      const mainUrl = this.historyManager.getCurrentUrl('main');
      if (mainUrl && mainUrl !== 'about:blank' && !isBraveHome(mainUrl)) {
        this._restoreUrlDeferred(mainUrl);
        this.showLoading();
        console.log('[RESTORE] iframe set for main url:', mainUrl);
      } else if (mainUrl && isBraveHome(mainUrl)) {
        this._restoreTabUrl(mainUrl);
      }
    }
  }

  // ==================== Export to Window ====================

  // Create the singleton browser engine
  const browserUI = new BrowserUI();

  window.VoltraBrowser = {
    // Navigation
    navigate: (url) => browserUI.navigate(url),
    goBack: () => browserUI.goBack(),
    goForward: () => browserUI.goForward(),
    refresh: () => browserUI.refresh(),
    toggleBookmark: () => browserUI.toggleBookmark(),
    goHome: () => browserUI.goHome(),
    
    // Address bar events
    handleAddressKeydown: (e) => browserUI.handleAddressKeydown(e),
    
    // Frame events
    handleFrameLoad: () => browserUI.handleFrameLoad(),
    handleFrameError: () => browserUI.handleFrameError(),
    
    // Menu
    toggleMenu: () => browserUI.toggleMenu(),

    // Search engine
    toggleSearchEngineDropdown: () => browserUI.toggleSearchEngineDropdown(),
    selectSearchEngine: (key) => browserUI.selectSearchEngine(key),

    // Menu action handlers
    toggleBookmarksBar: () => browserUI.toggleBookmarksBar(),
    toggleSound: () => browserUI.toggleSound(),
    clearCache: () => browserUI.clearCache(),
    clearHistory: () => browserUI.clearHistory(),
    reloadPage: () => browserUI.reloadPage(),
    hardRefresh: () => browserUI.hardRefresh(),
    resetCookies: () => browserUI.resetCookies(),
    wipePageData: () => browserUI.wipePageData(),
    clearSiteStorage: () => browserUI.clearSiteStorage(),
    sitePermissions: () => browserUI.sitePermissions(),
    pageInformation: () => browserUI.pageInformation(),
    viewSecurityStatus: () => browserUI.viewSecurityStatus(),
    orbitSettings: () => browserUI.orbitSettings(),
    appearance: () => browserUI.appearance(),
    browserPreferences: () => browserUI.browserPreferences(),

    // Bookmarks
    addBookmark: () => browserUI.addBookmark(),
    removeBookmark: (id) => browserUI.removeBookmark(id),

    // Render
    render: (container) => browserUI.render(container),
    
    // Internal reference for state checks
    _browserUI: browserUI,
    _historyManager: browserUI.historyManager
  };

})();
