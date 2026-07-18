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
    duckduckgo: {
      name: 'DuckDuckGo',
      url: 'https://duckduckgo.com/?q=',
      icon: 'https://duckduckgo.com/favicon.ico'
    },
    brave: {
      name: 'Brave',
      url: 'https://search.brave.com/search?q=',
      icon: 'icons/Brave.png'
    },
    bing: {
      name: 'Bing',
      url: 'https://www.bing.com/search?q=',
      icon: 'https://www.bing.com/favicon.ico'
    }
  };

  window.OrbitSearchEngines = Object.freeze(Object.fromEntries(
    Object.entries(SEARCH_ENGINES).map(([key, engine]) => [key, Object.freeze({ ...engine })])
  ));

  let currentSearchEngine = 'duckduckgo';

  function normalizeSearchEngineKey(engineKey) {
    return SEARCH_ENGINES[engineKey] ? engineKey : 'duckduckgo';
  }

  function setSearchEngine(engineKey) {
    const normalized = normalizeSearchEngineKey(engineKey);
    currentSearchEngine = normalized;
    localStorage.setItem('orbit_search_engine', normalized);
  }

  function getSearchEngine() {
    const saved = localStorage.getItem('orbit_search_engine');
    const normalized = normalizeSearchEngineKey(saved || currentSearchEngine);
    currentSearchEngine = normalized;
    if (saved !== normalized) {
      localStorage.setItem('orbit_search_engine', normalized);
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

  // ==================== BrowserSettings ====================

  const BROWSER_SETTINGS_KEY = 'orbit-browser-settings';

  const BROWSER_SETTINGS_DEFAULTS = {
    searchEngine: 'duckduckgo',
    bookmarksAutoHide: false,
    notificationsEnabled: true,
    proxyStatusNotifications: true,
    themeChangeNotifications: true,
    gameLaunchNotifications: true
  };

  let browserSettings = {};

  function loadBrowserSettings() {
    try {
      const raw = localStorage.getItem(BROWSER_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        browserSettings = {};
        Object.keys(BROWSER_SETTINGS_DEFAULTS).forEach(function(key) {
          browserSettings[key] = parsed[key] !== undefined ? parsed[key] : BROWSER_SETTINGS_DEFAULTS[key];
        });
      } else {
        browserSettings = JSON.parse(JSON.stringify(BROWSER_SETTINGS_DEFAULTS));
      }
    } catch (e) {
      browserSettings = JSON.parse(JSON.stringify(BROWSER_SETTINGS_DEFAULTS));
    }
    browserSettings.searchEngine = normalizeSearchEngineKey(browserSettings.searchEngine);
    setSearchEngine(browserSettings.searchEngine);
    saveBrowserSettings();
  }

  function saveBrowserSettings() {
    try {
      localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(browserSettings));
    } catch (e) {}
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
    return url === BRAVE_HOME_INTERNAL || url === '' || url === 'orbit://home';
  }

  /**
   * Generate the custom Brave Search home page HTML (embedded via srcdoc).
   * This page is self-contained and can be embedded in an iframe.
   * It communicates with the parent browser via window.parent.VoltraBrowser.
   */
  function getBraveHomeSrcDoc() {
    var quickLinks = [
      { name: 'YouTube',    url: 'youtube.com',    img: 'https://i.ytimg.com/vi/s-KZu1kru8Y/sddefault.jpg' },
      { name: 'Twitch',     url: 'twitch.tv',      img: 'https://freshonthenet.co.uk/wp-content/uploads/2020/10/Twitch-Logo.jpg' },
      { name: 'SoundCloud', url: 'soundcloud.com', img: 'https://www.musicweek.com/cimages/f38efa877c6c7b446c02ae1e89ac44d3.jpg' },
      { name: 'Spotify',    url: 'spotify.com',    img: 'https://www.scdn.co/i/_global/open-graph-default.png' },
      { name: 'ChatGPT',    url: 'chatgpt.com',    img: 'https://www.internetmatters.org/wp-content/uploads/2025/06/Chat-GPT-logo.webp' },
      { name: 'Discord',    url: 'discord.com',    img: 'https://gamemakerstoolkit.com/wp-content/uploads/2024/01/perk-discord.jpg' },
      { name: 'GitHub',     url: 'github.com',     img: 'https://blog.kubesimplify.com/img/blog/git-and-github-a-beginners-guide/q3I5kJ5U9.jpeg' },
      { name: 'TikTok',     url: 'tiktok.com',     img: 'https://variety.com/wp-content/uploads/2021/06/TikTok-Jump.png?w=970&h=545&crop=1' },
      { name: 'Netflix',    url: 'netflix.com',    img: 'https://media.wired.com/photos/592681ffcfe0d93c47430739/3:2/w_2560%2Cc_limit/Netflix-Logo-Print_CMYK2.jpg' },
      { name: 'ESPN',       url: 'espn.com',       img: 'https://espnpressroom.com/us/files/2021/06/0-ESPN-Logo-for-PressRoom-780x470.jpg' },
    ];

    var cardsHtml = '';
    for (var i = 0; i < quickLinks.length; i++) {
      cardsHtml += '<div class="card" data-url="' + quickLinks[i].url + '"><img src="' + quickLinks[i].img + '" alt="' + quickLinks[i].name + '" loading="lazy"></div>';
    }

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Orbit</title><style>' +
      '*{margin:0;padding:0;box-sizing:border-box}' +
      'html,body{height:100%;background:#05060b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;font-weight:300;overflow:hidden}' +
      ':root{--accent-a:255,255,255;--accent-b:255,255,255}' +
      '#constellationBg{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}' +
      'body::before{content:"";position:fixed;inset:0;z-index:1;pointer-events:none;background:radial-gradient(circle at 50% 45%,rgba(var(--accent-a),0.08),rgba(5,6,11,0) 34%),radial-gradient(circle at 50% 55%,rgba(120,95,180,0.07),rgba(5,6,11,0) 42%)}' +
      '.wrap{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px 20px}' +
      '.search-wrap{width:100%;max-width:520px;margin-bottom:40px;position:relative;isolation:isolate}' +
      '.search-wrap::before{content:"";position:absolute;inset:0;border-radius:22px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);box-shadow:none;transform:scale(1);transform-origin:center;transition:transform 0.58s cubic-bezier(0.22,1,0.36,1),box-shadow 0.58s cubic-bezier(0.22,1,0.36,1);z-index:-1}' +
      '.search-box{position:relative;width:100%;padding:14px 20px;border-radius:22px;border:0;background:transparent;color:#fff;font-size:1rem;font-family:inherit;font-weight:300;outline:none;-webkit-appearance:none}' +
      '.search-box::placeholder{color:rgba(255,255,255,0.3)}' +
      '.search-wrap:hover::before,.search-wrap:focus-within::before{transform:scale(1.035);box-shadow:0 0 18px rgba(var(--accent-a),0.32),0 0 40px rgba(var(--accent-b),0.18),0 0 70px rgba(var(--accent-a),0.08)}' +
      '.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;width:100%;max-width:840px}' +
      '.card{position:relative;aspect-ratio:16/10;border-radius:11px;overflow:hidden;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);transition:transform 0.58s cubic-bezier(0.22,1,0.36,1),box-shadow 0.58s cubic-bezier(0.22,1,0.36,1);transform:scale(1);transform-origin:center}' +
      '.card:hover{transform:scale(1.07);box-shadow:0 8px 24px rgba(0,0,0,0.35)}' +
      '.card img{width:100%;height:100%;object-fit:cover;display:block}' +
      '@media(max-width:820px){.cards{grid-template-columns:repeat(3,1fr);gap:12px;max-width:460px}}' +
      '@media(max-width:500px){.cards{grid-template-columns:repeat(2,1fr);gap:10px;max-width:320px}}' +
    '</style></head><body><canvas id="constellationBg" aria-hidden="true"></canvas><div class="wrap">' +
      '<div class="search-wrap"><input class="search-box" id="searchInput" type="text" placeholder="Search web" autocomplete="off" autofocus></div>' +
      '<div class="cards" id="cardsContainer">' + cardsHtml + '</div>' +
    '</div>' +
    '<script>' +
      'try{var r=window.parent.document.documentElement,s=getComputedStyle(r);var a=s.getPropertyValue("--accent-a").trim()||"255,255,255",b=s.getPropertyValue("--accent-b").trim()||"255,255,255";document.documentElement.style.setProperty("--accent-a",a);document.documentElement.style.setProperty("--accent-b",b)}catch(e){}' +
      '(function(){var canvas=document.getElementById("constellationBg"),ctx=canvas.getContext("2d"),particles=[],raf=0,running=true,w=0,h=0,dpr=1;function rand(a,b){return a+Math.random()*(b-a)}function theme(){var v=getComputedStyle(document.documentElement).getPropertyValue("--accent-a").trim()||"255,255,255";return v.split(",").map(function(n){return parseInt(n,10)||255})}function resize(){dpr=Math.min(window.devicePixelRatio||1,2);w=window.innerWidth;h=window.innerHeight;canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);canvas.style.width=w+"px";canvas.style.height=h+"px";ctx.setTransform(dpr,0,0,dpr,0,0);var target=Math.max(52,Math.min(118,Math.floor(w*h/10500)));while(particles.length<target)particles.push(makeParticle());particles.length=target}function makeParticle(){var t=Math.random()<0.08;return{x:rand(0,w),y:rand(0,h),vx:rand(-0.12,0.12),vy:rand(-0.10,0.10),r:rand(0.55,1.65),a:rand(0.35,0.9),theme:t}}function step(){if(!running)return;var c=theme();ctx.clearRect(0,0,w,h);ctx.fillStyle="#05060b";ctx.fillRect(0,0,w,h);var max=Math.min(150,Math.max(105,w/9));for(var i=0;i<particles.length;i++){var p=particles[i];p.x+=p.vx;p.y+=p.vy;if(p.x<-10)p.x=w+10;if(p.x>w+10)p.x=-10;if(p.y<-10)p.y=h+10;if(p.y>h+10)p.y=-10}ctx.lineWidth=0.6;for(var i=0;i<particles.length;i++){for(var j=i+1;j<particles.length;j++){var p=particles[i],q=particles[j],dx=p.x-q.x,dy=p.y-q.y,dist=Math.sqrt(dx*dx+dy*dy);if(dist<max){var o=(1-dist/max)*0.16;if(o<0.018)continue;ctx.strokeStyle="rgba("+(p.theme||q.theme?c.join(","):"235,240,255")+","+o+")";ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}}}for(var i=0;i<particles.length;i++){var p=particles[i],col=p.theme?c.join(","):"245,248,255";ctx.beginPath();ctx.fillStyle="rgba("+col+","+p.a+")";ctx.shadowColor="rgba("+col+",0.22)";ctx.shadowBlur=p.theme?7:4;ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()}ctx.shadowBlur=0;raf=requestAnimationFrame(step)}window.addEventListener("resize",resize,{passive:true});document.addEventListener("visibilitychange",function(){running=!document.hidden;if(running){cancelAnimationFrame(raf);step()}});resize();step()})();' +
      'document.getElementById("searchInput").addEventListener("keydown",function(e){if(e.key==="Enter"){var q=this.value.trim();if(q&&window.parent&&window.parent.VoltraBrowser){window.parent.VoltraBrowser.navigate(q)}}});' +
      'document.querySelectorAll(".card").forEach(function(c){c.addEventListener("click",function(){var u=this.getAttribute("data-url");if(u&&window.parent&&window.parent.VoltraBrowser){window.parent.VoltraBrowser.navigate(u)}})});' +
    '<\/script></body></html>';
  }

  /**
   * Generate the Orbit internal settings page HTML (embedded via srcdoc).
   * Self-contained; communicates changes via parent.VoltraBrowser.
   */
  function getSettingsPageSrcDoc() {
    var seOptions = '';
    var seKeys = Object.keys(SEARCH_ENGINES);
    for (var i = 0; i < seKeys.length; i++) {
      var key = seKeys[i];
      var eng = SEARCH_ENGINES[key];
      var selected = browserSettings.searchEngine === key ? ' class="se-opt se-opt-active"' : ' class="se-opt"';
      seOptions += '<div' + selected + ' data-key="' + key + '"><img src="' + eng.icon + '" alt=""><span>' + eng.name + '</span></div>';
    }

    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Orbit Settings</title><style>' +
      '*{margin:0;padding:0;box-sizing:border-box}' +
      'html,body{height:100%;background:#0a0a0f;color:#fff;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;font-weight:300}' +
      '.wrap{display:flex;flex-direction:column;max-width:560px;margin:0 auto;padding:40px 20px}' +
      '.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}' +
      '.header h1{font-size:1.25rem;font-weight:400;letter-spacing:0.02em;color:rgba(255,255,255,0.85)}' +
      '.header button{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:#fff;padding:8px 18px;border-radius:10px;cursor:pointer;font-size:0.8rem;font-weight:300;transition:background 0.15s ease}' +
      '.header button:hover{background:rgba(255,255,255,0.12)}' +
      '.section{margin-bottom:28px}' +
      '.section-title{font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.28);margin-bottom:14px}' +
      '.card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 18px;margin-bottom:8px}' +
      '.card-row{display:flex;align-items:center;justify-content:space-between;gap:14px}' +
      '.card-label{font-size:0.85rem;color:rgba(255,255,255,0.78);font-weight:300}' +
      '.card-desc{font-size:0.72rem;color:rgba(255,255,255,0.35);margin-top:4px;font-weight:300}' +
      /* Search engine selector */
      '.se-selector{position:relative;cursor:pointer}' +
      '.se-trigger{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;transition:background 0.15s ease,border-color 0.15s ease}' +
      '.se-trigger:hover{background:rgba(255,255,255,0.07);border-color:rgba(255,255,255,0.14)}' +
      '.se-trigger img{width:18px;height:18px;border-radius:3px}' +
      '.se-trigger span{font-size:0.85rem;color:rgba(255,255,255,0.78);font-weight:300}' +
      '.se-trigger .arrow{margin-left:auto;font-size:0.6rem;color:rgba(255,255,255,0.3);transition:transform 0.2s ease}' +
      '.se-trigger .arrow.open{transform:rotate(180deg)}' +
      '.se-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:rgba(22,22,28,0.96);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:4px;z-index:10;opacity:0;visibility:hidden;transform:translateY(-4px) scale(0.96);transition:opacity 0.12s ease,transform 0.2s cubic-bezier(0.34,1.56,0.64,1),visibility 0s 0.2s}' +
      '.se-dropdown.open{opacity:1;visibility:visible;transform:translateY(0) scale(1);transition:opacity 0.12s ease,transform 0.25s cubic-bezier(0.34,1.56,0.64,1),visibility 0s}' +
      '.se-opt{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;cursor:pointer;transition:background 0.12s ease,transform 0.12s ease;font-weight:300}' +
      '.se-opt:hover{background:rgba(255,255,255,0.07);transform:scale(1.02)}' +
      '.se-opt img{width:16px;height:16px;border-radius:2px}' +
      '.se-opt span{font-size:0.82rem;color:rgba(255,255,255,0.7)}' +
      '.se-opt-active{background:rgba(var(--accent-a,255,255,255),0.1)}' +
      '.se-opt-active span{color:#fff}' +
      /* Toggle switch */
      '.toggle{position:relative;width:40px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.1);border-radius:11px;cursor:pointer;transition:background 0.25s ease}' +
      '.toggle.on{background:rgba(255,255,255,0.55)}' +
      '.toggle::after{content:\'\';position:absolute;top:2px;left:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:transform 0.25s cubic-bezier(0.34,1.56,0.64,1);box-shadow:0 1px 3px rgba(0,0,0,0.3)}' +
      '.toggle.on::after{transform:translateX(18px)}' +
    '</style></head><body><div class="wrap">' +
      '<div class="header"><h1>Settings</h1><button onclick="window.parent.VoltraBrowser.goHome()">Done</button></div>' +
      /* Search Engine */
      '<div class="section"><div class="section-title">Search Engine</div><div class="card"><div class="card-label" style="margin-bottom:10px">Default search engine</div>' +
      '<div class="se-selector" id="seSelector"><div class="se-trigger" id="seTrigger">' +
      '<img src="' + SEARCH_ENGINES[browserSettings.searchEngine].icon + '"><span>' + SEARCH_ENGINES[browserSettings.searchEngine].name + '</span><span class="arrow" id="seArrow">&#9660;</span>' +
      '</div><div class="se-dropdown" id="seDropdown">' + seOptions + '</div></div></div></div>' +
      /* Bookmarks */
      '<div class="section"><div class="section-title">Bookmarks Bar</div><div class="card"><div class="card-row">' +
      '<div><div class="card-label">Auto-hide bookmarks bar</div><div class="card-desc">Hide when not hovered</div></div>' +
      '<div class="toggle' + (browserSettings.bookmarksAutoHide ? ' on' : '') + '" data-key="bookmarksAutoHide"></div>' +
      '</div></div></div>' +
      /* Notifications */
      '<div class="section"><div class="section-title">Notifications</div>' +
      '<div class="card"><div class="card-row"><div><div class="card-label">Enable notifications</div><div class="card-desc">Show Orbit notification hub alerts</div></div><div class="toggle' + (browserSettings.notificationsEnabled ? ' on' : '') + '" data-key="notificationsEnabled"></div></div></div>' +
      '<div class="card"><div class="card-row"><div><div class="card-label">Proxy status</div><div class="card-desc">Alert when proxy connects or fails</div></div><div class="toggle' + (browserSettings.proxyStatusNotifications ? ' on' : '') + '" data-key="proxyStatusNotifications"></div></div></div>' +
      '<div class="card"><div class="card-row"><div><div class="card-label">Theme changes</div><div class="card-desc">Notify when accent theme changes</div></div><div class="toggle' + (browserSettings.themeChangeNotifications ? ' on' : '') + '" data-key="themeChangeNotifications"></div></div></div>' +
      '<div class="card"><div class="card-row"><div><div class="card-label">Game launch</div><div class="card-desc">Notify when a game starts loading</div></div><div class="toggle' + (browserSettings.gameLaunchNotifications ? ' on' : '') + '" data-key="gameLaunchNotifications"></div></div></div>' +
      '</div>' +
    '</div>' +
    '<script>' +
      'var sel=document.getElementById("seSelector");var trig=document.getElementById("seTrigger");var drop=document.getElementById("seDropdown");var arr=document.getElementById("seArrow");' +
      'trig.addEventListener("click",function(e){e.stopPropagation();var o=drop.classList.toggle("open");arr.classList.toggle("open",o)});' +
      'document.addEventListener("click",function(){drop.classList.remove("open");arr.classList.remove("open")});' +
      'drop.querySelectorAll(".se-opt").forEach(function(el){el.addEventListener("click",function(){' +
        'var key=this.getAttribute("data-key");' +
        'if(window.parent&&window.parent.VoltraBrowser&&window.parent.VoltraBrowser.updateBrowserSetting){' +
          'window.parent.VoltraBrowser.updateBrowserSetting("searchEngine",key);' +
        '}' +
        'drop.querySelectorAll(".se-opt").forEach(function(o){o.classList.remove("se-opt-active")});' +
        'this.classList.add("se-opt-active");' +
        'document.getElementById("seTrigger").innerHTML="<img src=\\\""+this.querySelector("img").src+"\\\"><span>"+this.querySelector("span").textContent+"</span><span class=\\\"arrow\\\" id=\\\"seArrow\\\">&#9660;</span>";' +
        'arr=document.getElementById("seArrow");' +
        'drop.classList.remove("open");' +
      '})});' +
      'document.querySelectorAll(".toggle").forEach(function(t){t.addEventListener("click",function(){' +
        'var key=this.getAttribute("data-key");var on=this.classList.toggle("on");' +
        'if(window.parent&&window.parent.VoltraBrowser&&window.parent.VoltraBrowser.updateBrowserSetting){' +
          'window.parent.VoltraBrowser.updateBrowserSetting(key,on);' +
        '}' +
      '})});' +
    '<\/script></body></html>';
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
    if (targetUrl === 'orbit://settings') return targetUrl;
    if (targetUrl === 'orbit://home') return targetUrl;
    
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
      // Start fresh every launch — never restore last visited website
      this.historyManager.clearAll();
      this.historyManager.push('main', BRAVE_HOME_INTERNAL, 'Home');
      this.bookmarkManager = new BookmarkManager();
      this._onUrlChange = null;
      this._pendingRestoreTabs = [];
      this._pendingNavigations = [];
      loadBrowserSettings();
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
                <div class="browser-search-engine-dropdown" id="searchEngineDropdown">
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
                  placeholder="Enter URL or search"
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
      // Intercept internal pages before InputParser (avoids search/proxy/UV)
      if (url === BRAVE_HOME_INTERNAL || url === '' || url === 'orbit://home') {
        this._loadUrlInFrame(url);
        this.historyManager.push('main', BRAVE_HOME_INTERNAL, 'Home');
        this.updateAddressBar('');
        this.updateNavButtons();
        this._updateBookmarkBtn();
        return;
      }

      if (url === 'orbit://settings') {
        this._loadSettings();
        this.historyManager.push('main', 'orbit://settings', 'Settings');
        this.updateAddressBar('');
        this.updateNavButtons();
        this._updateBookmarkBtn();
        return;
      }

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

      this.updateAddressBar(this._isInternalPage(targetUrl) ? '' : targetUrl);
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
        dropdown.classList.toggle('open');
      }
      // Close menu dropdown if open
      const menu = document.getElementById('browserMenuDropdown');
      if (menu) {
        menu.classList.remove('open');
      }
    }

    selectSearchEngine(engineKey) {
      engineKey = normalizeSearchEngineKey(engineKey);
      browserSettings.searchEngine = engineKey;
      setSearchEngine(engineKey);
      saveBrowserSettings();
      const icon = document.getElementById('searchEngineIcon');
      if (icon) {
        icon.src = getSearchEngine().icon;
      }
      const dropdown = document.getElementById('searchEngineDropdown');
      if (dropdown) {
        dropdown.classList.remove('open');
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
      this.toggleMenu();
      this.navigate('orbit://settings');
    }

    appearance() {
      this.toggleMenu();
      this.navigate('orbit://settings');
    }

    browserPreferences() {
      this.toggleMenu();
      this.navigate('orbit://settings');
    }

    duplicateTab() {
      // Tab system removed
    }

    goBack() {
      const entry = this.historyManager.back('main');
      if (entry) {
        this._loadUrlInFrame(entry.url);
        this.updateAddressBar(this._isInternalPage(entry.url) ? '' : entry.url);
        this.updateNavButtons();
        this._updateBookmarkBtn();
      }
    }

    goForward() {
      const entry = this.historyManager.forward('main');
      if (entry) {
        this._loadUrlInFrame(entry.url);
        this.updateAddressBar(this._isInternalPage(entry.url) ? '' : entry.url);
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

    _showErrorPage(status, title, detail) {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe) return;
      const escapedTitle = String(title).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const escapedDetail = String(detail).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      iframe.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbit — ' + status + '</title><style>body{margin:0;background:#0d0d12;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.error-card{background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;padding:32px;max-width:480px;width:90%;text-align:center}.error-icon{width:48px;height:48px;margin:0 auto 16px;color:#ff6b6b}.error-code{font-size:14px;color:#888;margin-bottom:4px}.error-title{font-size:20px;font-weight:600;margin-bottom:12px}.error-detail{font-size:13px;color:#888;line-height:1.5;margin-bottom:24px}.error-retry{background:#2a2a3a;color:#e0e0e0;border:1px solid #3a3a4a;border-radius:8px;padding:10px 24px;font-size:14px;cursor:pointer}.error-retry:hover{background:#3a3a4a}</style></head><body><div class="error-card"><svg class="error-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><div class="error-code">' + status + '</div><div class="error-title">' + escapedTitle + '</div><div class="error-detail">' + escapedDetail + '</div><button class="error-retry" onclick="parent.VoltraBrowser.refresh()">Retry</button></div></body></html>';
    }

    handleFrameLoad() {
      this.hideLoading();
      if (this._frameLoadTimeout) {
        clearTimeout(this._frameLoadTimeout);
        this._frameLoadTimeout = null;
      }
      const iframe = document.getElementById('browserFrame-main');
      try {
        if (iframe && iframe.contentDocument && iframe.contentDocument.title) {
          // title extracted but no tab bar to update
        }
      } catch (e) {
        // cross-origin
      }
      const currentUrl = this.historyManager.getCurrentUrl('main');
      this.updateAddressBar(this._isInternalPage(currentUrl) ? '' : currentUrl);
      this.updateNavButtons();
      this._updateBookmarkBtn();
    }

    handleFrameError() {
      this.hideLoading();
      if (this._frameLoadTimeout) {
        clearTimeout(this._frameLoadTimeout);
        this._frameLoadTimeout = null;
      }
      this._showErrorPage('Error', 'This page could not be loaded', 'The proxy was unable to retrieve the requested page. Please check your connection and try again.');
    }

    _loadSettings() {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe) return;
      iframe.srcdoc = getSettingsPageSrcDoc();
      this.updateAddressBar('');
      this.updateNavButtons();
    }

    updateBrowserSetting(key, value) {
      if (key === 'searchEngine') {
        const normalized = normalizeSearchEngineKey(value);
        browserSettings[key] = normalized;
        setSearchEngine(normalized);
        saveBrowserSettings();
        // Update search engine icon in address bar if visible
        var icon = document.getElementById('searchEngineIcon');
        if (icon) icon.src = getSearchEngine().icon;
        return;
      }

      browserSettings[key] = value;
      saveBrowserSettings();

      // Apply settings that need UI changes
      if (key === 'bookmarksAutoHide') {
        this._applyBookmarksAutoHide(value);
      }
    }

    _applyBookmarksAutoHide(enabled) {
      var bar = document.getElementById('browserBookmarksBar');
      if (!bar) return;
      bar.classList.toggle('auto-hide', enabled);
    }

    _isPortReady() {
      return window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;
    }

    _loadUrlInFrame(url) {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe) return;

      if (isBraveHome(url)) {
        iframe.srcdoc = getBraveHomeSrcDoc();
        this.updateAddressBar('');
        this.updateNavButtons();
        return;
      }

      if (url === 'orbit://settings') {
        iframe.srcdoc = getSettingsPageSrcDoc();
        this.updateAddressBar('');
        this.updateNavButtons();
        return;
      }

      const normalized = normalizeUrl(url);
      const useUv = shouldUseUV(normalized) && typeof window.encodeUVUrl === 'function';

      // Defer proxied navigation until the UV proxy stack is ready
      if (useUv && !this._isPortReady()) {
        console.log('[DEFER-NAV] url=' + url + ' port not ready, queuing at ' + Date.now());
        if (!this._pendingNavigations.find(n => n.url === url)) {
          this._pendingNavigations.push({ url, normalized, ts: Date.now() });
        }
        return;
      }

      this.showLoading();
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
      if (this._frameLoadTimeout) clearTimeout(this._frameLoadTimeout);
      this._frameLoadTimeout = setTimeout(() => {
        if (iframe && iframe.src && iframe.src === finalSrc) {
          try {
            if (iframe.contentDocument && iframe.contentDocument.body && iframe.contentDocument.body.innerHTML.length > 100) {
              return;
            }
          } catch(e) {}
          console.warn('[SLOW FRAME LOAD]', 'Page is still loading after 20000ms:', normalized);
        }
      }, 20000);
      iframe.src = finalSrc;
      this.updateNavButtons();
    }

    _flushPendingNavigations() {
      const pending = this._pendingNavigations || [];
      this._pendingNavigations = [];
      if (pending.length === 0) return;
      console.log('[FLUSH-NAV] flushing ' + pending.length + ' deferred navigation(s) at ' + Date.now());
      pending.forEach(({ url }) => {
        this._loadUrlInFrame(url);
      });
    }

    _restoreTabUrl(url) {
      const iframe = document.getElementById('browserFrame-main');
      if (!iframe || !url || url === 'about:blank') return;

      if (isBraveHome(url)) {
        iframe.srcdoc = getBraveHomeSrcDoc();
        this.updateAddressBar('');
        console.log('[RESTORE] restored home');
        return;
      }

      if (url === 'orbit://settings') {
        iframe.srcdoc = getSettingsPageSrcDoc();
        this.updateAddressBar('');
        console.log('[RESTORE] restored settings');
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

    _isInternalPage(url) {
      return isBraveHome(url) || url === 'orbit://settings';
    }

    _rebuildAll() {
      const container = document.getElementById('browserContainer');
      if (!container) return;
      container.outerHTML = this.buildHTML();

      const mainUrl = this.historyManager.getCurrentUrl('main');
      this.updateAddressBar(this._isInternalPage(mainUrl) ? '' : (mainUrl || ''));
      this.updateNavButtons();

      this._renderBookmarksBar();
      this._applyBookmarksAutoHide(browserSettings.bookmarksAutoHide);
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

      const mainUrl = this.historyManager.getCurrentUrl('main');
      this.updateAddressBar(this._isInternalPage(mainUrl) ? '' : (mainUrl || ''));
      this.updateNavButtons();

      this._renderBookmarksBar();
      this._applyBookmarksAutoHide(browserSettings.bookmarksAutoHide);
      this._updateBookmarkBtn();

      const bar = document.getElementById('browserLoadingBar');
      if (bar) bar.classList.remove('loading', 'loaded');

      // Restoration pass: load persisted URL through UV proxy
      if (mainUrl && mainUrl !== 'about:blank' && !this._isInternalPage(mainUrl)) {
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

    // Browser settings
    updateBrowserSetting: (key, value) => browserUI.updateBrowserSetting(key, value),
    getSetting: (key) => browserSettings[key],

    // Render
    render: (container) => browserUI.render(container),
    
    // Internal reference for state checks
    _browserUI: browserUI,
    _historyManager: browserUI.historyManager
  };

})();
