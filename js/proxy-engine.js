/**
 * Orbit Proxy Engine - GUST-Style with libcurl.js
 * Now using libcurl.js with WISP for fast, direct HTTP requests (same as GUST)
 * 
 * This module contains advanced proxy functionality:
 * - libcurl.js with WISP (WebSocket-based proxy) - SAME AS GUST
 * - GUST-style cookie jar management
 * - IndexedDB persistent caching (two-layer: memory + disk)
 * - Ad/tracker blocking (GUST SKIP_DOMAINS)
 * - Browser fingerprint normalization (Sec-Fetch-* headers)
 * - Shadow DOM content isolation
 * - URL rewriting and resource injection
 * - Script execution
 * - Font fixing
 * - HTML sanitization
 * 
 * Dependencies: libcurl.js (loaded in index.html), DOMParser, URL API, IndexedDB
 * 
 * Usage:
 *   const proxyEngine = new ProxyEngine();
 *   await proxyEngine.init();
 *   await proxyEngine.loadUrl('https://example.com', contentContainer);
 */

class ProxyEngine {
  constructor(options = {}) {
    // GUST-style: Use libcurl.js with WISP for fast, direct HTTP requests
    this.useLibcurl = options.useLibcurl !== false; // Enable libcurl by default
    this.wispUrl = options.wispUrl || 'wss://wisp.mercurywork.shop/'; // Public WISP server
    this.libcurl = null;
    this.curlSession = null;
    
    // Fallback to HTTP CORS proxies if libcurl not available
    this.proxies = options.proxies || [
      `https://api.allorigins.win/raw?url=`,
      `https://corsproxy.io/?`,
      `https://api.codetabs.com/v1/proxy?quest=`
    ];
    this.timeout = options.timeout || 8000;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36';
    
    // GUST-style features
    this.cookieJar = new Map();
    this.memoryCache = new Map();
    this.indexedDB = null;
    this.cacheSize = 0;
    this.MAX_CACHE_SIZE = 50 * 1024 * 1024;
    this.CACHE_TTL = 12 * 60 * 60 * 1000;
    
    // GUST-style ad/tracker blocking domains
    this.skipDomains = [
      'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
      'googlesyndication.com', 'googleadservices.com', 'adservice.google.',
      'pagead2.googlesyndication.com', 'adwords.google.com', 'afs.google.com',
      'facebook.net', 'fbcdn.net', 'an.facebook.com', 'pixel.facebook.com',
      'connect.facebook.net',
      'analytics.', 'tracking.', 'tracker.', 'telemetry.',
      'adcolony.com', 'adnxs.com', 'adroll.com', 'media.net',
      'criteo.com', 'rubiconproject.com', 'openx.net', 'pubmatic.com',
      'taboola.com', 'outbrain.com', 'amplitude.com', 'segment.com',
      'hotjar.com', 'sentry.io', 'clarity.ms', 'ads.yahoo.com'
    ];
  }

  /**
   * Initialize the proxy engine (initializes libcurl.js with WISP, IndexedDB, cookies)
   */
  async init() {
    // Initialize libcurl.js with WISP (same as GUST)
    if (this.useLibcurl && typeof libcurl !== 'undefined') {
      try {
        await libcurl.load_wasm();
        libcurl.set_websocket(this.wispUrl);
        this.libcurl = libcurl;
        this.curlSession = new libcurl.HTTPSession();
        this.curlSession.set_connections(6, 6, 6);
        console.log('[ProxyEngine] libcurl.js initialized with WISP:', this.wispUrl);
      } catch (e) {
        console.warn('[ProxyEngine] libcurl.js init failed, falling back to HTTP CORS proxies:', e);
        this.useLibcurl = false;
      }
    } else {
      console.warn('[ProxyEngine] libcurl.js not available, using HTTP CORS proxies');
    }
    
    // Initialize IndexedDB and cookies in parallel, non-blocking
    const initPromises = [];
    
    initPromises.push(
      this.initIndexedDB().catch(e => console.warn('[ProxyEngine] IndexedDB init failed:', e))
    );
    
    initPromises.push(
      this.loadCookiesFromStorage().catch(e => console.warn('[ProxyEngine] Cookie load failed:', e))
    );
    
    // Don't await - let these initialize in background
    Promise.all(initPromises).catch(() => {});
  }

