/**
 * Voltra Browser Engine v1.0
 * Modular browser-style navigation and search engine
 * 
 * Modules:
 *   - InputParser    : URL detection / search query routing
 *   - HistoryManager : Per-tab back/forward navigation stack
 *   - TabManager     : Multi-tab sessions with localStorage persistence
 *   - BrowserUI      : Renders the browser chrome (address bar, tabs, nav controls)
 *   - SearchEngine   : Autocomplete suggestions from history & popular sites
 */

(function() {
  'use strict';

  // ==================== Initialize ProxyEngine ====================
  
  // Initialize the ProxyEngine instance (from proxy-engine.js)
  let proxyEngine = null;
  
  async function initProxyEngine() {
    // Proxy functionality disabled - focusing on core browser UI first
    console.log('[Orbit] Proxy functionality disabled - focusing on core browser UI');
    proxyEngine = null;
  }

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
      icon: 'https://search.brave.com/favicon.ico'
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

    /**
     * Get autocomplete suggestions from history and popular sites.
     * @param {string} partial
     * @param {Array} historyItems
     * @returns {Array}
     */
    static getSuggestions(partial, historyItems = []) {
      if (!partial || partial.trim().length < 1) return [];
      const q = partial.toLowerCase().trim();

      // Popular/default sites for autocomplete
      const popularSites = [
        { title: 'Google', url: 'https://www.google.com', icon: 'G' },
        { title: 'YouTube', url: 'https://www.youtube.com', icon: 'YT' },
        { title: SEARCH_PROVIDER_NAME, url: 'https://search.brave.com', icon: 'B' },
        { title: 'Wikipedia', url: 'https://www.wikipedia.org', icon: 'W' },
        { title: 'Reddit', url: 'https://www.reddit.com', icon: 'R' },
        { title: 'GitHub', url: 'https://github.com', icon: 'GH' },
        { title: 'Google Classroom', url: 'https://classroom.google.com', icon: 'GC' },
        { title: 'Google Docs', url: 'https://docs.google.com', icon: 'GD' },
        { title: 'Google Drive', url: 'https://drive.google.com', icon: 'DR' },
        { title: 'Twitch', url: 'https://www.twitch.tv', icon: 'TW' },
        { title: 'Spotify', url: 'https://open.spotify.com', icon: 'SP' },
        { title: 'X (Twitter)', url: 'https://x.com', icon: 'X' },
        { title: 'Instagram', url: 'https://www.instagram.com', icon: 'IG' },
        { title: 'Discord', url: 'https://discord.com', icon: 'DC' },
      ];

      // Filter history that starts with or includes the query
      const historyMatches = historyItems
        .filter(item => item.url.toLowerCase().includes(q) || item.title.toLowerCase().includes(q))
        .slice(0, 5);

      // Filter popular sites that start with query
      const popularMatches = popularSites
        .filter(site => site.title.toLowerCase().includes(q) || site.url.toLowerCase().includes(q))
        .slice(0, 5);

      // Combine, deduplicate by URL
      const seen = new Set();
      const results = [];
      
      [...historyMatches, ...popularMatches].forEach(item => {
        if (!seen.has(item.url)) {
          seen.add(item.url);
          results.push(item);
        }
      });

      return results.slice(0, 8);
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

    /**
     * Get all history across all tabs (for search suggestions).
     * @returns {Array}
     */
    getAllHistory() {
      const items = [];
      Object.values(this.stacks).forEach(stack => {
        stack.entries.forEach(entry => {
          if (entry.url) {
            items.push({
              url: entry.url,
              title: entry.title || entry.url,
              timestamp: entry.timestamp
            });
          }
        });
      });
      // Sort by timestamp descending, deduplicate
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      const seen = new Set();
      return items.filter(item => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
    }
  }

  // ==================== TabManager ====================

  class TabManager {
    constructor() {
      this.tabs = {};       // tabId -> { id, title, url, isLoading }
      this.activeTabId = null;
      this.tabCounter = 0;
      this._loadState();
    }

    /**
     * Create a new tab.
     * @param {string} url - Initial URL
     * @param {string} title - Tab title
     * @returns {string} tabId
     */
    createTab(url = BRAVE_HOME_INTERNAL, title = SEARCH_PROVIDER_NAME) {
      this.tabCounter++;
      const tabId = 'tab-' + this.tabCounter + '-' + Date.now();
      this.tabs[tabId] = { id: tabId, title, url, isLoading: false };
      this.activeTabId = tabId;
      this._persist();
      return tabId;
    }

    /**
     * Switch to a tab.
     * @param {string} tabId
     */
    switchTab(tabId) {
      if (this.tabs[tabId]) {
        this.activeTabId = tabId;
        this._persist();
      }
    }

    /**
     * Close a tab.
     * @param {string} tabId
     * @returns {string|null} next active tabId
     */
    closeTab(tabId) {
      if (Object.keys(this.tabs).length <= 1) {
        // Don't close the last tab
        return null;
      }

      const tabIds = Object.keys(this.tabs);
      const idx = tabIds.indexOf(tabId);
      delete this.tabs[tabId];

      // Determine next active tab
      if (this.activeTabId === tabId) {
        if (idx < tabIds.length - 1) {
          this.activeTabId = tabIds[idx + 1] || tabIds[idx - 1];
        } else {
          this.createTab(BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
        }
      }

      this._persist();
      return this.activeTabId;
    }

    /**
     * Update a tab's title.
     */
    updateTitle(tabId, title) {
      if (this.tabs[tabId]) {
        this.tabs[tabId].title = title;
        this._persist();
      }
    }

    /**
     * Update a tab's URL.
     */
    updateUrl(tabId, url) {
      if (this.tabs[tabId]) {
        this.tabs[tabId].url = url;
        this._persist();
      }
    }

    /**
     * Set loading state for a tab.
     */
    setLoading(tabId, isLoading) {
      if (this.tabs[tabId]) {
        this.tabs[tabId].isLoading = isLoading;
        this._persist();
      }
    }

    /**
     * Get all tabs as an array sorted by creation.
     * @returns {Array}
     */
    getTabList() {
      return Object.values(this.tabs);
    }

    /**
     * Get active tab data.
     * @returns {object|null}
     */
    getActiveTab() {
      return this.tabs[this.activeTabId] || null;
    }

    /**
     * Clear all tabs.
     */
    clearAll() {
      this.tabs = {};
      this.activeTabId = null;
      this.tabCounter = 0;
      try {
        localStorage.removeItem('voltra-browser-tabs');
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Persist tabs to localStorage.
     */
    _persist() {
      try {
        localStorage.setItem('voltra-browser-tabs', JSON.stringify({
          tabs: this.tabs,
          activeTabId: this.activeTabId,
          tabCounter: this.tabCounter
        }));
      } catch (e) {
        // Silently fail
      }
    }

    /**
     * Load persisted tabs from localStorage.
     */
    _loadState() {
      try {
        const data = JSON.parse(localStorage.getItem('voltra-browser-tabs') || '{}');
        if (data.tabs && Object.keys(data.tabs).length > 0) {
          this.tabs = Object.fromEntries(Object.entries(data.tabs).map(([id, tab]) => {
            const normalizedUrl = tab && (tab.url === 'about:blank' || !tab.url) ? BRAVE_HOME_INTERNAL : tab.url;
            return [id, {
              ...tab,
              url: normalizedUrl,
              title: tab.title || SEARCH_PROVIDER_NAME
            }];
          }));
          this.activeTabId = data.activeTabId || Object.keys(this.tabs)[0] || null;
          this.tabCounter = data.tabCounter || Object.keys(this.tabs).length || 0;
        } else {
          this.createTab(BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
        }
      } catch (e) {
        this.createTab(BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Brave Search</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--accent-a:125,211,252;--accent-b:192,132,252;--hover-ease:cubic-bezier(0.22,1,0.36,1);--hover-glow-duration:.65s;--hover-glow:0 0 0 1px rgba(var(--accent-a),.82),0 0 16px rgba(var(--accent-a),.58),0 0 38px rgba(var(--accent-b),.42),0 0 78px rgba(var(--accent-b),.26)}
body{background:#0c0d10;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;overflow:hidden}
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
   * Normalize a target URL for iframe loading (without proxy).
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
      this.tabManager = new TabManager();
      this.historyManager = new HistoryManager();
      this.historyManager.loadAll();
      this.iframeMap = {}; // tabId -> iframe reference
      this._onUrlChange = null;
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
      const tabs = this.tabManager.getTabList();
      const activeTab = this.tabManager.getActiveTab();
      const activeUrl = activeTab ? this.historyManager.getCurrentUrl(activeTab.id) || activeTab.url || '' : '';
      const canBack = activeTab ? this.historyManager.canGoBack(activeTab.id) : false;
      const canForward = activeTab ? this.historyManager.canGoForward(activeTab.id) : false;

      return `
        <div class="browser-container" id="browserContainer">
          <!-- Tab Bar -->
          <div class="browser-tab-bar" id="browserTabBar">
            <div class="browser-tabs" id="browserTabs">
              ${tabs.map(tab => this._buildTabHTML(tab, tab.id === this.tabManager.activeTabId)).join('')}
            </div>
            <button class="browser-new-tab-btn" onclick="VoltraBrowser.addTab()" title="New Tab">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
          </div>

          <!-- Navigation / Address Bar -->
          <div class="browser-nav-bar" id="browserNavBar">
            <button class="browser-nav-btn" onclick="VoltraBrowser.goBack()" ${canBack ? '' : 'disabled'} title="Back">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="VoltraBrowser.goForward()" ${canForward ? '' : 'disabled'} title="Forward">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="VoltraBrowser.refresh()" title="Refresh">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
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
                  value="${this._escapeHtml(activeUrl)}"
                  placeholder="Search or enter URL..."
                  autocomplete="off"
                  spellcheck="false"
                  onkeydown="VoltraBrowser.handleAddressKeydown(event)"
                  oninput="VoltraBrowser.handleAddressInput(this.value)"
                  onfocus="VoltraBrowser.handleAddressFocus()"
                  onblur="VoltraBrowser.handleAddressBlur()">
                <div class="browser-address-suggestions" id="browserSuggestions"></div>
              </div>
            </div>
            <button class="browser-nav-btn" onclick="VoltraBrowser.toggleBookmark()" id="browserBookmarkBtn" title="Bookmark">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            </button>
            <button class="browser-nav-btn" onclick="VoltraBrowser.toggleMenu()" title="Menu">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
            </button>
          </div>

          <!-- Menu Dropdown -->
          <div class="browser-menu-dropdown" id="browserMenuDropdown" style="display:none;">
            <div class="browser-menu-item" onclick="VoltraBrowser.addTab()">New Tab</div>
            <div class="browser-menu-item" onclick="VoltraBrowser.openSettings()">Settings</div>
            <div class="browser-menu-item" onclick="VoltraBrowser.clearHistory()">Clear History</div>
            <div class="browser-menu-separator"></div>
            <div class="browser-menu-item" onclick="VoltraBrowser.openInAboutBlank()">Tab Cloak (about:blank)</div>
            <div class="browser-menu-item" onclick="VoltraBrowser.openInBlob()">Tab Cloak (blob:)</div>
            <div class="browser-menu-separator"></div>
            <div class="browser-menu-item" onclick="VoltraBrowser.toggleFullscreen()">Fullscreen</div>
            <div class="browser-menu-item" onclick="VoltraBrowser.generateDataURL()">Generate Data URL</div>
            <div class="browser-menu-separator"></div>
            <div class="browser-menu-item" onclick="VoltraBrowser.showUserID()">Show Session ID</div>
            <div class="browser-menu-item" onclick="VoltraBrowser.clearAllData()">Clear All Data</div>
          </div>

          <!-- Loading Bar -->
          <div class="browser-loading-bar" id="browserLoadingBar"></div>

          <!-- Content Area (iframes) -->
          <div class="browser-viewport" id="browserViewport">
            ${tabs.map(tab => this._buildViewportHTML(tab, tab.id === this.tabManager.activeTabId)).join('')}
          </div>
        </div>
      `;
    }

    _buildTabHTML(tab, isActive) {
      return `
        <div class="browser-tab ${isActive ? 'active' : ''}" data-tab-id="${tab.id}" onclick="VoltraBrowser.switchTab('${tab.id}')">
          <span class="browser-tab-title">${this._escapeHtml(tab.title || 'New Tab')}</span>
          ${tab.isLoading ? '<span class="browser-tab-loader"></span>' : ''}
          <button class="browser-tab-close" onclick="event.stopPropagation(); VoltraBrowser.closeTab('${tab.id}')" title="Close tab">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `;
    }

    _buildViewportHTML(tab, isActive) {
      const url = this.historyManager.getCurrentUrl(tab.id) || tab.url || 'about:blank';
      
      // Use srcdoc for the custom Brave home page (embeddable, no CORS issues)
      if (isBraveHome(url)) {
        const srcDoc = getBraveHomeSrcDoc();
        return `
          <div class="browser-viewport-tab ${isActive ? 'active' : ''}" data-vp-tab-id="${tab.id}">
            <div class="browser-frame-wrapper">
              <iframe
                id="browserFrame-${tab.id}"
                class="browser-frame"
                srcdoc="${srcDoc.replace(/&#34;/g, '&#34;').replace(/"/g, '&#34;')}"
                allow="fullscreen; microphone; camera; autoplay"
                allowfullscreen
                onload="VoltraBrowser.handleFrameLoad('${tab.id}')"
              ></iframe>
            </div>
          </div>
        `;
      }

      // Use direct iframe loading for all other sites (no proxy)
      const normalizedUrl = normalizeUrl(url);
      return `
        <div class="browser-viewport-tab ${isActive ? 'active' : ''}" data-vp-tab-id="${tab.id}">
          <div class="browser-frame-wrapper">
            <iframe
              id="browserFrame-${tab.id}"
              class="browser-frame"
              src="${this._escapeHtml(normalizedUrl)}"
              allow="fullscreen; microphone; camera; autoplay"
              allowfullscreen
              onload="VoltraBrowser.handleFrameLoad('${tab.id}')"
              onerror="VoltraBrowser.handleFrameError('${tab.id}')"
            ></iframe>
          </div>
        </div>
      `;
    }

    /**
     * Re-render just the tabs bar after tab changes.
     * @returns {string}
     */
    renderTabsOnly() {
      const tabs = this.tabManager.getTabList();
      return tabs.map(tab => this._buildTabHTML(tab, tab.id === this.tabManager.activeTabId)).join('');
    }

    /**
     * Re-render just the viewport after tab switches.
     * @returns {string}
     */
    renderViewportOnly() {
      const tabs = this.tabManager.getTabList();
      return tabs.map(tab => this._buildViewportHTML(tab, tab.id === this.tabManager.activeTabId)).join('');
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
      const activeTab = this.tabManager.getActiveTab();
      if (!activeTab) return;
      
      const backBtn = document.querySelector('#browserNavBar .browser-nav-btn:first-child');
      const forwardBtn = document.querySelectorAll('#browserNavBar .browser-nav-btn')[1];
      
      if (backBtn) backBtn.disabled = !this.historyManager.canGoBack(activeTab.id);
      if (forwardBtn) forwardBtn.disabled = !this.historyManager.canGoForward(activeTab.id);
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
     * Navigate to a URL in the active tab.
     */
    navigate(url) {
      const tab = this.tabManager.getActiveTab();
      if (!tab) return;

      const parsed = InputParser.parse(url);
      const targetUrl = parsed.url;

      if (targetUrl === 'about:blank') {
        this._loadBlankTab(tab.id);
        this.tabManager.updateUrl(tab.id, 'about:blank');
        this.historyManager.push(tab.id, 'about:blank', 'New Tab');
        this.updateAddressBar('about:blank');
        this.updateNavButtons();
        return;
      }

      const isSearch = parsed.type === 'search';

      // Push to history (store the requested URL or search url)
      this.historyManager.push(tab.id, targetUrl, parsed.query || targetUrl);
      this.tabManager.updateUrl(tab.id, targetUrl);
      this.tabManager.updateTitle(tab.id, isSearch ? SEARCH_PROVIDER_NAME : parsed.query || this._getDisplayTitle(targetUrl));
      this.tabManager.setLoading(tab.id, true);

      // Load URL directly in iframe (no proxy)
      this._loadUrlInActiveTab(targetUrl);

      this.updateAddressBar(targetUrl);
      this.updateNavButtons();
      this._refreshTabBar();
      this._syncSuggestions();
    }

    _loadBlankTab(tabId) {
      const iframe = document.getElementById('browserFrame-' + tabId);
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
      const tabsContainer = document.getElementById('browserTabs');
      if (tabsContainer) {
        tabsContainer.innerHTML = this.renderTabsOnly();
      }
    }

    _syncSuggestions() {
      const input = document.getElementById('browserAddressInput');
      if (input && input === document.activeElement) {
        this._showSuggestions(input.value);
      }
    }

    _showSuggestions(value) {
      const container = document.getElementById('browserSuggestions');
      if (!container) return;
      
      if (!value || value.trim().length < 1) {
        container.classList.remove('active');
        container.innerHTML = '';
        return;
      }

      const historyItems = this.historyManager.getAllHistory();
      const suggestions = InputParser.getSuggestions(value, historyItems);

      if (suggestions.length === 0) {
        // Show search hint
        container.innerHTML = `
          <div class="browser-suggestion-item" data-url="${this._escapeHtml(value)}" onclick="VoltraBrowser.navigateFromSuggestion(this.dataset.url)">
            <span class="browser-suggestion-icon">🔍</span>
            <span class="browser-suggestion-text">Search the web for "${this._escapeHtml(value)}"</span>
          </div>
        `;
        container.classList.add('active');
        return;
      }

      container.innerHTML = suggestions.map(item => `
        <div class="browser-suggestion-item" data-url="${this._escapeHtml(item.url)}" onclick="VoltraBrowser.navigateFromSuggestion(this.dataset.url)">
          <span class="browser-suggestion-icon">${item.icon || '🌐'}</span>
          <span class="browser-suggestion-text">
            <span class="browser-suggestion-title">${this._escapeHtml(item.title)}</span>
            <span class="browser-suggestion-url">${this._escapeHtml(item.url)}</span>
          </span>
        </div>
      `).join('') + `
        <div class="browser-suggestion-item" data-url="${this._escapeHtml(value)}" onclick="VoltraBrowser.navigateFromSuggestion(this.dataset.url)">
          <span class="browser-suggestion-icon">🔍</span>
          <span class="browser-suggestion-text">Search the web for "${this._escapeHtml(value)}"</span>
        </div>
      `;
      container.classList.add('active');
    }

    _hideSuggestions() {
      const container = document.getElementById('browserSuggestions');
      if (container) {
        container.classList.remove('active');
      }
    }

    // ---- Public API methods (wired to window.VoltraBrowser) ----

    handleAddressKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._hideSuggestions();
        const value = e.target.value;
        if (value.trim()) {
          this.navigate(value);
        }
        e.target.blur();
      }
      if (e.key === 'Escape') {
        this._hideSuggestions();
        e.target.blur();
      }
      if (e.key === 'Tab') {
        // Allow tab to move focus normally
        return;
      }
    }

    handleAddressInput(value) {
      this._showSuggestions(value);
    }

    handleAddressFocus() {
      const input = document.getElementById('browserAddressInput');
      if (input) {
        input.select();
        this._showSuggestions(input.value);
      }
    }

    handleAddressBlur() {
      // Delay hiding so click on suggestion works
      setTimeout(() => this._hideSuggestions(), 200);
    }

    navigateFromSuggestion(url) {
      this._hideSuggestions();
      this.navigate(url);
      const input = document.getElementById('browserAddressInput');
      if (input) input.blur();
    }

    toggleMenu() {
      const menu = document.getElementById('browserMenuDropdown');
      if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      }
      // Close search engine dropdown if open
      const searchDropdown = document.getElementById('searchEngineDropdown');
      if (searchDropdown) {
        searchDropdown.style.display = 'none';
      }
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
      this.tabManager.clearAll();
      // Create a fresh tab after clearing
      this.tabManager.createTab(BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
      this.historyManager.push(this.tabManager.activeTabId, BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
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

    addTab() {
      const tabId = this.tabManager.createTab();
      this.historyManager.push(tabId, BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
      this._rebuildAll();
    }

    switchTab(tabId) {
      if (tabId === this.tabManager.activeTabId) return;
      this.tabManager.switchTab(tabId);
      this._rebuildAll();
    }

    closeTab(tabId) {
      const next = this.tabManager.closeTab(tabId);
      if (next === null) {
        // Last tab - just refresh
        this._rebuildAll();
        return;
      }
      this._rebuildAll();
    }

    goBack() {
      const tab = this.tabManager.getActiveTab();
      if (!tab) return;
      const entry = this.historyManager.back(tab.id);
      if (entry) {
        this._loadUrlInActiveTab(entry.url);
        this.tabManager.updateUrl(tab.id, entry.url);
        this.tabManager.updateTitle(tab.id, entry.title || this._getDisplayTitle(entry.url));
        this.updateAddressBar(entry.url);
        this.updateNavButtons();
        this._refreshTabBar();
      }
    }

    goForward() {
      const tab = this.tabManager.getActiveTab();
      if (!tab) return;
      const entry = this.historyManager.forward(tab.id);
      if (entry) {
        this._loadUrlInActiveTab(entry.url);
        this.tabManager.updateUrl(tab.id, entry.url);
        this.tabManager.updateTitle(tab.id, entry.title || this._getDisplayTitle(entry.url));
        this.updateAddressBar(entry.url);
        this.updateNavButtons();
        this._refreshTabBar();
      }
    }

    refresh() {
      const tab = this.tabManager.getActiveTab();
      if (!tab) return;
      const iframe = document.getElementById('browserFrame-' + tab.id);
      if (iframe) {
        this.showLoading();
        this.tabManager.setLoading(tab.id, true);
        // Reload by re-setting src
        const currentSrc = iframe.src;
        iframe.src = '';
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 10);
        this.updateNavButtons();
      }
    }

    toggleBookmark() {
      // Simple toast feedback
      const btn = document.getElementById('browserBookmarkBtn');
      if (btn) {
        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 600);
      }
    }

    openTabExternally(tabId) {
      const tab = this.tabManager.tabs[tabId];
      if (!tab) return;
      const url = this.historyManager.getCurrentUrl(tabId) || tab.url;
      if (url && url !== 'about:blank') {
        const externalUrl = normalizeUrl(url);
        window.open(externalUrl, '_blank', 'noopener,noreferrer');
      }
    }

    handleFrameLoad(tabId) {
      this.tabManager.setLoading(tabId, false);
      this.hideLoading();
      this._refreshTabBar();

      // Try to get the iframe's title
      const iframe = document.getElementById('browserFrame-' + tabId);
      try {
        if (iframe && iframe.contentDocument && iframe.contentDocument.title) {
          const title = iframe.contentDocument.title;
          this.tabManager.updateTitle(tabId, title);
          this._refreshTabBar();
        }
      } catch (e) {
        // Cross-origin, try to extract title from URL
        const tab = this.tabManager.tabs[tabId];
        if (tab) {
          const url = this.historyManager.getCurrentUrl(tabId) || tab.url || '';
          if (url) {
            // Extract domain or use URL as title
            try {
              const urlObj = new URL(url);
              const title = urlObj.hostname.replace('www.', '') || 'New Tab';
              this.tabManager.updateTitle(tabId, title);
              this._refreshTabBar();
            } catch (e2) {
              // Invalid URL, use search query or default
              if (url.includes('search.brave.com')) {
                this.tabManager.updateTitle(tabId, 'Brave Search');
              } else {
                this.tabManager.updateTitle(tabId, 'New Tab');
              }
              this._refreshTabBar();
            }
          }
        }
      }

      const blockedOverlay = document.getElementById('browserFrameBlocked-' + tabId);
      if (blockedOverlay) {
        blockedOverlay.style.display = 'none';
      }

      // Update address bar if this is the active tab
      if (tabId === this.tabManager.activeTabId) {
        const activeTab = this.tabManager.getActiveTab();
        if (activeTab && activeTab.url) {
          this.updateAddressBar(activeTab.url);
        }
        this.updateNavButtons();
      }
    }

    handleFrameError(tabId) {
      this.tabManager.setLoading(tabId, false);
      this.hideLoading();
      this._refreshTabBar();
    }

    /**
     * Navigate back to the Brave home page in a specific tab.
     * @param {string} tabId
     */
    goHomeTab(tabId) {
      const tab = this.tabManager.tabs[tabId];
      if (!tab) return;
      this.historyManager.push(tabId, BRAVE_HOME_INTERNAL, SEARCH_PROVIDER_NAME);
      this.tabManager.updateUrl(tabId, BRAVE_HOME_INTERNAL);
      this.tabManager.updateTitle(tabId, SEARCH_PROVIDER_NAME);
      this._rebuildAll();
    }

    /**
     * Open the blocked page's URL in a new Brave Search tab.
     * @param {string} tabId
     */
    searchBraveTab(tabId) {
      const tab = this.tabManager.tabs[tabId];
      if (!tab) return;
      const currentUrl = this.historyManager.getCurrentUrl(tabId) || tab.url || '';
      if (currentUrl && !isBraveHome(currentUrl)) {
        const braveUrl = SEARCH_ENGINE_BASE + encodeURIComponent(currentUrl);
        this.historyManager.push(tabId, braveUrl, SEARCH_PROVIDER_NAME);
        this.tabManager.updateUrl(tabId, braveUrl);
        this.tabManager.updateTitle(tabId, SEARCH_PROVIDER_NAME);
        this.tabManager.setLoading(tabId, true);
        const iframe = document.getElementById('browserFrame-' + tabId);
        if (iframe) {
          this.showLoading();
          iframe.src = braveUrl;
        }
        this.updateAddressBar(braveUrl);
        this.updateNavButtons();
        this._refreshTabBar();
      }
    }

    _loadUrlInActiveTab(url) {
      const tab = this.tabManager.getActiveTab();
      if (!tab) return;
      const iframe = document.getElementById('browserFrame-' + tab.id);
      if (!iframe) return;

      // If navigating to the home page, rebuild with srcdoc
      if (isBraveHome(url)) {
        this._rebuildAll();
        return;
      }

      this.showLoading();
      this.tabManager.setLoading(tab.id, true);
      iframe.src = normalizeUrl(url);
      this.updateNavButtons();
    }

    _rebuildAll() {
      const container = document.getElementById('browserContainer');
      if (!container) return;
      container.outerHTML = this.buildHTML();
      // Re-run init for new DOM
      this._init();
    }

    _init() {
      // Store reference to new input/container
      const activeTab = this.tabManager.getActiveTab();
      if (activeTab) {
        this.updateAddressBar(this.historyManager.getCurrentUrl(activeTab.id) || activeTab.url || '');
        this.updateNavButtons();
      }

      // Hide loading bar initially
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
      this._init();
    }
  }

  // ==================== Export to Window ====================

  // Create the singleton browser engine
  const browserUI = new BrowserUI();

  // Initialize ProxyEngine on load
  initProxyEngine();

  window.VoltraBrowser = {
    // Navigation
    navigate: (url) => browserUI.navigate(url),
    navigateFromSuggestion: (url) => browserUI.navigateFromSuggestion(url),
    goBack: () => browserUI.goBack(),
    goForward: () => browserUI.goForward(),
    refresh: () => browserUI.refresh(),
    toggleBookmark: () => browserUI.toggleBookmark(),
    
    // Tab management
    addTab: () => browserUI.addTab(),
    switchTab: (id) => browserUI.switchTab(id),
    closeTab: (id) => browserUI.closeTab(id),
    
    // Address bar events
    handleAddressKeydown: (e) => browserUI.handleAddressKeydown(e),
    handleAddressInput: (val) => browserUI.handleAddressInput(val),
    handleAddressFocus: () => browserUI.handleAddressFocus(),
    handleAddressBlur: () => browserUI.handleAddressBlur(),
    
    // Frame events
    handleFrameLoad: (id) => browserUI.handleFrameLoad(id),
    handleFrameError: (id) => browserUI.handleFrameError(id),
    openTabExternally: (id) => browserUI.openTabExternally(id),
    goHome: () => browserUI.goHome(),
    searchBrave: (id) => browserUI.searchBraveTab(id),
    
    // Search engine
    toggleSearchEngineDropdown: () => browserUI.toggleSearchEngineDropdown(),
    selectSearchEngine: (key) => browserUI.selectSearchEngine(key),
    showUserID: () => browserUI.showUserID(),

    // Render
    render: (container) => browserUI.render(container),
    
    // Internal reference for state checks
    _browserUI: browserUI,
    _tabManager: browserUI.tabManager,
    _historyManager: browserUI.historyManager,
    _proxyEngine: proxyEngine
  };

})();