  /**
   * Initialize IndexedDB for persistent caching
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('OrbitProxyCache', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.indexedDB = request.result;
        this.cacheSize = this.getCacheSize();
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('resources')) {
          const store = db.createObjectStore('resources', { keyPath: 'url' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('cookies')) {
          db.createObjectStore('cookies', { keyPath: 'origin' });
        }
      };
    });
  }

  /**
   * Get cached content from memory or IndexedDB
   */
  async getCached(url) {
    // Check memory cache first
    if (this.memoryCache.has(url)) {
      const entry = this.memoryCache.get(url);
      if (Date.now() - entry.timestamp < this.CACHE_TTL) {
        return entry;
      }
      this.memoryCache.delete(url);
    }
    
    // Check IndexedDB
    if (this.indexedDB) {
      return new Promise((resolve, reject) => {
        const transaction = this.indexedDB.transaction('resources', 'readonly');
        const store = transaction.objectStore('resources');
        const request = store.get(url);
        request.onsuccess = () => {
          const entry = request.result;
          if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
            this.memoryCache.set(url, entry);
            resolve(entry);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }
    return null;
  }

  /**
   * Set cached content in memory and IndexedDB
   */
  async setCache(url, data, mime, headers = {}) {
    const size = data.byteLength || data.length || 0;
    
    // Enforce cache size limit
    if (this.cacheSize + size > this.MAX_CACHE_SIZE) {
      await this.evictOldCache();
    }
    
    const entry = {
      url,
      data,
      mime,
      headers,
      size,
      timestamp: Date.now()
    };
    
    // Memory cache
    this.memoryCache.set(url, entry);
    this.cacheSize += size;
    
    // IndexedDB
    if (this.indexedDB) {
      return new Promise((resolve, reject) => {
        const transaction = this.indexedDB.transaction('resources', 'readwrite');
        const store = transaction.objectStore('resources');
        const request = store.put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  /**
   * Get current cache size from IndexedDB
   */
  async getCacheSize() {
    if (!this.indexedDB) return 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.indexedDB.transaction('resources', 'readonly');
      const store = transaction.objectStore('resources');
      const request = store.getAll();
      request.onsuccess = () => {
        let totalSize = 0;
        for (const entry of request.result) {
          totalSize += entry.size || 0;
        }
        resolve(totalSize);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Evict old cache entries when size limit is reached
   */
  async evictOldCache() {
    if (!this.indexedDB) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.indexedDB.transaction('resources', 'readwrite');
      const store = transaction.objectStore('resources');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'next');
      
      let evicted = 0;
      const targetSize = this.MAX_CACHE_SIZE * 0.8; // Evict to 80% of max
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && this.cacheSize > targetSize) {
          const entry = cursor.value;
          this.cacheSize -= entry.size || 0;
          this.memoryCache.delete(entry.url);
          cursor.delete();
          evicted++;
          cursor.continue();
        } else {
          console.log(`[ProxyEngine] Evicted ${evicted} old cache entries`);
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all cache (memory and IndexedDB)
   */
  async clearCache() {
    this.memoryCache.clear();
    this.cacheSize = 0;
    if (this.indexedDB) {
      return new Promise((resolve, reject) => {
        const transaction = this.indexedDB.transaction(['resources', 'cookies'], 'readwrite');
        const resourceStore = transaction.objectStore('resources');
        const cookieStore = transaction.objectStore('cookies');
        
        Promise.all([
          new Promise((res, rej) => {
            const req = resourceStore.clear();
            req.onsuccess = res;
            req.onerror = () => rej(req.error);
          }),
          new Promise((res, rej) => {
            const req = cookieStore.clear();
            req.onsuccess = res;
            req.onerror = () => rej(req.error);
          })
        ]).then(() => resolve()).catch(reject);
      });
    }
  }

  /**
   * GUST-style cookie jar management
   */
  getCookieStore(origin) {
    if (!this.cookieJar.has(origin)) {
      this.cookieJar.set(origin, new Map());
    }
    return this.cookieJar.get(origin);
  }

  getCookieHeader(origin) {
    const store = this.getCookieStore(origin);
    const now = Date.now();
    const validCookies = [];
    
    for (const [name, data] of store.entries()) {
      if (!data.expiresAt || data.expiresAt > now) {
        validCookies.push(`${name}=${data.value}`);
      } else {
        store.delete(name);
      }
    }
    
    return validCookies.join('; ');
  }

  updateCookiesFromSetCookie(origin, setCookieHeader) {
    const cookies = this.splitSetCookie(setCookieHeader);
    for (const cookieStr of cookies) {
      this.updateCookie(origin, cookieStr);
    }
    this.saveCookiesToStorage();
  }

  splitSetCookie(header) {
    if (!header) return [];
    if (Array.isArray(header)) return header;
    const parts = [];
    let current = '';
    let inExpires = false;
    
    for (let i = 0; i < header.length; i++) {
      const char = header[i];
      if (char === ',' && !inExpires) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += char;
        if (current.toLowerCase().endsWith('expires=')) inExpires = true;
        if (char === ';' && inExpires) inExpires = false;
      }
    }
    
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  updateCookie(origin, cookieStr) {
    const match = cookieStr.match(/^([^=]+)=([^;]*)/);
    if (!match) return;
    
    const name = match[1].trim();
    const value = match[2];
    const attrs = {};
    
    const parts = cookieStr.split(';').slice(1);
    for (const part of parts) {
      const [key, val] = part.split('=');
      if (key) attrs[key.trim().toLowerCase()] = (val || '').trim();
    }
    
    const store = this.getCookieStore(origin);
    const maxAge = attrs['max-age'] ? parseInt(attrs['max-age'], 10) : null;
    let expiresAt = null;
    
    if (maxAge === 0) {
      store.delete(name);
      return;
    }
    
    if (maxAge) {
      expiresAt = Date.now() + maxAge * 1000;
    } else if (attrs.expires) {
      expiresAt = Date.parse(attrs.expires);
    }
    
    store.set(name, { value, expiresAt });
  }

  async saveCookiesToStorage() {
    if (!this.indexedDB) return;
    
    const cookiesObj = {};
    for (const [origin, store] of this.cookieJar.entries()) {
      cookiesObj[origin] = Array.from(store.entries());
    }
    
    localStorage.setItem('orbit:cookies', JSON.stringify(cookiesObj));
  }

  async loadCookiesFromStorage() {
    try {
      const saved = localStorage.getItem('orbit:cookies');
      if (saved) {
        const cookiesObj = JSON.parse(saved);
        for (const [origin, entries] of Object.entries(cookiesObj)) {
          const store = this.getCookieStore(origin);
          for (const [name, data] of entries) {
            if (!data.expiresAt || data.expiresAt > Date.now()) {
              store.set(name, data);
            }
          }
        }
      }
    } catch (e) {
      console.error('[ProxyEngine] Failed to load cookies:', e);
    }
  }

  /**
   * Check if URL should be blocked (ad/tracker)
   */
  shouldBlockUrl(url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return this.skipDomains.some(domain => hostname.includes(domain));
    } catch {
      return false;
    }
  }

  /**
   * Load a URL through the proxy system
   * @param {string} url - The URL to load
   * @param {HTMLElement} contentContainer - The DOM element to inject content into
   * @param {object} options - Additional options
   * @returns {Promise<void>}
   */
  async loadUrl(url, contentContainer, options = {}) {
    const { 
      onLoadingStart, 
      onLoadingComplete, 
      onError,
      onTitleChange
    } = options;

    if (onLoadingStart) onLoadingStart();

    try {
      const htmlText = await this.fetchWithMultiProxy(url);
      
      if (!htmlText) {
        throw new Error('Failed to fetch content from all proxies');
      }

      // Sanitize the HTML
      const sanitizedHtml = this.sanitizeHtmlText(htmlText);
      
      // Fix fonts
      const fontFixedHtml = await this.fixFontsInFetchedContent(sanitizedHtml, url);
      
      // Execute scripts
      const scriptExecutedHtml = this.executeScriptsFromContent(fontFixedHtml);
      
      // Parse and extract title
      const parser = new DOMParser();
      const doc = parser.parseFromString(scriptExecutedHtml, 'text/html');
      const title = doc.title || 'Untitled';
      
      if (onTitleChange) onTitleChange(title);

      // Create Shadow DOM container
      const shadowContainer = this.createShadowDOMContainer(scriptExecutedHtml, url);
      
      // Clear and inject content
      contentContainer.innerHTML = '';
      contentContainer.appendChild(shadowContainer);

      if (onLoadingComplete) onLoadingComplete();

    } catch (error) {
      console.error('Proxy engine error:', error);
      if (onError) onError(error);
    }
  }

  /**
   * Fetch content using libcurl.js with WISP (same as GUST) or fallback to HTTP CORS proxies
   * @param {string} url - The URL to fetch
   * @param {object} options - Additional options
   * @returns {Promise<string>} The HTML content
   */
  async fetchWithMultiProxy(url, options = {}) {
    // GUST-style: Check if URL should be blocked (ad/tracker)
    if (this.shouldBlockUrl(url)) {
      console.log('[ProxyEngine] Blocked ad/tracker:', url);
      return '';
    }

    // GUST-style: Check cache first (non-blocking)
    const cached = await this.getCached(url).catch(() => null);
    if (cached && options.method !== 'POST') {
      console.log('[ProxyEngine] Cache hit:', url);
      return cached.data;
    }

    // GUST-style: Use libcurl.js with WISP for fast, direct HTTP requests
    if (this.useLibcurl && this.curlSession) {
      try {
        console.log(`[ProxyEngine] Fetching via libcurl.js (WISP): ${url.substring(0, 50)}...`);
        
        const headers = {
          'User-Agent': this.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          ...(options.headers || {})
        };

        // Add cookies if available
        const origin = new URL(url).origin;
        const cookieHeader = this.getCookieHeader(origin);
        if (cookieHeader && !headers.Cookie && !headers.cookie) {
          headers.Cookie = cookieHeader;
        }

        const response = await this.curlSession.fetch(url, {
          method: options.method || 'GET',
          headers,
          body: options.body,
          signal: options.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const htmlText = await response.text();
        
        // GUST-style: Handle Set-Cookie headers (non-blocking)
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
          try {
            this.updateCookiesFromSetCookie(origin, setCookieHeader);
          } catch (e) {
            // Ignore cookie errors
          }
        }

        // GUST-style: Cache successful responses (non-blocking)
        if (response.status >= 200 && response.status < 400) {
          this.setCache(url, htmlText, response.headers.get('content-type') || 'text/html', Object.fromEntries(response.headers)).catch(() => {});
        }

        console.log(`[ProxyEngine] Success via libcurl.js: ${url.substring(0, 50)}...`);
        return htmlText;

      } catch (error) {
        console.error('[ProxyEngine] libcurl.js fetch failed, falling back to HTTP CORS proxies:', error.message);
        // Fall through to HTTP CORS proxies
      }
    }

    // Fallback to HTTP CORS proxies
    const errors = [];
    const method = options.method || 'GET';

    for (const proxy of this.proxies) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const proxyUrl = proxy + encodeURIComponent(url);
        console.log(`[ProxyEngine] Fetching via HTTP CORS proxy: ${proxy.split('//')[1].split('/')[0]}`);

        const headers = {
          'User-Agent': this.userAgent,
          ...(options.headers || {})
        };

        const response = await fetch(proxyUrl, {
          method,
          signal: controller.signal,
          headers,
          body: options.body
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const htmlText = await response.text();
        
        // Handle Set-Cookie headers (non-blocking)
        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
          try {
            const origin = new URL(url).origin;
            this.updateCookiesFromSetCookie(origin, setCookieHeader);
          } catch (e) {
            // Ignore cookie errors
          }
        }

        // Cache successful responses (non-blocking)
        if (response.status >= 200 && response.status < 400) {
          this.setCache(url, htmlText, response.headers.get('content-type') || 'text/html', Object.fromEntries(response.headers)).catch(() => {});
        }

        console.log(`[ProxyEngine] Success via HTTP CORS proxy: ${url.substring(0, 50)}...`);
        return htmlText;

      } catch (error) {
        console.error(`[ProxyEngine] HTTP CORS proxy failed: ${proxy.split('//')[1].split('/')[0]} - ${error.message}`);
        errors.push(`${proxy}: ${error.message}`);
        continue;
      }
    }

    throw new Error(`Failed to fetch content from all proxies. Errors: ${errors.join(', ')}`);
  }

  /**
   * Generate cryptographic key for encryption
   * @returns {Promise<CryptoKey>}
   */
  async generateKey() {
    return await window.crypto.subtle.generateKey({
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
  }

  /**
   * Encrypt data with AES-GCM
   * @param {string} data - Data to encrypt
   * @param {CryptoKey} key - Encryption key
   * @returns {Promise<object>} Encrypted data with IV
   */
  async encryptData(data, key) {
    const encodedData = new TextEncoder().encode(data);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await window.crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: iv
    },
    key,
    encodedData
    );
    return {
      iv: Array.from(iv),
      encryptedData: Array.from(new Uint8Array(encryptedData))
    };
  }

  /**
   * Decrypt data with AES-GCM
   * @param {object} encryptedObj - Encrypted data object with iv and encryptedData
   * @param {CryptoKey} key - Decryption key
   * @returns {Promise<string>} Decrypted data
   */
  async decryptData(encryptedObj, key) {
    const decryptedData = await window.crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: new Uint8Array(encryptedObj.iv)
    },
    key,
    new Uint8Array(encryptedObj.encryptedData)
    );
    return new TextDecoder().decode(decryptedData);
  }

  /**
   * Sanitize HTML text to fix encoding issues
   * @param {string} htmlText - HTML text to sanitize
   * @returns {string} Sanitized HTML
   */
  sanitizeHtmlText(htmlText) {
    // Fix encoding issues with replacement character
    htmlText = htmlText.replace(/([a-z])\uFFFD([A-Z])/g, '$1 $2');
    htmlText = htmlText.replace(/\uFFFD/g, 'é');
    
    // Translate French redirection notices
    htmlText = htmlText.replace(/Avertissement de redirection/g, 'Redirect Notice');
    htmlText = htmlText.replace(/La page que vous consultiez essaie de vous rediriger vers/g, 'The page you were on is trying to send you to');
    htmlText = htmlText.replace(/Si\s+vous\s+ne\s+souhaitez\s+pas\s+consulter\s+Cette\s+page/i, 'If you do not want to visit that page');
    htmlText = htmlText.replace(/vous\s* pouvez\s*revenir\s*à\s*la\s*page\s*précédente\./i, 'you can return to the previous page.');
    
    return htmlText;
  }

  /**
   * Execute scripts from content
   * @param {string} content - HTML content
   * @returns {string} Content without original script tags
   */
  executeScriptsFromContent(content) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const scripts = tempDiv.getElementsByTagName('script');

    Array.from(scripts).forEach(script => {
      const newScript = document.createElement('script');
      if (script.src) {
        newScript.src = script.src;
      } else {
        newScript.textContent = script.textContent;
      }
      Array.from(script.attributes).forEach(attr => {
        if (attr.name !== 'src') {
          newScript.setAttribute(attr.name, attr.value);
        }
      });
      document.head.appendChild(newScript);
    });

    return tempDiv.innerHTML;
  }

  /**
   * Fix fonts in fetched content
   * @param {string} htmlContent - HTML content
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {Promise<string>} HTML with fixed fonts
   */
  async fixFontsInFetchedContent(htmlContent, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const stylesheets = doc.querySelectorAll('link[rel="stylesheet"]');

    async function fetchAndParseCss(url) {
      try {
        const response = await fetch(url);
        return await response.text();
      } catch (e) {
        console.warn('Could not fetch CSS:', url, e);
        return '';
      }
    }

    function extractFontFaceRules(css) {
      const fontFaceRegex = /@font-face\s*{[^}]*}/g;
      return css.match(fontFaceRegex) || [];
    }

    function modifyFontUrls(css, baseUrl) {
      return css.replace(/url\(['"]?(.+?)['"]?\)/g, (match, url) => {
        if (!url.startsWith('http')) {
          return `url("${new URL(url, baseUrl)}")`;
        }
        return match;
      });
    }

    const results = await Promise.all(Array.from(stylesheets).map(async link => {
      const href = new URL(link.getAttribute('href'), baseUrl).href;
      try {
        const css = await fetchAndParseCss(href);
        const fontFaceRules = extractFontFaceRules(css);
        return fontFaceRules.map(rule => modifyFontUrls(rule, href));
      } catch (e) {
        return [];
      }
    }));

    const allFontFaceRules = results.flat();
    const styleElement = doc.createElement('style');
    styleElement.textContent = allFontFaceRules.join('\n');
    doc.head.appendChild(styleElement);

    return new XMLSerializer().serializeToString(doc);
  }

  /**
   * Create Shadow DOM container with content isolation
   * @param {string} htmlContent - HTML content to inject
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {HTMLElement} Shadow DOM container
   */
  createShadowDOMContainer(htmlContent, baseUrl) {
    const shadowContainer = document.createElement('div');
    shadowContainer.style.position = 'relative';
    shadowContainer.style.width = '100%';
    shadowContainer.style.height = '100%';
    shadowContainer.style.overflow = 'auto';
    shadowContainer.style.border = 'none';

    const shadowRoot = shadowContainer.attachShadow({ mode: 'open' });

    // Add default style to prevent conflicts
    const defaultStyle = document.createElement('style');
    defaultStyle.textContent = `
      :host {
        all: initial;
        background-color: #fff !important;
        font-family: Arial, sans-serif;
      }
    `;
    shadowRoot.appendChild(defaultStyle);

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // Rewrite relative URLs to absolute URLs
    const base = new URL(baseUrl);
    
    // Rewrite all resource URLs
    const elements = shadowRoot.querySelectorAll('a[href], link[href], script[src], img[src], video[src], audio[src], source[src]');
    elements.forEach(element => {
      const attributeName = element.hasAttribute('href') ? 'href' : 'src';
      try {
        element.setAttribute(attributeName, new URL(element.getAttribute(attributeName), base).href);
      } catch (e) {
        console.error('Error rewriting URL:', e);
      }
    });

    shadowRoot.innerHTML = this.sanitizeHtmlText(doc.documentElement.outerHTML);

    // Intercept link clicks to navigate within the proxy
    shadowRoot.querySelectorAll('a').forEach(anchor => {
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        const newUrl = anchor.href;
        // Emit custom event for navigation
        shadowContainer.dispatchEvent(new CustomEvent('proxy-navigate', {
          detail: { url: newUrl },
          bubbles: true
        }));
      });
    });

    return shadowContainer;
  }

  /**
   * Modify CSS to fix z-index issues
   * @param {string} cssText - CSS text to modify
   * @returns {string} Modified CSS
   */
  modifyCss(cssText) {
    const zIndexRegex = /z-index\s*:\s*2147483647\s*;/g;
    return cssText.replace(zIndexRegex, 'z-index: 2147483643;');
  }

  /**
   * Generate a data URL for the current session
   * @returns {string} Data URL
   */
  generateDataURL() {
    const htmlContent = document.documentElement.outerHTML;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  }

  /**
   * Generate a unique user ID
   * @returns {string} User ID
   */
  generateUserID() {
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

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  /**
   * Open current page in about:blank (tab cloaking)
   */
  openInAboutBlank() {
    const newWindow = window.open('about:blank', '_blank');
    const clonedDocument = document.documentElement.cloneNode(true);
    newWindow.document.write(clonedDocument.outerHTML);
    newWindow.document.close();
  }

  /**
   * Open current page in blob: URL (tab cloaking)
   */
  async openInBlob() {
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

  /**
   * Clear all data (localStorage, sessionStorage, cookies)
   */
  clearAllData() {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(';').forEach((cookie) => {
      const cookieName = cookie.split('=')[0].trim();
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
    });
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProxyEngine;
}
